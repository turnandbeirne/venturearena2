// The arena's shared context: collections, clock, ids, errors, tier checks.
// Every arena module is `install(A)`: it adds functions to A and handlers to
// A.rpc. One object, no framework, so a test can build an arena in a line.
import crypto from 'node:crypto';
import { TIER_RANK, tierAllows } from '../../shared/tiers.js';

export class ArenaError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export const ARENA_USER_ID = 'arena';   // the arena's own voice in the Inbox

export function createContext({ store, config = {}, now = () => Date.now(), emit = () => {}, mailer = null }) {
  const A = {
    store, config, now, mailer,
    rpc: {},          // name -> handler(me, args, req)
    publicRpc: new Set(), // handlers that work without a session
    emit,             // (room, event, payload) -> realtime
    hooks: {},        // filled by modules that others call into
    err: (message, status = 400) => new ArenaError(message, status),
    id: () => crypto.randomUUID(),
    code: (n = 8, alphabet = '0123456789abcdef') => {
      const bytes = crypto.randomBytes(n);
      let out = '';
      for (let i = 0; i < n; i++) out += alphabet[bytes[i] % alphabet.length];
      return out;
    },
    /** UTC calendar day, the unit every daily rhythm uses. */
    day: (ts) => new Date(ts ?? now()).toISOString().slice(0, 10),
    c: {
      users: store.col('users'),
      sessions: store.col('sessions'),
      tables: store.col('tables'),
      messages: store.col('messages'),
      results: store.col('results'),
      ratings: store.col('ratings'),
      connections: store.col('connections'),
      introductions: store.col('introductions'),
      challenges: store.col('challenges'),
      invites: store.col('invites'),
      feedback: store.col('feedback'),
      peerFeedback: store.col('peer_feedback'),
      debriefs: store.col('debriefs'),
      points: store.col('points'),
      topicReplies: store.col('topic_replies'),
      quizAnswers: store.col('quiz_answers'),
      mixerSeen: store.col('mixer_seen'),
      opportunities: store.col('opportunities'),
      reports: store.col('reports'),
      photos: store.col('photos'),
      waitlist: store.col('waitlist'),
    },
  };

  /** The tier a member actually has right now (a lapsed plan is Registered). */
  A.tier = (user) => {
    if (!user || user.isGuest) return 'anonymous';
    if (user.tierExpiresAt && user.tierExpiresAt < now()) return 'free';
    // Own keys only, and never "anonymous" for an account. (Bug: the lookup
    // was `TIER_RANK[user.tier] !== undefined`, so a stored tier of
    // "__proto__" or "constructor" came back as the tier and every table
    // keyed by tier, the host limit included, answered with an object.)
    return Object.prototype.hasOwnProperty.call(TIER_RANK, user.tier) && user.tier !== 'anonymous' ? user.tier : 'free';
  };
  A.allows = (user, feature) => tierAllows(A.tier(user), feature);
  A.need = (user, feature, message) => {
    if (!A.allows(user, feature)) throw A.err(message || 'That needs a higher membership.', 403);
  };
  A.user = (id) => A.c.users.get(id);
  A.mustUser = (id) => { const u = A.c.users.get(id); if (!u) throw A.err('No such member', 404); return u; };

  /** Small fixed-window limiter. Keys are free-form ("login:1.2.3.4"). */
  const buckets = new Map();
  A.limit = (key, max, windowMs) => {
    const t = now();
    const b = buckets.get(key);
    if (!b || t - b.start > windowMs) { buckets.set(key, { start: t, n: 1 }); return; }
    b.n += 1;
    if (b.n > max) throw A.err('Slow down a little and try again in a minute.', 429);
  };
  A.sweepLimiter = () => { const t = now(); for (const [k, b] of buckets) if (t - b.start > 3600000) buckets.delete(k); };

  /** A note from the arena itself, delivered to a member's Inbox. */
  A.notify = (userId, body) => {
    const msg = { id: A.id(), fromId: ARENA_USER_ID, toId: userId, body, at: now() };
    A.c.messages.put(msg);
    A.emit(`u:${userId}`, 'inbox', { kind: 'note' });
    return msg;
  };

  return A;
}

/** Trim, collapse and cap a piece of user text. */
export function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}
export function cleanList(value, maxItems, maxLen, allowed = null) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const v of value) {
    const s = clean(String(v), maxLen);
    if (!s || out.includes(s)) continue;
    if (allowed && !allowed.includes(s)) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}
