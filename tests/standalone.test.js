// This build stands alone: it shares nothing with the earlier VentureArena
// builds. Nothing in the source may call their services (the Supabase
// projects, the VentureFlow site on Vercel, the first arena on Render), so
// both can run side by side and neither can change the other's data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { makeArena } from './helpers.js';
import { arenaMiddleware } from '../src/server/http.js';
import { loadConfig } from '../src/server/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.(js|jsx|mjs|html|css|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no address of an earlier build', () => {
  it('appears anywhere in the source, the scripts or the static files', () => {
    const files = [...sourceFiles(path.join(root, 'src')), ...sourceFiles(path.join(root, 'scripts')), ...sourceFiles(path.join(root, 'public')), path.join(root, 'index.html')];
    expect(files.length).toBeGreaterThan(100);
    const found = [];
    for (const f of files) {
      const m = fs.readFileSync(f, 'utf8').match(/[a-z0-9-]+\.(?:supabase\.co|vercel\.app|onrender\.com|up\.railway\.app)/gi);
      if (m) found.push(`${path.relative(root, f)}: ${[...new Set(m)].join(', ')}`);
    }
    expect(found).toEqual([]);
  });
});

describe('a playtest copy can be kept out of search engines', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'va-standalone-'));
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  fs.writeFileSync(path.join(dist, 'landing.html'), '<h1>hi</h1>');
  const ask = async (config, p) => {
    const out = {}; let status = 404; let payload;
    const ctx = { method: 'GET', path: p, headers: {}, ip: '198.51.100.7', type: undefined, set: (k, v) => { out[k.toLowerCase()] = v; }, get status() { return status; }, set status(v) { status = v; }, get body() { return payload; }, set body(v) { payload = v; if (status === 404) status = 200; } };
    await arenaMiddleware(makeArena(), { distDir: dist, adminToken: 'x', production: true, ...config })(ctx, async () => {});
    return { out, status, body: payload };
  };

  it('NOINDEX=1: every answer says noindex and robots.txt turns crawlers away', async () => {
    expect(loadConfig({}).noindex).toBe(false);
    expect(loadConfig({ NOINDEX: '1' }).noindex).toBe(true);
    for (const p of ['/', '/healthz', '/api/rpc/nope', '/games/nope/']) {
      expect((await ask({ noindex: true }, p)).out['x-robots-tag'], p).toBe('noindex, nofollow');
      expect((await ask({ noindex: false }, p)).out['x-robots-tag'], p).toBeUndefined();
    }
    const closed = await ask({ noindex: true }, '/robots.txt');
    expect(closed.status).toBe(200);
    expect(closed.body).toBe('User-agent: *\nDisallow: /\n');
    const open = await ask({ noindex: false }, '/robots.txt');
    expect(typeof open.body).not.toBe('string'); // the built file, streamed
  });
});

describe('.gitignore', () => {
  // (Bug: the line `data/` was meant for a local data folder at the top of
  // the project. Without a leading slash it matches a folder called "data"
  // ANYWHERE, so src/games/ventureflow/vf/data was silently left out of the
  // first push and the site could not have been built from the repository.)
  const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const globToRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
  /** A small reading of .gitignore, enough for the kinds of line this file uses. */
  function ignored(rel) {
    let out = false;
    const parts = rel.split('/');
    for (const raw of lines) {
      const negate = raw.startsWith('!');
      let pat = negate ? raw.slice(1) : raw;
      const dirOnly = pat.endsWith('/'); if (dirOnly) pat = pat.slice(0, -1);
      const anchored = pat.startsWith('/') || pat.includes('/'); if (pat.startsWith('/')) pat = pat.slice(1);
      let hit = false;
      if (anchored) {
        const re = globToRe(pat); const depth = pat.split('/').length;
        const upTo = dirOnly ? parts.length - 1 : parts.length;
        hit = depth <= upTo && re.test(parts.slice(0, depth).join('/'));
      } else {
        const re = globToRe(pat);
        hit = (dirOnly ? parts.slice(0, -1) : parts).some((seg) => re.test(seg));
      }
      if (hit) out = !negate;
    }
    return out;
  }
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'build', '.git'].includes(e.name) && rel !== 'tests/e2e/shots') walk(rel, out); } else out.push(rel);
    }
    return out;
  };

  it('this reading of the file agrees with git on the lines that matter', () => {
    expect(ignored('node_modules/x/index.js')).toBe(true);
    expect(ignored('src/node_modules/x.js')).toBe(false);
    expect(ignored('dist/index.html')).toBe(true);
    expect(ignored('tests/e2e/shots/a.png')).toBe(true);
    expect(ignored('.env')).toBe(true);
    expect(ignored('.env.local')).toBe(true);
    expect(ignored('.env.example')).toBe(false);
    expect(ignored('keys/server.pem')).toBe(true);
    expect(ignored('data/arena.json')).toBe(true);
    expect(ignored('src/index.js')).toBe(false);
  });

  it('leaves out nothing the project needs: every source, test, script and doc file is kept', () => {
    const files = walk('');
    expect(files.length).toBeGreaterThan(300);
    expect(files.filter(ignored)).toEqual([]);
  });
});
