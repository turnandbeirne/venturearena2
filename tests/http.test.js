// The HTTP layer, against the REAL server (boardgame.io's Koa app with our
// middleware in front) listening on a random port, plus a few cases driven
// through the middleware function directly where a second configuration is
// needed (production cookies, no admin token).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { GUESTS_PER_HOUR } from '../src/server/arena/users.js';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import { makeArena, member } from './helpers.js';
import { arenaMiddleware, parseCookies, COOKIE } from '../src/server/http.js';

// index.js starts a server when imported unless this is set first.
process.env.VA_NO_AUTOSTART = '1';

const SECRET = 'TOP-SECRET-OUTSIDE-DIST';
const ADMIN = 'admin-token-for-tests';
let root; let dist; let srv; let base;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'va-http-'));
  dist = path.join(root, 'dist');
  fs.mkdirSync(path.join(dist, 'games', 'x'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>shell</title>APP-SHELL');
  fs.writeFileSync(path.join(dist, 'landing.html'), '<!doctype html><title>landing</title>LANDING-PAGE');
  fs.writeFileSync(path.join(dist, 'games', 'x', 'index.html'), '<!doctype html><title>x</title>GAME-X-PAGE');
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log("app")');
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *');
  fs.writeFileSync(path.join(root, 'secret.txt'), SECRET);
  fs.writeFileSync(path.join(root, 'dist-secrets.txt'), SECRET); // shares the "dist" prefix: a naive startsWith check lets it through
  const { startServer } = await import('../src/server/index.js');
  const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
  // production: true so the server trusts X-Forwarded-For, as it does behind
  // its host's proxy: each test visitor then has its own address and the
  // per-address rate limits behave as they would for real, separate people.
  srv = await startServer({ port: 0, distDir: dist, adminToken: ADMIN, production: true, databaseUrl: '', dataFile: '', instantBots: true, publicUrl: 'http://localhost', resendKey: '' });
  quiet.mockRestore();
  base = `http://127.0.0.1:${srv.port}`;
}, 60000);

afterAll(async () => {
  if (srv) await srv.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

let visitor = 0;
const rpc = (name, args, { cookie, type = 'application/json', raw, ip } = {}) => fetch(`${base}/api/rpc/${name}`, { method: 'POST', headers: { ...(type ? { 'Content-Type': type } : {}), ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': ip || `198.51.100.${(visitor % 250) + 1}` }, body: raw !== undefined ? raw : JSON.stringify(args ?? {}) });
const cookieOf = (res) => { const m = /va_s=([0-9a-f]+)/.exec(res.headers.getSetCookie().join('\n')); return m ? `va_s=${m[1]}` : null; };
async function newGuest() { const ip = `192.0.2.${(visitor += 1)}`; const res = await rpc('guest', {}, { ip }); return { cookie: cookieOf(res), user: (await res.json()).user, ip }; }
async function newMember(name) {
  const g = await newGuest();
  const res = await rpc('register', { birthDate: '1990-01-01', email: `${name.toLowerCase()}@example.com`, password: 'correct horse', displayName: name }, { cookie: g.cookie, ip: g.ip });
  expect(res.status, `registering ${name}`).toBe(200);
  // Registering replaces the guest session, so carry the new cookie forward.
  const fresh = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
  return { cookie: fresh || g.cookie, user: (await res.json()).user, ip: g.ip };
}
/** A request whose path is sent exactly as written (fetch would normalise "/../"). */
function rawGet(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: p, method }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject); req.end();
  });
}

describe('rpc endpoint', () => {
  it('health check', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, store: 'memory' });
  });

  it('only accepts JSON, which keeps cross-site form posts out', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', null, 'text/json', 'application/jsonp', 'application/json-seq', 'application/jsonx; charset=utf-8']) {
      const res = await rpc('guest', {}, { type });
      expect(res.status, String(type)).toBe(415);
      expect(await res.json()).toEqual({ error: 'Send JSON' });
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    expect((await rpc('guest', {}, { type: 'application/json; charset=utf-8' })).status).toBe(200);
    expect((await rpc('guest', {}, { type: 'Application/JSON' })).status).toBe(200);
  });

  it('the session cookie is HttpOnly and SameSite=Lax; the marker cookie carries no secret', async () => {
    const res = await rpc('guest', {});
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const session = cookies.find((c) => c.startsWith(`${COOKIE}=`)); const marker = cookies.find((c) => c.startsWith('va_in='));
    expect(session).toMatch(/^va_s=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=15552000; Secure$/);
    expect(marker).toBe('va_in=1; Path=/; SameSite=Lax; Max-Age=15552000; Secure');
    expect(marker).not.toMatch(/HttpOnly/); // the landing page's script reads this one; it says only "has a session"
    const body = await res.json();
    expect(body.user.isGuest).toBe(true);
    expect(body).not.toHaveProperty('setSession'); // the token travels in the cookie only
    expect(JSON.stringify(body)).not.toContain(/va_s=([0-9a-f]+)/.exec(session)[1]);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('a session works across calls; logging out clears the cookie and kills the session', async () => {
    const g = await newGuest();
    const me = await (await rpc('me', {}, { cookie: g.cookie })).json();
    expect(me.user.id).toBe(g.user.id);
    expect((await rpc('lobby', {}, { cookie: g.cookie })).status).toBe(200);
    const out = await rpc('logout', {}, { cookie: g.cookie });
    expect(out.status).toBe(200);
    const cleared = out.headers.getSetCookie();
    expect(cleared.find((c) => c.startsWith('va_s='))).toBe('va_s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
    expect(cleared.find((c) => c.startsWith('va_in='))).toBe('va_in=; Path=/; SameSite=Lax; Max-Age=0; Secure');
    expect(await out.json()).toEqual({});
    expect((await rpc('lobby', {}, { cookie: g.cookie })).status).toBe(401);
    expect((await (await rpc('me', {}, { cookie: g.cookie })).json()).user).toBe(null);
  });

  it('no session: 401; a made-up or malformed cookie is no session, not a crash', async () => {
    const res = await rpc('lobby', {});
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/Sign in or enter as a guest/);
    for (const cookie of [`va_s=${'a'.repeat(64)}`, 'va_s=', 'va_s=%E0%A4%A', 'va_s=%', 'other=1', 'va_s=a; va_s=b', `va_s=${'x'.repeat(5000)}`, '=;=;;', 'va_s="quoted"']) {
      const r = await rpc('lobby', {}, { cookie });
      expect(r.status, cookie.slice(0, 20)).toBe(401);
    }
    // Public handlers still work with a broken cookie.
    expect((await rpc('games', {}, { cookie: 'va_s=%E0%A4%A' })).status).toBe(200);
  });

  it('unknown handlers are 404, including names that live on every object', async () => {
    const g = await newGuest();
    for (const name of ['nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'lobby/extra', '..%2f..%2fadmin', 'Lobby']) {
      const res = await rpc(name, {}, { cookie: g.cookie });
      expect(res.status, name).toBe(404);
      expect(await res.json()).toHaveProperty('error');
    }
    // Only POST runs a handler.
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(`${base}/api/rpc/me`, { method, headers: { Cookie: g.cookie, 'Content-Type': 'application/json' } });
      expect(res.status, method).toBe(404);
    }
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
  });

  it('bodies: empty is fine, broken JSON is 400, more than 256 KB is refused', async () => {
    const g = await newGuest();
    expect((await rpc('me', undefined, { cookie: g.cookie, raw: '' })).status).toBe(200);
    const bad = await rpc('me', undefined, { cookie: g.cookie, raw: '{not json' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Body must be JSON' });
    const big = await rpc('saveProfile', undefined, { cookie: g.cookie, raw: JSON.stringify({ bio: 'x'.repeat(300 * 1024) }) }).then((r) => r.status, () => 'reset');
    expect([413, 'reset']).toContain(big); // the server stops reading; the client sees 413 or a closed socket
    expect((await (await rpc('me', {}, { cookie: g.cookie })).json()).user.bio).toBe('');
    const ok = await rpc('saveProfile', { bio: 'x'.repeat(200 * 1024) }, { cookie: g.cookie });
    expect(ok.status).toBe(200);
    expect((await ok.json()).user.bio).toHaveLength(600);
  });

  it('no handler crashes on junk arguments, and nothing pollutes Object.prototype', async () => {
    const m = await newMember('Fuzz');
    const names = Object.keys(srv.A.rpc).filter((n) => n !== 'logout');
    expect(names.length).toBeGreaterThan(50);
    const bodies = ['null', '[]', '"text"', '42', 'true', '{}', '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}',
      JSON.stringify({ id: { $ne: null }, userId: ['a'], toId: {}, gameId: 7, code: {}, body: { x: 1 }, picks: 'abc', settings: 'x', kind: [], email: {}, password: [], q: {}, tier: {}, choice: {}, answer: [], dataUrl: {}, token: {}, username: {}, role: {}, mode: {}, share: 'yes', lat: {}, lon: [] }),
      JSON.stringify({ id: '__proto__', userId: 'constructor', toId: '__proto__', gameId: 'toString', kind: '__proto__', tier: '__proto__', username: '__proto__', code: '__proto__', role: '__proto__', mode: '__proto__', chip: '__proto__' })];
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const crashes = [];
    for (const name of names) {
      for (const raw of bodies) {
        const res = await rpc(name, undefined, { cookie: m.cookie, raw });
        if (res.status >= 500) crashes.push(`${name} ${raw.slice(0, 40)} -> ${res.status}`);
        await res.arrayBuffer();
      }
    }
    const logged = quiet.mock.calls.map((c) => String(c[1])).slice(0, 5);
    quiet.mockRestore();
    expect(crashes, logged.join('\n')).toEqual([]);
    expect(({}).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  }, 60000);

  it('an unexpected error is a plain 500 with no detail', async () => {
    const g = await newGuest();
    srv.A.rpc.boom = () => { throw new Error('database password is hunter2'); };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await rpc('boom', {}, { cookie: g.cookie });
    quiet.mockRestore();
    delete srv.A.rpc.boom;
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('at ');
    expect(JSON.parse(text)).toEqual({ error: 'Something went wrong on our side. Try again.' });
  });

  it('one member cannot act as another by naming them in the request', async () => {
    const a = await newMember('Avery'); const b = await newMember('Blake');
    await rpc('saveProfile', { headline: 'Avery headline', id: b.user.id, userId: b.user.id, me: b.user.id }, { cookie: a.cookie });
    expect(srv.A.user(b.user.id).headline).toBe('');
    expect(srv.A.user(a.user.id).headline).toBe('Avery headline');
    const hist = await (await rpc('pointsHistory', { userId: b.user.id, id: b.user.id }, { cookie: a.cookie })).json();
    expect(hist.rows.every((r) => r.userId === a.user.id)).toBe(true);
    const self = await (await rpc('me', {}, { cookie: a.cookie })).json();
    expect(self.user.email).toBe('avery@example.com');
    expect(JSON.stringify(self)).not.toMatch(/"pass"|"salt"|"hash"|verifyToken/);
    const other = await (await rpc('profile', { id: b.user.id }, { cookie: a.cookie })).json();
    expect(JSON.stringify(other)).not.toContain('blake@example.com');
  });
});

describe('photos', () => {
  it('are served by id with their own type and nosniff', async () => {
    const m = await newMember('Photo');
    const bytes = Buffer.from('not really a png');
    const set = await rpc('setPhoto', { dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }, { cookie: m.cookie });
    const url = (await set.json()).user.photo;
    expect(url).toMatch(/^\/api\/photo\/[0-9a-f-]{36}$/);
    const res = await fetch(`${base}${url}`); // public: an <img> tag sends no JSON header
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
    expect((await fetch(`${base}/api/photo/nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/photo/__proto__`)).status).toBe(404);
    expect((await fetch(`${base}${url}`, { method: 'POST' })).status).toBe(404);
  });
});

describe('/games never reaches boardgame.io\'s lobby API', () => {
  it('nobody can create, join, list or read matches over REST', async () => {
    const before = srv.store.col('bgio_meta').size;
    const json = { 'Content-Type': 'application/json' };
    const create = await fetch(`${base}/games/fourinarow/create`, { method: 'POST', headers: json, body: JSON.stringify({ numPlayers: 2 }) });
    expect(create.status).toBe(404);
    expect(await create.text()).not.toContain('matchID');
    for (const [method, p] of [['POST', '/games/fourinarow/abc/join'], ['POST', '/games/fourinarow/abc/leave'], ['POST', '/games/fourinarow/abc/playAgain'], ['POST', '/games/fourinarow/abc/update'], ['PUT', '/games/fourinarow'], ['DELETE', '/games/fourinarow/abc'], ['PATCH', '/games'], ['POST', '/games'], ['POST', '/games/']]) {
      const res = await fetch(`${base}${p}`, { method, headers: json, body: '{}' });
      expect(res.status, `${method} ${p}`).toBe(404);
    }
    // GET /games and /games/<name> would list games and matches; here they are pages or a 404.
    for (const p of ['/games', '/games/', '/games/fourinarow', '/games/fourinarow/abc']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(404);
      const text = await res.text();
      expect(text).not.toContain('matches');
      expect(text).not.toContain('APP-SHELL'); // never the app shell either: a missing game page is a real 404
    }
    expect(srv.store.col('bgio_meta').size).toBe(before);
    // A real match exists and still cannot be read over REST.
    const g = await newGuest();
    const t = (await (await rpc('playBots', { gameId: 'fourinarow' }, { cookie: g.cookie })).json()).table;
    const res = await fetch(`${base}/games/fourinarow/${t.id}`);
    expect(res.status).toBe(404);
    const creds = srv.A.c.tables.get(t.id).creds;
    expect(await res.text()).not.toContain(creds[0]);
  });

  it('the built SEO pages under /games are served', async () => {
    for (const p of ['/games/x', '/games/x/', '/games/x/index.html']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await res.text()).toContain('GAME-X-PAGE');
    }
  });
});

describe('static files and the app shell', () => {
  it('/ is the landing page; unknown paths without an extension get the app shell', async () => {
    const home = await fetch(`${base}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('LANDING-PAGE');
    for (const p of ['/lobby', '/table/123', '/p/someone', '/me', '/verify?token=abc', '/a/b/c/d']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toContain('APP-SHELL');
    }
    expect((await fetch(`${base}/`, { method: 'HEAD' })).status).toBe(200);
  });

  it('a path with an extension that is not on disk is a 404, not the shell', async () => {
    for (const p of ['/missing.js', '/assets/nope.css', '/favicon.ico', '/wp-login.php', '/config/.env.local', '/index.html.bak']) {
      const res = await fetch(`${base}${p}`);
      expect(res.status, p).toBe(404);
      expect(await res.text()).not.toContain('APP-SHELL');
    }
  });

  it('real files get their type; hashed assets are cached for good', async () => {
    const js = await fetch(`${base}/assets/app-abc123.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const robots = await fetch(`${base}/robots.txt`);
    expect(robots.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(robots.headers.get('cache-control')).toBe('no-cache');
    expect(await robots.text()).toBe('User-agent: *');
  });

  it('every response carries the security headers', async () => {
    for (const res of [await fetch(`${base}/`), await fetch(`${base}/missing.js`), await rpc('me', {}), await fetch(`${base}/games/nope`), await fetch(`${base}/healthz`)]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      await res.arrayBuffer();
    }
  });

  it('path traversal is refused, however it is spelled', async () => {
    const attempts = ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/assets/../../secret.txt', '/assets/..%2f..%2fsecret.txt', '/games/x/../../../secret.txt', '/games/..%2f..%2fsecret.txt',
      '/..%5csecret.txt', '/....//secret.txt', '//secret.txt', '/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/../../../../etc/passwd', '/..%2fdist-secrets.txt', '/../dist-secrets.txt',
      '/index.html%00.txt', '/secret.txt%00', '/%E0%A4%A', '/%', `/${'..%2f'.repeat(40)}etc/passwd`, `/${encodeURIComponent(path.join(root, 'secret.txt'))}`];
    for (const p of attempts) {
      const res = await rawGet(p);
      expect(res.status, p).toBeLessThan(500);
      expect(res.body, p).not.toContain(SECRET);
      expect(res.body, p).not.toContain('root:');
      if (/secret/.test(p)) expect(res.status, p).toBe(404);
    }
    // The same through HEAD and through the /games branch.
    expect((await rawGet('/../secret.txt', 'HEAD')).status).toBe(404);
    expect((await rawGet('/games/../../secret.txt')).body).not.toContain(SECRET);
  });
});

describe('admin endpoints', () => {
  const admin = (action, body, token) => fetch(`${base}/api/admin/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token !== undefined ? { 'x-admin-token': token } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body ?? {}) });

  it('need the token, exactly', async () => {
    for (const token of [undefined, '', 'wrong', ADMIN.slice(0, -1), `${ADMIN}x`, ADMIN.toUpperCase(), `x${ADMIN}`, 'undefined', 'null']) {
      for (const action of ['stats', 'setTier', 'feedback', 'respondFeedback', 'reports', 'waitlist', 'nope']) {
        const res = await admin(action, { user: 'x', tier: 'ceo' }, token);
        expect(res.status, `${action} with ${token}`).toBe(403);
        expect(await res.json()).toEqual({ error: 'Not allowed' });
      }
    }
    // A member's session is not an admin token.
    const m = await newMember('Notadmin');
    const res = await fetch(`${base}/api/admin/stats`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: m.cookie } });
    expect(res.status).toBe(403);
    expect((await fetch(`${base}/api/admin/stats`)).status).toBe(404); // GET is nothing
  });

  it('with the token: stats, setTier, feedback, and clean errors', async () => {
    const m = await newMember('Promoted');
    const stats = await admin('stats', {}, ADMIN);
    expect(stats.status).toBe(200);
    expect((await stats.json()).members).toBeGreaterThan(0);
    const set = await admin('setTier', { user: 'promoted', tier: 'vip' }, ADMIN);
    expect(await set.json()).toEqual({ username: 'promoted', tier: 'vip' });
    expect((await (await rpc('me', {}, { cookie: m.cookie })).json()).user.access.tier).toBe('vip');
    expect((await admin('setTier', { user: 'promoted', tier: 'emperor' }, ADMIN)).status).toBe(400);
    expect((await admin('setTier', { user: 'nobody', tier: 'vip' }, ADMIN)).status).toBe(404);
    expect((await admin('nope', {}, ADMIN)).status).toBe(404);
    await rpc('sendFeedback', { body: 'Works well', kind: 'general' }, { cookie: m.cookie });
    const fb = await (await admin('feedback', {}, ADMIN)).json();
    expect(fb.items[0]).toMatchObject({ body: 'Works well', by: 'promoted' });
    expect((await admin('respondFeedback', { id: fb.items[0].id, status: 'done', response: 'Thanks' }, ADMIN)).status).toBe(200);
    expect((await (await admin('reports', {}, ADMIN)).json()).items).toEqual([]);
    expect((await (await admin('waitlist', {}, ADMIN)).json()).items).toEqual([]);
    // A broken or non-object body is a 400/handled answer, never a 500.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const raw of ['{broken', 'null', '[]', '"x"', '5']) { const r = await admin('setTier', raw, ADMIN); expect(r.status, raw).toBeGreaterThanOrEqual(400); expect(r.status, raw).toBeLessThan(500); }
    for (const raw of ['null', '[]', '']) expect((await admin('stats', raw, ADMIN)).status, raw).toBe(200);
    quiet.mockRestore();
  });

  it('with no ADMIN_TOKEN configured, nothing is an admin, not even an empty header', async () => {
    const A = makeArena();
    const mw = arenaMiddleware(A, { distDir: dist, adminToken: '', production: false });
    for (const token of [undefined, '', 'undefined']) {
      const ctx = fakeCtx({ method: 'POST', path: '/api/admin/stats', headers: token === undefined ? {} : { 'x-admin-token': token }, body: '{}' });
      await mw(ctx.ctx, async () => {});
      expect(ctx.ctx.status).toBe(403);
    }
  });
});

describe('stripe webhook', () => {
  it('refuses anything unsigned', async () => {
    const res = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'customer.subscription.created', data: { object: { customer: null, status: 'active' } } }) });
    expect(res.status).toBe(400);
    const signed = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=abc' }, body: '{}' });
    expect(signed.status).toBe(400);
    expect(srv.A.c.users.count((u) => u.tier !== 'free' && !u.isArena && u.username !== 'promoted')).toBe(0);
  });
});

describe('realtime handshake', () => {
  const connect = (cookie) => new Promise((resolve) => {
    const s = ioClient(`${base}/arena`, { transports: ['websocket'], reconnection: false, forceNew: true, extraHeaders: cookie ? { Cookie: cookie } : {} });
    const timer = setTimeout(() => { s.close(); resolve({ ok: false, message: 'no answer' }); }, 4000);
    s.on('connect', () => { clearTimeout(timer); resolve({ ok: true, s }); });
    s.on('connect_error', (e) => { clearTimeout(timer); s.close(); resolve({ ok: false, message: e.message }); });
  });
  const sub = (s, id) => new Promise((resolve) => s.emit('sub', id, resolve));

  it('needs a session; a private table\'s room is for the people at it', async () => {
    expect(await connect(null)).toEqual({ ok: false, message: 'no session' });
    expect(await connect(`va_s=${'b'.repeat(64)}`)).toEqual({ ok: false, message: 'no session' });
    // A cookie that is not valid percent-encoding is "no session", not an exception inside socket.io.
    expect(await connect('va_s=%E0%A4%A')).toEqual({ ok: false, message: 'no session' });
    expect((await fetch(`${base}/healthz`)).status).toBe(200);

    const host = await newMember('Rthost'); const out = await newGuest();
    srv.A.admin.setTier('rthost', 'member');
    const priv = (await (await rpc('createTable', { gameId: 'fourinarow', visibility: 'private' }, { cookie: host.cookie })).json()).table;
    const pub = (await (await rpc('createTable', { gameId: 'fourinarow' }, { cookie: host.cookie })).json()).table;
    const h = await connect(host.cookie); const o = await connect(out.cookie);
    expect(h.ok && o.ok).toBe(true);
    try {
      expect(await sub(o.s, priv.id)).toBe(false);
      expect(await sub(o.s, 'nope')).toBe(false);
      expect(await sub(o.s, pub.id)).toBe(true);
      expect(await sub(h.s, priv.id)).toBe(true);
      // Chat at the private table reaches the host's socket and not the outsider's.
      const heardByOutsider = []; o.s.on('chat', (m) => heardByOutsider.push(m));
      const heard = new Promise((resolve) => h.s.on('chat', resolve));
      await rpc('sendChat', { id: priv.id, body: 'private words' }, { cookie: host.cookie });
      expect((await heard).body).toBe('private words');
      // A line at the public table reaches the outsider, so by the time it arrives the private one would have too.
      const publicLine = new Promise((resolve) => o.s.on('chat', resolve));
      await rpc('sendChat', { id: pub.id, body: 'public words' }, { cookie: host.cookie });
      expect((await publicLine).body).toBe('public words');
      expect(heardByOutsider.map((m) => m.body)).toEqual(['public words']);
    } finally { h.s.close(); o.s.close(); }
  });
});

describe('sockets opened by a page on another site', () => {
  // boardgame.io hands its `origins` list to socket.io under a key socket.io 4
  // does not read, so the list restricts nothing and any website could open
  // game and realtime sockets from its visitors' browsers.
  const open = (ns, origin, extra = {}) => new Promise((resolve) => {
    const s = ioClient(`${base}${ns}`, { transports: ['websocket'], reconnection: false, forceNew: true, extraHeaders: { ...(origin ? { Origin: origin } : {}), ...extra } });
    const timer = setTimeout(() => { s.close(); resolve('no answer'); }, 4000);
    s.on('connect', () => { clearTimeout(timer); s.close(); resolve('connected'); });
    s.on('connect_error', (e) => { clearTimeout(timer); s.close(); resolve(`refused: ${e.message}`); });
  });

  it('are refused in production; the site itself, its public address and non-browser clients are not', async () => {
    const own = base; // http://localhost:<port>, the same host the request is sent to
    expect(await open('/fourinarow', 'https://evil.example')).toMatch(/^refused/);
    expect(await open('/fourinarow', `http://localhost.evil.example:${srv.port}`)).toMatch(/^refused/);
    expect(await open('/fourinarow', 'null')).toMatch(/^refused/);
    expect(await open('/fourinarow', own)).toBe('connected');
    expect(await open('/fourinarow', null)).toBe('connected');
    // The configured public address, when a proxy has rewritten Host.
    expect(await open('/fourinarow', 'http://localhost')).toBe('connected');
    // X-Forwarded-Host proves nothing: a page elsewhere can send it on a polling request.
    expect(await open('/fourinarow', 'https://evil.example', { 'X-Forwarded-Host': 'evil.example' })).toMatch(/^refused/);

    const m = await newMember('Originpat');
    expect(await open('/arena', 'https://evil.example', { Cookie: m.cookie })).toMatch(/^refused/);
    expect(await open('/arena', own, { Cookie: m.cookie })).toBe('connected');
    // Long polling is checked the same way as a websocket.
    const poll = (origin) => fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: origin ? { Origin: origin } : {} }).then((r) => r.status);
    expect(await poll('https://evil.example')).toBe(403);
    expect(await poll(own)).toBe(200);
    // And the endpoint no longer tells browsers that any site may read it.
    const res = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: own } });
    expect(res.headers.get('access-control-allow-origin')).toBe(null);
  });
});

describe('boardgame.io game socket: a move belongs to the seat whose credentials came with it', () => {
  const GAME = 'fourinarow';
  const sockets = [];
  const gameSocket = () => new Promise((resolve, reject) => {
    const s = ioClient(`${base}/${GAME}`, { transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('connect', () => resolve(s)); s.on('connect_error', reject);
  });
  const settle = () => new Promise((r) => setTimeout(r, 120));
  /** What the official client sends for a move. */
  const move = (type, args, playerID, credentials) => ({ type: 'MAKE_MOVE', payload: { type, args, playerID, credentials } });
  /** Send something that must be refused, and give the server time to (not) act on it. */
  const send = async (s, action, id, claimed) => { s.emit('update', action, srv.A.bgio.state(id)._stateID, id, claimed); await settle(); };
  /** Send a legitimate move and wait for the server to apply it. */
  const sendOk = async (s, action, id, claimed) => {
    const before = srv.A.bgio.state(id)._stateID;
    s.emit('update', action, before, id, claimed);
    for (let i = 0; i < 250 && srv.A.bgio.state(id)._stateID === before; i++) await new Promise((r) => setTimeout(r, 20));
  };
  async function started() {
    const a = await newMember(`Al${Math.random().toString(36).slice(2, 8)}`); const b = await newMember(`Bo${Math.random().toString(36).slice(2, 8)}`);
    const t = (await (await rpc('createTable', { gameId: GAME }, { cookie: a.cookie })).json()).table;
    await rpc('joinTable', { id: t.id }, { cookie: b.cookie });
    await rpc('startTable', { id: t.id }, { cookie: a.cookie });
    const ca = (await (await rpc('seatAccess', { id: t.id }, { cookie: a.cookie })).json()).credentials;
    const cb = (await (await rpc('seatAccess', { id: t.id }, { cookie: b.cookie })).json()).credentials;
    return { a, b, id: t.id, ca, cb };
  }
  const state = (id) => srv.A.bgio.state(id);
  afterAll(() => { for (const s of sockets) s.close(); });

  it('the real client protocol works: each player moves their own seat with their own credentials', async () => {
    const { id, ca, cb } = await started();
    const s = await gameSocket();
    await sendOk(s, move('drop', [3], '0', ca), id, '0');
    expect(state(id)._stateID).toBe(1);
    expect(state(id).G.board[5 * 7 + 3]).toBe(0);
    await sendOk(s, move('drop', [3], '1', cb), id, '1');
    expect(state(id)._stateID).toBe(2);
    expect(state(id).G.board[4 * 7 + 3]).toBe(1);
  });

  it('the official boardgame.io client (the one the browser runs) syncs and moves through the guard', async () => {
    const { Client } = await import('boardgame.io/client');
    const { SocketIO } = await import('boardgame.io/multiplayer');
    const { fourInARow } = await import('../src/games/fourinarow/rules.js');
    const { id, ca, cb } = await started();
    const make = (playerID, credentials) => Client({ game: fourInARow, numPlayers: 2, matchID: id, playerID, credentials, multiplayer: SocketIO({ server: base, socketOpts: { transports: ['websocket'] } }), debug: false });
    const alice = make('0', ca); const bob = make('1', cb); const watcher = make(undefined, undefined);
    const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); return fn(); };
    try {
      alice.start(); bob.start(); watcher.start();
      expect(await until(() => [alice, bob, watcher].every((c) => { const st = c.getState(); return st && st.isConnected && st._stateID === 0; }))).toBe(true);
      alice.moves.drop(3);
      expect(await until(() => state(id)._stateID === 1)).toBe(true);
      bob.moves.drop(4);
      expect(await until(() => state(id)._stateID === 2)).toBe(true);
      expect(await until(() => watcher.getState()._stateID === 2)).toBe(true);
      expect(watcher.getState().G.board[5 * 7 + 3]).toBe(0);
      expect(watcher.getState().G.board[5 * 7 + 4]).toBe(1);
      // The watcher has no seat: calling a move from there changes nothing on the server.
      watcher.moves.drop(0);
      await settle();
      expect(state(id)._stateID).toBe(2);
    } finally { alice.stop(); bob.stop(); watcher.stop(); }
  });

  it('no credentials, wrong credentials, or the other seat\'s credentials: refused', async () => {
    const { id, ca, cb } = await started();
    const s = await gameSocket();
    for (const [claimed, creds] of [['0', undefined], ['0', ''], ['0', 'guess'], ['0', cb], [null, ca], [undefined, ca], ['2', ca], ['0', { $ne: null }]]) {
      await send(s, move('drop', [3], '0', creds), id, claimed);
      expect(state(id)._stateID, `claimed ${claimed} with ${JSON.stringify(creds)}`).toBe(0);
    }
    expect(ca).not.toBe(cb);
  });

  it('a player with valid credentials for their OWN seat cannot move, or resign, as another seat', async () => {
    const { a, b, id, cb } = await started();
    const s = await gameSocket();
    // boardgame.io checks Bob's credentials against the seat he CLAIMS (the 4th argument)
    // and then runs the move as the seat written inside the action.
    await send(s, move('drop', [3], '0', cb), id, '1');
    expect(state(id)._stateID).toBe(0);
    expect(state(id).G.board.every((c) => c === null)).toBe(true);
    await send(s, move('resign', [], '0', cb), id, '1');
    expect(state(id).G.over).toBe(null);
    expect(srv.A.c.tables.get(id).status).toBe('playing');
    expect(srv.A.c.results.count((r) => r.tableId === id)).toBe(0);
    expect(srv.A.user(b.user.id).stats.wins).toBe(0);
    expect(srv.A.user(a.user.id).reputation.score).toBe(100);
    // Variations on the same trick.
    for (const inner of [0, ' 0', '00', null, undefined, ['0'], { toString: 'x' }]) {
      await send(s, move('drop', [3], inner, cb), id, '1');
      expect(state(id)._stateID, JSON.stringify(inner)).toBe(0);
    }
  });

  it('a player cannot move as a bot seat', async () => {
    const g = await newGuest();
    const t = (await (await rpc('playBots', { gameId: GAME }, { cookie: g.cookie })).json()).table;
    const mine = (await (await rpc('seatAccess', { id: t.id }, { cookie: g.cookie })).json()).credentials;
    const s = await gameSocket();
    await send(s, move('resign', [], '1', mine), t.id, '0'); // "the bot resigns": an instant win
    expect(state(t.id).G.over).toBe(null);
    expect(srv.A.c.tables.get(t.id).status).toBe('playing');
  });

  it('boardgame.io events sent from a browser are ignored: nobody can end the game with a result of their choosing', async () => {
    const { b, id, cb } = await started();
    const s = await gameSocket();
    const event = (type, args) => ({ type: 'GAME_EVENT', payload: { type, args, playerID: '1', credentials: cb } });
    await send(s, event('endGame', [{ placements: [2, 1], reason: 'win' }]), id, '1');
    expect(state(id).ctx.gameover).toBeUndefined();
    expect(srv.A.c.tables.get(id).status).toBe('playing');
    expect(srv.A.c.results.count((r) => r.tableId === id)).toBe(0);
    expect(srv.A.user(b.user.id).stats.games).toBe(0);
    const ctx = JSON.stringify(state(id).ctx);
    for (const [type, args] of [['endTurn', []], ['endTurn', [{ next: '1' }]], ['setActivePlayers', [{ value: { 1: 'x' } }]], ['endPhase', []], ['setPhase', ['x']], ['pass', []], ['setStage', ['x']], ['endStage', []], ['constructor', []]]) {
      await send(s, event(type, args), id, '1');
      expect(JSON.stringify(state(id).ctx), type).toBe(ctx);
      expect(state(id)._stateID, type).toBe(0);
    }
    for (const type of ['UNDO', 'REDO', 'RESET', 'SYNC', 'UPDATE', 'PATCH', 'PLUGIN', 'STRIP_TRANSIENTS', undefined]) {
      await send(s, { type, payload: { type: 'drop', args: [3], playerID: '1', credentials: cb, state: { G: {}, ctx: { gameover: { placements: [2, 1] } } } } }, id, '1');
      expect(state(id)._stateID, String(type)).toBe(0);
      expect(state(id).ctx.gameover).toBeUndefined();
    }
    // Junk packets do not take the server down.
    for (const packet of [[], [null], ['x', 0, id, '1'], [{ type: 'MAKE_MOVE' }, 0, id, '1'], [{ type: 'MAKE_MOVE', payload: null }, 0, id, '1'], [move('drop', 'not-an-array', '1', cb), 0, id, '1']]) s.emit('update', ...packet);
    await settle();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect(srv.A.c.tables.get(id).status).toBe('playing');
  });

  it('a spectator can watch a public table and is sent no credentials and no initial state', async () => {
    const { id, ca, cb } = await started();
    const s = await gameSocket();
    const got = new Promise((resolve) => s.on('sync', (matchID, info) => resolve({ matchID, info })));
    s.emit('sync', id, null, undefined, 2);
    const { matchID, info } = await got;
    expect(matchID).toBe(id);
    expect(info.state.G.board).toHaveLength(42);
    expect(info.initialState.G).toEqual({});
    const text = JSON.stringify(info);
    expect(text).not.toContain(ca);
    expect(text).not.toContain(cb);
    expect(text).not.toContain('credentials');
    // Syncing to an id the arena never created stores nothing.
    const before = srv.store.col('bgio_meta').size;
    s.emit('sync', 'made-up-match', null, undefined, 2);
    await settle();
    expect(srv.store.col('bgio_meta').size).toBe(before);
  });

  it('syncing to a match that does not exist does no work at all (no session is needed to open this socket)', async () => {
    // boardgame.io builds a brand-new game "on demand" for an unknown id, with as many players as the
    // caller asks for, and sends it back. Asked for fifty million, that is the whole server's memory.
    const s = await gameSocket();
    const answers = [];
    s.on('sync', (matchID, info) => answers.push([matchID, info.state && info.state.ctx.numPlayers]));
    s.emit('sync', 'no-such-match', null, undefined, 3000);
    s.emit('sync', { not: 'a string' }, null, undefined, 3000);
    s.emit('sync');
    await settle(); await settle();
    expect(answers).toEqual([]);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });
});

describe('the middleware in production', () => {
  it('outside production the cookies are not Secure (plain http://localhost)', async () => {
    const mw = arenaMiddleware(makeArena(), { distDir: dist, adminToken: 'x', production: false });
    const { ctx, out } = fakeCtx({ method: 'POST', path: '/api/rpc/guest', headers: { 'content-type': 'application/json' }, body: '{}' });
    await mw(ctx, async () => {});
    expect(out['set-cookie'][0]).toMatch(/^va_s=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=15552000$/);
    expect(out['set-cookie'][1]).toBe('va_in=1; Path=/; SameSite=Lax; Max-Age=15552000');
  });

  it('marks both cookies Secure', async () => {
    const A = makeArena();
    const mw = arenaMiddleware(A, { distDir: dist, adminToken: 'x', production: true });
    const { ctx, out } = fakeCtx({ method: 'POST', path: '/api/rpc/guest', headers: { 'content-type': 'application/json' }, body: '{}' });
    await mw(ctx, async () => {});
    expect(ctx.status).toBe(200);
    expect(out['set-cookie']).toHaveLength(2);
    for (const c of out['set-cookie']) expect(c.endsWith('; Secure')).toBe(true);
    expect(out['set-cookie'][0]).toMatch(/HttpOnly; SameSite=Lax/);
    const token = /va_s=([0-9a-f]+)/.exec(out['set-cookie'][0])[1];
    const lo = fakeCtx({ method: 'POST', path: '/api/rpc/logout', headers: { 'content-type': 'application/json', cookie: `va_s=${token}` }, body: '{}' });
    await mw(lo.ctx, async () => {});
    for (const c of lo.out['set-cookie']) expect(c).toMatch(/Max-Age=0; Secure$/);
  });

  it('non-GET requests outside /api and /games fall through to the next middleware; GETs never do', async () => {
    const A = makeArena();
    const mw = arenaMiddleware(A, { distDir: dist, adminToken: 'x', production: false });
    let passed = 0;
    for (const [method, p, expected] of [['POST', '/somewhere', 1], ['POST', '/games/fourinarow/create', 0], ['DELETE', '/games', 0], ['GET', '/games/fourinarow', 0], ['GET', '/anything', 0], ['HEAD', '/x.js', 0], ['POST', '/api/unknown', 0]]) {
      passed = 0;
      const { ctx } = fakeCtx({ method, path: p });
      await mw(ctx, async () => { passed += 1; });
      expect(passed, `${method} ${p}`).toBe(expected);
    }
  });

  it('parseCookies never throws', () => {
    const plain = (header) => ({ ...parseCookies(header) });
    expect(plain('a=1; b=two; va_s=abc')).toEqual({ a: '1', b: 'two', va_s: 'abc' });
    expect(plain('a=hello%20world')).toEqual({ a: 'hello world' });
    expect(plain(undefined)).toEqual({});
    expect(plain('')).toEqual({});
    expect(() => parseCookies('va_s=%E0%A4%A; ok=1')).not.toThrow();
    expect(parseCookies('va_s=%E0%A4%A; ok=1').ok).toBe('1');
    expect(plain('noequals; =x; a=b=c')).toEqual({ a: 'b=c' });
    expect(parseCookies('va_s=first; va_s=second').va_s).toBe('first');
    // A cookie named like an Object.prototype member is just a name, and an absent one is absent.
    const odd = parseCookies('__proto__=x; constructor=y');
    expect(odd.constructor).toBe('y');
    expect(parseCookies('a=1').constructor).toBeUndefined();
    expect(parseCookies('a=1').toString).toBeUndefined();
    expect(({}).x).toBeUndefined();
  });
});

function fakeCtx({ method = 'GET', path: p, headers = {}, body = '' }) {
  const out = {};
  let status = 404; let payload;
  const ctx = {
    method, path: p, headers, ip: '198.51.100.7', req: Readable.from(body ? [Buffer.from(body)] : []), type: undefined, set: (k, v) => { out[k.toLowerCase()] = v; },
    get status() { return status; }, set status(v) { status = v; },
    get body() { return payload; }, set body(v) { payload = v; if (status === 404) status = 200; }, // as Koa does
  };
  return { ctx, out };
}

describe('rate limits behind a proxy', () => {
  it('TRUSTED_PROXY_HOPS=1: a made-up X-Forwarded-For entry does not buy a fresh allowance', async () => {
    const { startServer } = await import('../src/server/index.js');
    const { loadConfig } = await import('../src/server/config.js');
    expect(loadConfig({}).trustedProxyHops).toBe(0);
    expect(loadConfig({ TRUSTED_PROXY_HOPS: '2' }).trustedProxyHops).toBe(2);
    expect(loadConfig({ TRUSTED_PROXY_HOPS: 'lots' }).trustedProxyHops).toBe(0);
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    const second = await startServer({ port: 0, distDir: dist, adminToken: ADMIN, production: true, trustedProxyHops: 1, databaseUrl: '', dataFile: '', publicUrl: 'http://localhost', resendKey: '' });
    quiet.mockRestore();
    try {
      const call = (forged) => fetch(`http://127.0.0.1:${second.port}/api/rpc/guest`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `${forged}, 198.51.100.77` }, body: '{}' });
      const statuses = [];
      for (let i = 0; i < GUESTS_PER_HOUR + 2; i++) statuses.push((await call(`10.9.${i >> 8}.${i & 255}`)).status);
      expect(statuses.slice(0, GUESTS_PER_HOUR).every((x) => x === 200)).toBe(true);
      expect(statuses.slice(GUESTS_PER_HOUR)).toEqual([429, 429]); // the cap applies to the address the proxy saw
    } finally { await second.stop(); }
  });
});

describe('a member registered over HTTP', () => {
  it('can do the whole first-visit journey with nothing but the cookie', async () => {
    const m = await newMember('Journey');
    const table = (await (await rpc('playBots', { gameId: 'fourinarow' }, { cookie: m.cookie })).json()).table;
    expect(table.status).toBe('playing');
    const access = await (await rpc('seatAccess', { id: table.id }, { cookie: m.cookie })).json();
    expect(access.playerID).toBe('0');
    expect(access.credentials).toBeTruthy();
    // Another visitor gets no credentials for that table: it is private.
    const other = await newGuest();
    const peek = await rpc('seatAccess', { id: table.id }, { cookie: other.cookie });
    expect(peek.status).toBe(403);
    expect(await peek.text()).not.toContain(access.credentials);
    await member(srv.A, 'Inproc'); // the in-process helpers work on the same arena
    expect(srv.A.c.users.find((u) => u.username === 'inproc')).toBeTruthy();
  });
});
