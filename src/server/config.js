// Every setting comes from the environment (see .env.example). Nothing here
// reads a file: secrets live in the host's dashboard, never in the repo.
export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 8000);
  const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  return {
    port,
    production: env.NODE_ENV === 'production',
    // Render and Railway both tell the app its own address; PUBLIC_URL wins when set.
    publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '') || `http://localhost:${port}`).replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL || '',
    // Keep the one table in a schema of its own, so the database can be
    // shared with another application without the two ever meeting.
    databaseSchema: String(env.DATABASE_SCHEMA || '').trim(),
    dataFile: env.DATA_FILE || '',
    distDir: env.DIST_DIR || 'dist',
    adminToken: env.ADMIN_TOKEN || '',
    // A playtest or staging copy: tell search engines to stay away, so it
    // never competes with the real site for the same pages.
    noindex: env.NOINDEX === '1',
    // Extra site addresses whose pages may open sockets here (comma separated),
    // for a proxy that rewrites the Host header. See index.js socketGate.
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean),
    // How many proxies sit between the internet and this process. In
    // production the client address is read from X-Forwarded-For, and by
    // default from its FIRST entry, which is whatever the caller typed: the
    // per-address rate limits (guest, register, login) can then be dodged by
    // sending a different made-up address each time. Set this to the number
    // of proxies your host really has (usually 1) and the address is taken
    // that many entries from the END of the header instead, which only the
    // proxies can write. Unset (0) keeps the old behaviour, because a wrong
    // number here would put every visitor behind one address.
    trustedProxyHops: Math.max(0, Math.floor(num(env.TRUSTED_PROXY_HOPS, 0))),
    stripe: {
      secret: env.STRIPE_SECRET_KEY || '',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      prices: { member: env.PRICE_MEMBER || '', vip: env.PRICE_VIP || '', ceo: env.PRICE_CEO || '' },
    },
    // The AI guides (server/arena/guides.js). No key: they show as "coming soon".
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    guideModel: String(env.GUIDE_MODEL || '').trim(),
    // The most messages the whole site may send to the guides in one day: a hard ceiling on the bill.
    guideSiteDailyCap: Math.max(0, Math.floor(num(env.GUIDE_SITE_DAILY_CAP, 3000))),
    // A canned stand-in for the browser tests. Ignored unless NODE_ENV is "test".
    guidesFake: env.NODE_ENV === 'test' && env.COACH_FAKE === '1',
    resendKey: env.RESEND_API_KEY || '',
    mailFrom: env.MAIL_FROM || 'VentureArena <arena@venturemaker.org>',
    gateCustomSettings: env.GATE_CUSTOM_SETTINGS === '1',
    botDelayMs: [num(env.BOT_DELAY_MIN_MS, 500), num(env.BOT_DELAY_MAX_MS, 1100)],
    instantBots: env.INSTANT_BOTS === '1',
    quickMatchBotAfterMs: num(env.QUICK_MATCH_BOT_AFTER_MS, 20000),
    idleTakeoverMs: num(env.IDLE_TAKEOVER_MS, 180000),
    wipeMatchAfterMs: num(env.WIPE_MATCH_AFTER_MS, 600000),
  };
}
