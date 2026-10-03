#!/usr/bin/env node
// End-to-end runner: `npm run test:e2e`.
//
// Builds nothing (run `npm run build` first). Starts the BUILT server as a
// child process on a free port with fast bots and the in-memory store, runs
// every tests/e2e/*.spec.mjs against it in real Chromium, prints one line per
// check, stops the child it started (by pid) and exits non-zero on a failure.
//
//   node tests/e2e/run.mjs                 every spec
//   node tests/e2e/run.mjs layout member   only specs whose file name contains a word
//   E2E_PORT=8021 node tests/e2e/run.mjs   a fixed port instead of a free one
//   E2E_HEADED=1 ...                       watch it happen
//
// Each spec exports `default async function ({ baseUrl, browser, check, shots })`.
//   check(name, booleanOrAsyncFn, detail?)   one PASS/FAIL line; a function that throws is a FAIL
//   check.must(...)                          the same, but a FAIL aborts the current section
//   check.warn(name, detail) / check.info(name, detail)   a WARN / INFO line (never fails the run)
//   check.section(name, asyncFn)             a block whose crash is one FAIL, not the end of the spec
//   shots(page, name, opts?)                 a PNG in tests/e2e/shots/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SHOTS = path.join(HERE, 'shots');
const SERVER = path.join(ROOT, 'build', 'server.cjs');
const CHROMIUM = '/opt/pw-browsers/chromium';
const SPEC_TIMEOUT_MS = Number(process.env.E2E_SPEC_TIMEOUT_MS || 8 * 60 * 1000);
const ADMIN_TOKEN = 'test-admin';

const C = process.stdout.isTTY ? { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' } : { red: '', green: '', yellow: '', dim: '', off: '' };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitForHealth(baseUrl, child, ms = 20000) {
  const until = Date.now() + ms;
  let last = '';
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`the server exited with code ${child.exitCode} before it was healthy`);
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) return res.json();
      last = `HTTP ${res.status}`;
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`the server did not answer /healthz within ${ms} ms (${last})`);
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode) { resolve(); return; }
    const hard = setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* already gone */ } }, 4000);
    child.once('exit', () => { clearTimeout(hard); resolve(); });
    // Only ever the pid this runner started: never pkill, never a name match.
    try { process.kill(child.pid, 'SIGTERM'); } catch { clearTimeout(hard); resolve(); }
  });
}

async function launch() {
  const opts = { headless: process.env.E2E_HEADED !== '1' };
  if (fs.existsSync(CHROMIUM)) return chromium.launch({ ...opts, executablePath: CHROMIUM });
  return chromium.launch(opts);
}

const safe = (s) => String(s).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120);

async function main() {
  const filters = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (!fs.existsSync(SERVER)) { console.error('build/server.cjs is missing. Run "npm run build" first.'); process.exit(2); }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) { console.error('dist/ is missing. Run "npm run build" first.'); process.exit(2); }

  const specs = fs.readdirSync(HERE).filter((f) => f.endsWith('.spec.mjs')).sort()
    .filter((f) => filters.length === 0 || filters.some((w) => f.includes(w)));
  if (specs.length === 0) { console.error('No spec matches.'); process.exit(2); }

  // Screenshots are an output, not a source: start every run with an empty folder.
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const f of fs.readdirSync(SHOTS)) if (f.endsWith('.png')) fs.rmSync(path.join(SHOTS, f));
  if (!fs.existsSync(path.join(SHOTS, '.gitkeep'))) fs.writeFileSync(path.join(SHOTS, '.gitkeep'), '');

  const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : await freePort();
  const baseUrl = `http://localhost:${port}`;
  const env = {
    ...process.env,
    PORT: String(port), NODE_ENV: 'test', PUBLIC_URL: baseUrl,
    BOT_DELAY_MIN_MS: '80', BOT_DELAY_MAX_MS: '160', QUICK_MATCH_BOT_AFTER_MS: '1500',
    ADMIN_TOKEN,
  };
  // The memory store, whatever the shell has set: a test never touches a real database or data file.
  for (const k of ['DATABASE_URL', 'DATA_FILE', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PRICE_MEMBER', 'PRICE_VIP', 'PRICE_CEO', 'RESEND_API_KEY', 'VA_NO_AUTOSTART', 'INSTANT_BOTS', 'GATE_CUSTOM_SETTINGS']) delete env[k];

  const serverLog = [];
  const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const keep = (stream) => (buf) => { for (const line of String(buf).split('\n')) if (line.trim()) serverLog.push({ stream, line, at: Date.now() }); };
  child.stdout.on('data', keep('out'));
  child.stderr.on('data', keep('err'));

  let browser = null;
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return; stopping = true;
    if (browser) await browser.close().catch(() => {});
    await stopChild(child);
  };
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup().finally(() => process.exit(130)); });

  const results = []; // { spec, name, status: pass|fail|warn|info, detail }
  const record = (spec, name, status, detail) => {
    results.push({ spec, name, status, detail });
    const tag = status === 'pass' ? `${C.green}PASS${C.off}` : status === 'fail' ? `${C.red}FAIL${C.off}` : status === 'warn' ? `${C.yellow}WARN${C.off}` : `${C.dim}INFO${C.off}`;
    const more = detail === undefined || detail === null || detail === '' ? '' : ` ${C.dim}- ${String(detail).split('\n').join(' | ').slice(0, 900)}${C.off}`;
    console.log(`${tag}  ${spec} > ${name}${more}`);
  };

  let exitCode = 1;
  try {
    const health = await waitForHealth(baseUrl, child);
    console.log(`${C.dim}server pid ${child.pid} on ${baseUrl} (store: ${health.store}); ${specs.length} spec file${specs.length === 1 ? '' : 's'}${C.off}`);
    if (health.store !== 'memory') throw new Error(`refusing to run against a "${health.store}" store`);
    browser = await launch();

    for (const file of specs) {
      const spec = file.replace(/\.spec\.mjs$/, '');
      class Abort extends Error {}
      const run = async (name, what, detail, must) => {
        let ok; let info = detail;
        if (typeof what === 'function') {
          try { const r = await what(); ok = r !== false; if (typeof r === 'string' && info === undefined) info = r; }
          catch (e) { if (e instanceof Abort) throw e; ok = false; info = String(e && e.message ? e.message : e).split('\n').slice(0, 3).join(' | '); }
        } else ok = !!what;
        record(spec, name, ok ? 'pass' : 'fail', ok && typeof what !== 'function' ? undefined : info);
        if (!ok && must) throw new Abort(`"${name}" failed`);
        return ok;
      };
      const check = (name, what, detail) => run(name, what, detail, false);
      check.must = (name, what, detail) => run(name, what, detail, true);
      check.warn = (name, detail) => record(spec, name, 'warn', detail);
      check.info = (name, detail) => record(spec, name, 'info', detail);
      check.section = async (name, fn) => {
        try { await fn(); }
        catch (e) { if (e instanceof Abort) record(spec, `${name}: stopped`, 'info', e.message); else record(spec, `${name}: crashed`, 'fail', String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
      };
      const shots = async (page, name, opts = {}) => {
        const file2 = path.join(SHOTS, `${safe(spec)}--${safe(name)}.png`);
        try { await page.screenshot({ path: file2, fullPage: !!opts.fullPage, animations: 'disabled' }); } catch (e) { record(spec, `screenshot ${name}`, 'warn', e.message.split('\n')[0]); }
        return file2;
      };

      const started = Date.now();
      const logFrom = serverLog.length;
      let timer;
      try {
        const mod = await import(pathToFileURL(path.join(HERE, file)).href);
        if (typeof mod.default !== 'function') throw new Error('the spec has no default export');
        await Promise.race([
          mod.default({ baseUrl, browser, check, shots, adminToken: ADMIN_TOKEN }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`spec timed out after ${SPEC_TIMEOUT_MS} ms`)), SPEC_TIMEOUT_MS); }),
        ]);
      } catch (e) {
        record(spec, 'spec crashed', 'fail', String(e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e));
      } finally {
        clearTimeout(timer);
        // A spec that died mid-way must not leak its pages into the next one.
        for (const ctx of browser.contexts()) await ctx.close().catch(() => {});
      }
      // The server's own complaints while this spec ran are findings too.
      const noisy = serverLog.slice(logFrom).filter((l) => l.stream === 'err' && !/ExperimentalWarning|DeprecationWarning|--trace-/.test(l.line));
      record(spec, 'the server logged no errors during this spec', noisy.length ? 'fail' : 'pass', noisy.length ? noisy.slice(0, 6).map((l) => l.line).join(' | ') : undefined);
      console.log(`${C.dim}      ${spec}: ${((Date.now() - started) / 1000).toFixed(1)} s${C.off}`);
    }

    const n = (s) => results.filter((r) => r.status === s).length;
    console.log(`\n${n('fail') ? C.red : C.green}${n('pass')} passed, ${n('fail')} failed, ${n('warn')} warning${n('warn') === 1 ? '' : 's'}${C.off}`);
    if (n('fail')) { console.log('\nFailures:'); for (const r of results.filter((x) => x.status === 'fail')) console.log(`  ${r.spec} > ${r.name}${r.detail ? `\n      ${String(r.detail).slice(0, 1200)}` : ''}`); }
    exitCode = n('fail') ? 1 : 0;
  } catch (e) {
    console.error(`${C.red}e2e run failed:${C.off}`, e && e.stack ? e.stack : e);
    const tail = serverLog.slice(-25).map((l) => `  [server ${l.stream}] ${l.line}`).join('\n');
    if (tail) console.error(tail);
    exitCode = 1;
  } finally {
    await cleanup();
  }
  process.exit(exitCode);
}

main();
