// Shared helpers for the e2e specs. Not a spec itself (the runner only loads
// *.spec.mjs).
import zlib from 'node:zlib';

export const PHONE = { width: 360, height: 640 };
export const PHONE_TALL = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };
export const PHONES = [PHONE, PHONE_TALL];
export const vpName = (v) => `${v.width}x${v.height}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A fresh browser context (its own cookie jar: one context is one person).
 * `cookies` copies a session from another context: a fresh browser, the same
 * account. The server allows 20 new guests an hour per address, so specs that
 * need many fresh browsers but not many people share one account this way.
 */
export async function openContext(browser, { viewport = PHONE, cookies = null, permissions = null, reducedMotion = undefined, baseUrl } = {}) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: viewport.width < 800 ? 2 : 1, hasTouch: viewport.width < 800, reducedMotion,
    ...(permissions && baseUrl ? { permissions } : {}),
  });
  ctx.setDefaultTimeout(8000);
  ctx.setDefaultNavigationTimeout(15000);
  if (cookies) await ctx.addCookies(cookies);
  return ctx;
}

/**
 * Collect everything a page complains about: console errors, uncaught
 * exceptions, failed requests and HTTP errors. `allow(re)` marks a problem as
 * expected (signing in with a wrong password answers 401 on purpose).
 */
export function watch(page) {
  const problems = [];
  const allowed = [];
  const add = (text) => { if (!allowed.some((re) => re.test(text))) problems.push(text); };
  page.on('console', (m) => { if (m.type() === 'error') add(`console error: ${m.text()} (${m.location().url || 'inline'})`); });
  page.on('pageerror', (e) => add(`uncaught: ${e.message}`));
  page.on('requestfailed', (r) => {
    const why = (r.failure() && r.failure().errorText) || '';
    // A navigation cancels whatever was in flight; that is not a failure.
    if (/ERR_ABORTED/.test(why)) return;
    add(`request failed: ${r.method()} ${r.url()} ${why}`);
  });
  page.on('response', (r) => { if (r.status() >= 400) add(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`); });
  return {
    problems,
    allow(re) { allowed.push(re); for (let i = problems.length - 1; i >= 0; i--) if (re.test(problems[i])) problems.splice(i, 1); },
    take() { return problems.splice(0); },
  };
}

/** Call an arena RPC as the person a context is signed in as. */
export async function rpc(ctx, baseUrl, name, args = {}) {
  const res = await ctx.request.post(`${baseUrl}/api/rpc/${name}`, { data: args, headers: { 'Content-Type': 'application/json' } });
  let body = {};
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok()) { const e = new Error(`rpc ${name}: ${body.error || res.status()}`); e.status = res.status(); throw e; }
  return body;
}

export async function admin(ctx, baseUrl, token, action, args = {}) {
  const res = await ctx.request.post(`${baseUrl}/api/admin/${action}`, { data: args, headers: { 'Content-Type': 'application/json', 'x-admin-token': token } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`admin ${action}: ${body.error || res.status()}`);
  return body;
}

/** A guest session without opening a page. */
export async function guestSession(ctx, baseUrl, displayName = null) {
  const { user } = await rpc(ctx, baseUrl, 'guest');
  if (displayName) await rpc(ctx, baseUrl, 'saveProfile', { displayName });
  return user;
}

let memberN = 0;
/** A registered member with a finished profile (>= 70%), made over RPC. */
export async function memberSession(ctx, baseUrl, displayName, profile = {}) {
  memberN += 1;
  const email = `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '')}.${Date.now().toString(36)}${memberN}@example.com`;
  const password = 'correct horse battery';
  await rpc(ctx, baseUrl, 'register', { email, password, displayName });
  await rpc(ctx, baseUrl, 'cardSort', { picks: [0, 1, 2, 0, 1, 2, 0, 1] });
  await rpc(ctx, baseUrl, 'saveProfile', {
    displayName, colorRanks: ['teal', 'plum'], headline: 'Second-time founder, B2B payments', stage: 'pre_revenue', industry: 'fintech',
    interests: ['SaaS', 'Fintech'], currentProject: 'Invoicing for freelancers', skills: 'sales, product', intent: ['peers', 'cofounder', 'play'], offers: [],
    goals: 'Find a technical cofounder', lookingFor: 'a technical cofounder', ...profile,
  });
  const { user } = await rpc(ctx, baseUrl, 'finishOnboarding');
  return { user, email, password };
}

export const cookiesOf = (ctx) => ctx.cookies();

/** The Four in a Row grid as a string: one character per hole, column by column. */
export async function firBoard(page) {
  return page.evaluate(() => {
    const cols = [...document.querySelectorAll('.fir__col')];
    if (!cols.length) return null;
    return cols.map((c) => [...c.querySelectorAll('.fir__hole')].map((h) => {
      const d = h.querySelector('.fir__disc');
      if (!d) return '.';
      return d.style.background || getComputedStyle(d).backgroundColor;
    }).join(',')).join('|');
  });
}
export const discCount = (page) => page.locator('.fir__hole .fir__disc').count();

/**
 * Play a Four in a Row game to its end from a seat by clicking legal columns.
 * `pick(legalCount, turn)` chooses which legal column (index into the legal
 * ones); the default plays left to right so games stay short and varied.
 */
export async function playFirToEnd(page, { maxMs = 60000, pick = null } = {}) {
  const until = Date.now() + maxMs;
  let turn = 0;
  while (Date.now() < until) {
    if (/\/debrief\//.test(page.url())) return { moves: turn, how: 'debrief' };
    if (await page.locator('.stage__foot').count()) return { moves: turn, how: 'finished' };
    const can = page.locator('.fir__col--can');
    const n = await can.count();
    if (n > 0) {
      const i = pick ? pick(n, turn) : (turn * 3) % n;
      try { await can.nth(Math.min(i, n - 1)).click({ timeout: 1500 }); turn += 1; } catch { /* the turn passed between the count and the click */ }
      await sleep(40);
    } else await sleep(60);
  }
  throw new Error(`the game did not end within ${maxMs} ms (${turn} moves made)`);
}

// ---- a small PNG, made here so the photo-upload test has no fixture file ----------
function crc32(buf) {
  let c; let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function makePng(size = 48) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 3 + 1) + 1 + x * 3;
      const inDisc = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size * 0.36) ** 2;
      raw[o] = inDisc ? 232 : 11; raw[o + 1] = inDisc ? 182 : 21; raw[o + 2] = inDisc ? 74 : 48;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- measuring a page (runs in the browser) -----------------------------------------
/**
 * Everything the layout spec asserts, measured in the page:
 *   scrollWidth vs innerWidth, elements wider than the viewport, tap targets,
 *   clipped button text, and what the tab bar or a floating control covers
 *   when the page is scrolled to the bottom.
 */
export function measurePage(page, { root = 'body', minTap = 40 } = {}) {
  return page.evaluate(async ({ root, minTap }) => {
    const vw = window.innerWidth; const vh = window.innerHeight;
    const scope = document.querySelector(root) || document.body;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).display === 'none') return false;
      return true;
    };
    const label = (el) => {
      const text = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      return `${el.tagName.toLowerCase()}${cls} "${text}"`;
    };
    const out = { innerWidth: vw, innerHeight: vh, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, wide: [], small: [], clipped: [], covered: [], unlabelled: [], smallest: null };

    for (const el of scope.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1) out.wide.push(`${label(el)} is ${Math.round(r.width)}px wide`);
    }

    // Tap targets: buttons, links styled as buttons, tabs, inputs. A checkbox
    // or radio is measured by the label that wraps it (the label is the target).
    const TAP = 'button, a.btn, a.chip, a.tab, a.card, [role="button"], [role="tab"], input:not([type="hidden"]):not([type="file"]), select, textarea, summary';
    const targets = [];
    for (const el of scope.querySelectorAll(TAP)) {
      if (el.disabled) continue;
      let box = el;
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) box = el.closest('label') || el;
      if (!visible(box)) continue;
      const r = box.getBoundingClientRect();
      targets.push({ el, box, r, min: Math.min(r.width, r.height), h: r.height, name: label(box) });
    }
    for (const t of targets) {
      if (!out.smallest || t.h < out.smallest.h) out.smallest = { h: Math.round(t.h * 10) / 10, w: Math.round(t.r.width * 10) / 10, name: t.name };
      if (t.h < minTap - 0.5) out.small.push(`${t.name}: ${Math.round(t.h * 10) / 10}px tall`);
      const el = t.el;
      if ((el.tagName === 'BUTTON' || el.classList.contains('btn')) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        // Boards draw their cells inside buttons; clipping only matters for text.
        if ((el.innerText || '').trim()) out.clipped.push(`${t.name}: content ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
      }
      if (!(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.innerText || '').trim() || el.getAttribute('title') || el.getAttribute('placeholder') || (el.labels && el.labels.length) || el.closest('label'))) out.unlabelled.push(t.name);
    }

    // Scrolled to the very bottom, nothing fixed (tab bar, floating buttons)
    // may sit on top of something a thumb needs.
    const scroller = document.scrollingElement;
    const before = scroller.scrollTop;
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const fixed = [...document.querySelectorAll('body *')].filter((el) => visible(el) && getComputedStyle(el).position === 'fixed' && !el.classList.contains('stage') && !el.classList.contains('drawer') && !el.classList.contains('toast') && getComputedStyle(el).pointerEvents !== 'none');
    for (const f of fixed) {
      const fr = f.getBoundingClientRect();
      for (const t of targets) {
        if (f.contains(t.box) || t.box.contains(f)) continue;
        if (!visible(t.box)) continue;
        const r = t.box.getBoundingClientRect();
        const overlapX = Math.min(r.right, fr.right) - Math.max(r.left, fr.left);
        const overlapY = Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top);
        if (overlapX > 1 && overlapY > 1 && r.bottom > 0 && r.top < vh) out.covered.push(`${label(f)} covers ${t.name} by ${Math.round(overlapX)}x${Math.round(overlapY)}px at the bottom of the page`);
      }
    }
    out.scrollHeight = scroller.scrollHeight;
    scroller.scrollTop = before;
    return out;
  }, { root, minTap });
}

/** WCAG contrast of every muted / small text element against what is behind it. */
export function measureContrast(page, selector = '.muted, .eyebrow, .label, .tab, .chat__sys, ::placeholder') {
  return page.evaluate((selector) => {
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const lum = ({ r, g, b }) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const la = lum(a); const lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const background = (el) => {
      const layers = [];
      let opacity = 1;
      for (let p = el; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        opacity *= Number(cs.opacity);
        const c = parse(cs.backgroundColor);
        if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
      }
      let bg = { r: 11, g: 21, b: 48, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      return { bg, opacity };
    };
    const rows = [];
    const sel = selector.split(',').map((s) => s.trim()).filter((s) => s !== '::placeholder').join(',');
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || !(el.innerText || '').trim()) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color); if (!fg) continue;
      const { bg, opacity } = background(el);
      const shown = over({ ...fg, a: fg.a * opacity }, bg);
      rows.push({ what: `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')} "${el.innerText.trim().slice(0, 30)}"`, ratio: Math.round(ratio(shown, bg) * 100) / 100, px: parseFloat(cs.fontSize) });
    }
    if (selector.includes('::placeholder')) {
      for (const el of document.querySelectorAll('input.input, textarea.input')) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || !el.getAttribute('placeholder')) continue;
        const fg = parse(getComputedStyle(el, '::placeholder').color); if (!fg) continue;
        const { bg, opacity } = background(el);
        const shown = over({ ...fg, a: fg.a * opacity }, bg);
        rows.push({ what: `placeholder "${el.getAttribute('placeholder').slice(0, 30)}"`, ratio: Math.round(ratio(shown, bg) * 100) / 100, px: parseFloat(getComputedStyle(el).fontSize) });
      }
    }
    rows.sort((a, b) => a.ratio - b.ratio);
    return rows;
  }, selector);
}
