// HTTP: one Koa middleware in front of boardgame.io's own router.
//
//   POST /api/rpc/<name>      every arena action (JSON in, JSON out)
//   GET  /api/photo/<id>      member photos
//   POST /api/stripe/webhook  billing (raw body, signature-checked)
//   POST /api/admin/<action>  operator tools (x-admin-token)
//   GET  /healthz
//   GET  /games/...           static SEO pages built by scripts/build-seo.mjs
//   GET  anything else        static files, then the app shell
//
// /games is answered here and never falls through: boardgame.io mounts its
// own lobby REST API on /games/*, which would let anyone create matches.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ArenaError } from './arena/context.js';

const COOKIE = 'va_s';
const MARKER = 'va_in'; // readable by the landing page: "this browser has a session"
const MAX_BODY = 256 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };

/**
 * Never throws: a cookie that is not valid percent-encoding is kept as sent.
 * (Bug: decodeURIComponent threw on `va_s=%E0%A4%A`. On an API call that was
 * a 500 instead of "no session". On the realtime handshake (realtime.js) it
 * was an unhandled rejection inside socket.io, which stops a Node process:
 * one request, no session needed, and every live table was gone.)
 */
export function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    if (!name || name in out) continue; // first one wins, as browsers send the most specific first
    try { out[name] = decodeURIComponent(raw); } catch { out[name] = raw; }
  }
  return out;
}

/** Compare two secrets without telling the caller how many characters matched. */
function sameSecret(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new ArenaError('Request too large', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function arenaMiddleware(A, config) {
  const dist = path.resolve(config.distDir);
  const secure = config.production ? '; Secure' : '';
  const sessionCookie = (token) => [
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${180 * 86400}${secure}`,
    `${MARKER}=1; Path=/; SameSite=Lax; Max-Age=${180 * 86400}${secure}`,
  ];
  const clearCookie = () => [`${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`, `${MARKER}=; Path=/; SameSite=Lax; Max-Age=0${secure}`];

  function sendFile(ctx, file, { cache = 'no-cache', status = 200 } = {}) {
    ctx.status = status;
    ctx.type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    ctx.set('Cache-Control', cache);
    ctx.body = fs.createReadStream(file);
  }
  function resolveStatic(urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch { return null; }
    const file = path.join(dist, rel);
    // Never serve anything outside the build directory.
    if (file !== dist && !file.startsWith(dist + path.sep)) return null;
    try {
      const st = fs.statSync(file);
      if (st.isFile()) return file;
      if (st.isDirectory()) { const idx = path.join(file, 'index.html'); if (fs.existsSync(idx)) return idx; }
    } catch { /* not there */ }
    return null;
  }

  return async function arena(ctx, next) {
    const p = ctx.path;
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    ctx.set('X-Frame-Options', 'SAMEORIGIN');
    if (config.noindex) {
      ctx.set('X-Robots-Tag', 'noindex, nofollow');
      if (p === '/robots.txt') { ctx.type = 'text/plain; charset=utf-8'; ctx.body = 'User-agent: *\nDisallow: /\n'; return; }
    }

    if (p === '/healthz') { ctx.body = { ok: true, store: config.storeKind, guides: config.anthropicApiKey || config.guidesFake ? 'on' : 'off', uptime: Math.round(process.uptime()) }; return; }

    // ---- API -----------------------------------------------------------------
    if (p.startsWith('/api/')) {
      ctx.set('Cache-Control', 'no-store');
      const token = parseCookies(ctx.headers.cookie)[COOKIE] || null;
      try {
        if (p.startsWith('/api/rpc/') && ctx.method === 'POST') {
          // JSON-only keeps cross-site form posts out: a form cannot send this
          // content type, and the cookie is SameSite=Lax on top.
          if (!/^application\/json\s*(;|$)/i.test(ctx.headers['content-type'] || '')) throw new ArenaError('Send JSON', 415);
          const raw = await readBody(ctx.req);
          let args = {};
          if (raw) { try { args = JSON.parse(raw); } catch { throw new ArenaError('Body must be JSON', 400); } }
          // Handlers read named fields: anything that is not an object has none.
          if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
          const me = A.userForToken(token);
          const result = (await A.call(p.slice('/api/rpc/'.length), me, args, { ip: ctx.ip, token })) || {};
          const { setSession, clearSession, ...body } = result;
          if (setSession) ctx.set('Set-Cookie', sessionCookie(setSession));
          if (clearSession) ctx.set('Set-Cookie', clearCookie());
          ctx.body = body;
          return;
        }
        if (p.startsWith('/api/photo/') && ctx.method === 'GET') {
          const ph = A.photo(p.slice('/api/photo/'.length));
          if (!ph) { ctx.status = 404; return; }
          ctx.type = ph.type; ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
          ctx.body = Buffer.from(ph.b64, 'base64');
          return;
        }
        if (p === '/api/stripe/webhook' && ctx.method === 'POST') {
          ctx.body = await A.stripeWebhook(await readBody(ctx.req), ctx.headers['stripe-signature']);
          return;
        }
        if (p.startsWith('/api/admin/') && ctx.method === 'POST') {
          // Constant-time: `!==` on strings stops at the first different
          // character, which lets a patient caller measure its way to the token.
          if (!sameSecret(ctx.headers['x-admin-token'], config.adminToken)) throw new ArenaError('Not allowed', 403);
          const raw = await readBody(ctx.req);
          // (Bug: a body that was not JSON, or was `null`, was a TypeError and a 500.)
          let args = {};
          if (raw) { try { args = JSON.parse(raw); } catch { throw new ArenaError('Body must be JSON', 400); } }
          if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
          const action = p.slice('/api/admin/'.length);
          if (action === 'setTier') ctx.body = A.admin.setTier(args.user, args.tier);
          else if (action === 'feedback') ctx.body = { items: A.admin.feedback(args.status) };
          else if (action === 'respondFeedback') ctx.body = A.admin.respondFeedback(args.id, args.status, args.response);
          else if (action === 'resetLink') ctx.body = A.admin.resetLink(args.user);
          else if (action === 'reports') ctx.body = { items: A.admin.reports() };
          else if (action === 'waitlist') ctx.body = { items: A.admin.waitlist() };
          else if (action === 'stats') ctx.body = A.admin.stats();
          else throw new ArenaError('Unknown admin action', 404);
          return;
        }
        throw new ArenaError('Not found', 404);
      } catch (e) {
        if (e instanceof ArenaError) { ctx.status = e.status; ctx.body = { error: e.message }; return; }
        console.error('[api]', p, e);
        ctx.status = 500; ctx.body = { error: 'Something went wrong on our side. Try again.' };
        return;
      }
    }

    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      if (p === '/games' || p.startsWith('/games/')) { ctx.status = 404; ctx.body = 'Not found'; return; }
      return next();
    }

    // ---- static files, SEO pages, app shell ----------------------------------------
    const file = resolveStatic(p === '/' ? '/landing.html' : p);
    if (file) {
      sendFile(ctx, file, { cache: p.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      return;
    }
    if (p === '/games' || p.startsWith('/games/')) {
      const nf = resolveStatic('/404.html');
      if (nf) sendFile(ctx, nf, { status: 404 }); else { ctx.status = 404; ctx.body = 'Not found'; }
      return;
    }
    // A path with an extension that is not on disk is a missing file, not a page.
    if (path.extname(p)) { ctx.status = 404; ctx.body = 'Not found'; return; }
    const shell = resolveStatic('/index.html');
    if (shell) { sendFile(ctx, shell); return; }
    ctx.status = 503;
    ctx.body = 'VentureArena is running, but the web app has not been built. Run "npm run build".';
  };
}

export { COOKIE };
