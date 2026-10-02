// VentureArena: ONE Node server. Landing page, lobby, game tables, chat and
// bots all live in this process.
//
// Run exactly one replica. Live game state, turn timers and bot timers are in
// this process's memory; a second replica would have its own copy of each
// table and the two would disagree. The database makes a restart safe, not a
// second copy. The ingress in front of it must pass WebSockets.
import { Server, Origins, SocketIO } from 'boardgame.io/server';
import { loadConfig } from './config.js';
import { createStore } from './store/index.js';
import { createBgio, guardGameSockets } from './bgio.js';
import { createArena } from './arena/index.js';
import { arenaMiddleware, parseCookies, COOKIE } from './http.js';
import { attachRealtime } from './realtime.js';
import { GAMES } from '../games/registry.js';

function makeMailer(config) {
  if (!config.resendKey) return null;
  return async ({ to, subject, text, html }) => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.mailFrom, to: [to], subject, text, html }),
    });
    if (!res.ok) throw new Error(`mail provider answered ${res.status}`);
  };
}

/**
 * Which browsers may open a socket: pages of this site, nobody else's.
 *
 * (Bug: boardgame.io passes its `origins` list to socket.io as `cors.origins`,
 * a key socket.io 4 does not read, so the list restricted nothing and the
 * socket endpoint answered `Access-Control-Allow-Origin: *`. Any website could
 * open game and realtime sockets from its visitors' browsers.)
 *
 * A browser always says which page opened the socket (Origin) and cannot lie
 * about it. The page is ours when its host is the host this request was sent
 * to, or the configured public address. A request with no Origin is not a
 * browser (tests, tools); it gets no more than a browser would. X-Forwarded-Host
 * is deliberately not consulted: a page elsewhere can set it on a polling request.
 */
export function socketGate(config) {
  const hostOf = (url) => { try { return new URL(url).host.toLowerCase(); } catch { return null; } };
  const extra = new Set([config.publicUrl, ...(config.allowedOrigins || [])].map(hostOf).filter(Boolean));
  return (req, done) => {
    if (!config.production) return done(null, true); // development: Vite serves the page from another port
    const origin = req.headers.origin;
    if (origin === undefined) return done(null, true);
    const host = hostOf(origin);
    const ok = !!host && (host === String(req.headers.host || '').toLowerCase() || extra.has(host));
    return done(null, ok);
  };
}

export async function startServer(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const { store, loaded, kind } = await createStore(config);
  config.storeKind = kind;
  const bgio = createBgio({ store });
  const A = createArena({ store, config, bgio, mailer: makeMailer(config) });

  const server = Server({
    games: Object.values(GAMES).map((g) => g.rules),
    db: bgio.db,
    origins: [config.publicUrl, Origins.LOCALHOST_IN_DEVELOPMENT].filter(Boolean),
    // Every move sends the table's whole state to every browser. For a game
    // with a large state (VentureFlow grows past 150 KB) that measured 59 MB
    // per browser per game; compressed it is about 10 MB at ~1 ms a message.
    // The app is served from the same address as its sockets, so no page
    // needs cross-origin access: no CORS headers, and socketGate on top.
    transport: new SocketIO({ socketOpts: { perMessageDeflate: { threshold: 2048 }, cors: { origin: false }, allowRequest: socketGate(config) } }),
  });
  bgio.attachTransport(server.transport);
  // Before the server listens, so no socket ever exists without it.
  const mayWatch = (matchID, socket) => {
    const t = A.c.tables.get(matchID);
    if (!t) return false;
    if (t.visibility !== 'private') return true;
    const u = A.userForToken(parseCookies(socket.handshake.headers.cookie)[COOKIE]);
    return !!u && A.isAtTable(t, u.id);
  };
  guardGameSockets(server.app._io, Object.values(GAMES).map((g) => g.rules.name), bgio.db, mayWatch);
  server.app.proxy = config.production; // trust X-Forwarded-* from the host's proxy
  if (config.trustedProxyHops > 0) server.app.maxIpsCount = config.trustedProxyHops; // see config.js
  server.app.use(arenaMiddleware(A, config));

  const running = await server.run({ port: config.port });
  attachRealtime(server.app._io, A);

  const resumed = A.resumeMatches();
  const sweep = setInterval(() => { A.sweepTables().catch((e) => console.error('[sweep]', e.message)); A.sweepLimiter(); }, 5000);
  sweep.unref();

  console.log(`VentureArena on ${config.publicUrl} (port ${config.port}) | storage: ${kind}, ${loaded} documents loaded | ${Object.keys(GAMES).length} games | ${resumed} live tables resumed`);
  if (kind === 'memory') console.log('Storage is in memory: everything is lost on restart. Set DATABASE_URL (or DATA_FILE) to keep it.');

  const stop = async () => {
    clearInterval(sweep);
    A.stopRunner();
    server.kill(running);
    await store.close();
  };
  return { A, config, store, server, stop, port: running.appServer.address().port };
}

// Started directly (node build/server.cjs), not imported by a test.
if (process.env.VA_NO_AUTOSTART !== '1') {
  startServer().then(({ stop }) => {
    let closing = false;
    const shutdown = (signal) => {
      if (closing) return; closing = true;
      console.log(`${signal}: saving and shutting down`);
      stop().catch((e) => console.error(e)).finally(() => process.exit(0));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }).catch((e) => { console.error('Failed to start:', e); process.exit(1); });
}
