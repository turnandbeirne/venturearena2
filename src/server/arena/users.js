// Identity: guests, accounts, sessions, profiles, the access ladder, points
// and streaks.
//
// The ladder (who can do what before paying anything):
//   anonymous   one click, no form: play, chat at the table, quiz, check-in
//   unverified  has an email; keeps history under a name
//   verified    confirmed the email
//   member-ready verified AND profile >= 70%: sees bios, gets matched, connects
// Paid tiers (shared/tiers.js) sit on top of that and are independent of it.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { clean, cleanList, ARENA_USER_ID } from './context.js';
import { FEATURES, HOST_LIMIT, tierAllows } from '../../shared/tiers.js';
import {
  ARCHETYPE_IDS, STAGES, INTENTS, OFFERS, INTEREST_TAGS, COLORS, AVATARS, SOCIAL_KEYS, PROMPTS, SCENARIOS,
  scoreCardSort, surveyScore, guestName, isGuestName, surveyBonusTier, SURVEY_BONUS_TOTAL, PROFILE_GATE, arenaRank, POINTS, stageNum,
} from '../../shared/profile.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 180;
export const GUESTS_PER_HOUR = 300;
const ONLINE_MS = 3 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1: read aloud without mistakes

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 32);
  return { salt, hash: key.toString('hex') };
}
async function checkPassword(password, pass) {
  if (!pass) return false;
  const { hash } = await hashPassword(password, pass.salt);
  const a = Buffer.from(hash, 'hex'); const b = Buffer.from(pass.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const tokenId = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function install(A) {
  const { users, sessions, points, photos } = A.c;

  // ---- the arena's own account and the house bots -------------------------------
  if (!users.get(ARENA_USER_ID)) {
    users.put({ id: ARENA_USER_ID, username: 'venturearena', displayName: 'VentureArena', avatar: '\u{1F3DF}', isArena: true, isBot: true, tier: 'ceo', createdAt: A.now() });
  }

  function newUser(fields) {
    const id = A.id();
    const u = {
      id,
      username: `guest_${id.replace(/-/g, '').slice(0, 6)}`,
      displayName: guestName(id),
      email: null, pass: null, isGuest: true, emailVerified: false,
      tier: 'free', tierExpiresAt: null, stripeCustomerId: null,
      avatar: AVATARS[parseInt(id.replace(/-/g, '').slice(0, 6), 16) % 12],
      photoId: null, colorRanks: [],
      archetype: null, dna: {}, stage: null, industry: '', headline: '', lookingFor: '', goals: '', currentProject: '',
      skills: [], interests: [], intent: [], offers: [], socialLinks: {}, bio: '', prompts: [],
      city: '', region: '', shareLocation: false, loc: null, phone: '', timezone: '',
      openToMentoring: 0, surveyScore: 0, surveyBonus: 0, onboardedAt: null,
      streak: 0, streakDay: null, points: 0,
      reputation: { score: 100, abandons: 0, kudos: 0, vouches: 0, debriefs: 0 },
      chips: {}, stats: { games: 0, wins: 0, best: 1200, avg: 1200 },
      persona: null, playStyle: null,
      referralCode: null, referredBy: null,
      lastSeenAt: A.now(), createdAt: A.now(),
      ...fields,
    };
    users.put(u);
    return u;
  }
  A.newUser = newUser;

  function startSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.put({ id: tokenId(token), userId: user.id, createdAt: A.now(), seenAt: A.now() });
    return token;
  }
  /** Resolve a cookie token to a user, or null. */
  A.userForToken = (token) => {
    if (!token || typeof token !== 'string') return null;
    const s = sessions.get(tokenId(token));
    if (!s) return null;
    if (A.now() - s.createdAt > SESSION_DAYS * 86400000) { sessions.delete(s.id); return null; }
    return users.get(s.userId) || null;
  };

  // ---- access ---------------------------------------------------------------------
  A.canSeeBios = (u) => !!u && !u.isGuest && u.emailVerified && (u.surveyScore || 0) >= PROFILE_GATE;
  A.access = (u) => {
    const tier = A.tier(u);
    const level = u.isGuest ? 'anonymous' : !u.emailVerified ? 'unverified' : (u.surveyScore || 0) < PROFILE_GATE ? 'verified' : 'ready';
    const features = {};
    for (const f of Object.keys(FEATURES)) features[f] = tierAllows(tier, f);
    // Fine-grained game settings stay open to everyone until billing is live,
    // so nobody meets a paywall they cannot pay (GATE_CUSTOM_SETTINGS=1 turns it on).
    if (!A.config.gateCustomSettings) features.custom_settings = true;
    return { tier, level, canSeeBios: A.canSeeBios(u), surveyScore: u.surveyScore || 0, features, hostLimit: HOST_LIMIT[tier] };
  };
  A.isOnline = (u) => !!u && A.now() - (u.lastSeenAt || 0) < ONLINE_MS;

  // ---- points and streak -------------------------------------------------------------
  /** Award points. `once` makes the award unique per (user, kind, once-key). */
  A.award = (user, kind, amount, { ref = null, once = null } = {}) => {
    if (!amount) return false;
    const id = once ? `${user.id}:${kind}:${once}` : A.id();
    if (once && points.get(id)) return false;
    points.put({ id, userId: user.id, kind, points: amount, ref, day: A.day(), at: A.now() });
    user.points = (user.points || 0) + amount;
    users.put(user);
    return true;
  };

  function recomputeSurvey(u) {
    u.surveyScore = surveyScore(u);
    const tier = surveyBonusTier(u.surveyScore);
    let bonus = 0;
    // Paid once per tier, never clawed back, never to guests.
    if (!u.isGuest && tier > (u.surveyBonus || 0)) {
      bonus = SURVEY_BONUS_TOTAL[tier] - SURVEY_BONUS_TOTAL[u.surveyBonus || 0];
      u.surveyBonus = tier;
      users.put(u);
      A.award(u, 'survey', bonus);
    }
    users.put(u);
    return bonus;
  }
  A.recomputeSurvey = recomputeSurvey;

  // ---- views ---------------------------------------------------------------------------
  function photoUrl(u) { return u.photoId ? `/api/photo/${u.photoId}` : null; }

  /** What one member may see of another. */
  A.card = (u, viewer) => {
    if (!u) return null;
    const self = viewer && viewer.id === u.id;
    const bios = self || A.canSeeBios(viewer);
    const style = self || A.allows(viewer, 'view_style');
    const tier = A.tier(u);
    const card = {
      id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, photo: photoUrl(u),
      tier, isGuest: !!u.isGuest, isBot: !!u.isBot, verified: !!u.emailVerified,
      archetype: u.archetype, stage: u.stage, intent: u.intent || [], offers: u.offers || [], interests: u.interests || [],
      colorRanks: u.colorRanks || [], rating: u.stats ? u.stats.avg : 1200, games: u.stats ? u.stats.games : 0, wins: u.stats ? u.stats.wins : 0,
      reputation: u.reputation ? u.reputation.score : 100, kudos: u.reputation ? u.reputation.kudos : 0, vouches: u.reputation ? u.reputation.vouches : 0,
      chips: u.chips || {}, personaLabel: u.persona ? u.persona.label : null,
      rank: arenaRank({ rating: u.stats ? u.stats.best : 1200, games: u.stats ? u.stats.games : 0, points: u.points || 0 }),
      mentor: (u.offers || []).includes('mentoring') && (u.openToMentoring || 0) > 0,
      investor: (u.offers || []).includes('investing'),
      online: A.isOnline(u), lastSeenAt: u.lastSeenAt, createdAt: u.createdAt, onboarded: !!u.onboardedAt,
      locked: !bios,
    };
    if (bios) {
      Object.assign(card, {
        headline: u.headline, industry: u.industry, lookingFor: u.lookingFor, goals: u.goals, currentProject: u.currentProject,
        skills: u.skills || [], socialLinks: u.socialLinks || {}, bio: u.bio, prompts: u.prompts || [],
        city: u.shareLocation ? u.city : '', region: u.shareLocation ? u.region : '',
      });
    }
    if (style) {
      card.dna = u.dna || {};
      card.persona = u.persona || null;
      card.playStyle = u.playStyle || null;
    }
    return card;
  };

  /** Everything a member may see of themselves. Never includes secrets. */
  A.selfView = (u) => {
    const { pass, verifyToken, reset, loc, ...rest } = u; // eslint-disable-line no-unused-vars
    return { ...rest, photo: photoUrl(u), hasLocation: !!loc, access: A.access(u), card: A.card(u, u) };
  };

  // ---- sessions ----------------------------------------------------------------------------
  A.publicRpc.add('guest');
  A.rpc.guest = (me, args, req) => {
    if (me) return { user: A.selfView(me) };
    // Roomy on purpose: a classroom or an event arrives from one address.
    A.limit(`guest:${req.ip}`, GUESTS_PER_HOUR, 3600000);
    const u = newUser({});
    return { user: A.selfView(u), setSession: startSession(u) };
  };

  A.publicRpc.add('register');
  A.rpc.register = async (me, args, req) => {
    A.limit(`register:${req.ip}`, 10, 3600000);
    const email = clean(args.email, 254).toLowerCase();
    const password = typeof args.password === 'string' ? args.password : '';
    if (!EMAIL_RE.test(email)) throw A.err('That does not look like an email address.');
    if (password.length < 8) throw A.err('Use a password of at least 8 characters.');
    if (users.find((x) => x.email === email)) throw A.err('There is already an account with that email. Sign in instead.');
    // A guest upgrades IN PLACE: same id, so tables, rating, streak and
    // connections all carry over. Creating a second user here is the bug
    // that loses a new member's first game.
    const u = me && me.isGuest ? me : newUser({});
    u.email = email;
    u.pass = await hashPassword(password);
    u.isGuest = false;
    u.registeredAt = A.now();
    const name = clean(args.displayName, 40);
    if (name) u.displayName = name;
    else if (isGuestName(u.displayName)) u.displayName = email.split('@')[0].slice(0, 40);
    if (/^guest_/.test(u.username)) u.username = uniqueUsername(u.displayName, u.id);
    u.verifyToken = crypto.randomBytes(24).toString('hex');
    u.emailVerified = false;
    users.put(u);
    await sendVerification(u);
    recomputeSurvey(u);
    if (args.ref) claimReferral(u, args.ref);
    // A fresh session either way: the cookie a browser held as a guest should
    // not stay valid for the account it has just become.
    if (req && req.token) sessions.delete(tokenId(req.token));
    return { user: A.selfView(u), setSession: startSession(u) };
  };

  A.publicRpc.add('login');
  A.rpc.login = async (me, args, req) => {
    A.limit(`login:${req.ip}`, 12, 600000);
    const email = clean(args.email, 254).toLowerCase();
    const u = users.find((x) => x.email === email);
    if (!u || !(await checkPassword(String(args.password || ''), u.pass))) throw A.err('Email or password is not right.', 401);
    return { user: A.selfView(u), setSession: startSession(u) };
  };

  A.rpc.logout = (me, args, req) => {
    if (req.token) sessions.delete(tokenId(req.token));
    return { clearSession: true };
  };

  A.publicRpc.add('me');
  A.rpc.me = (me) => ({ user: me ? A.selfView(me) : null });

  function uniqueUsername(base, id) {
    let stem = clean(base, 24).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'player';
    if (stem.length < 3) stem = `${stem}_player`;
    let name = stem; let n = 1;
    while (users.find((x) => x.username === name && x.id !== id)) name = `${stem}${++n}`;
    return name;
  }

  async function sendVerification(u) {
    const link = `${A.config.publicUrl || ''}/verify?token=${u.verifyToken}`;
    if (A.mailer) {
      try {
        await A.mailer({ to: u.email, subject: 'Confirm your email for VentureArena', text: `Welcome to VentureArena. Confirm your email to keep your record and unlock introductions:\n\n${link}\n` });
      } catch (e) { console.error('[mail] verification failed:', e.message); }
    } else {
      // No mail provider configured: there is nobody to send the link, so
      // refusing to verify would lock every member out of matching forever.
      u.emailVerified = true; u.verifyToken = null; users.put(u);
    }
  }

  A.publicRpc.add('verifyEmail');
  A.rpc.verifyEmail = (me, args) => {
    const token = clean(args.token, 100);
    const u = token ? users.find((x) => x.verifyToken === token) : null;
    if (!u) throw A.err('That confirmation link has expired. Request a new one from your profile.');
    u.emailVerified = true; u.verifyToken = null; users.put(u);
    return { ok: true };
  };
  A.rpc.resendVerification = async (me) => {
    if (me.isGuest || me.emailVerified) return { ok: true };
    A.limit(`verify:${me.id}`, 3, 3600000);
    me.verifyToken = crypto.randomBytes(24).toString('hex'); users.put(me);
    await sendVerification(me);
    return { ok: true, verified: me.emailVerified };
  };

  // ---- forgotten password ---------------------------------------------------------------------
  // The link is the only proof of identity, so: it is random, stored only as
  // a hash, good for one hour and one use, and using it ends every session
  // the account had (whoever knew the old password is signed out).
  const RESET_MS = 60 * 60 * 1000;
  function makeResetLink(u) {
    const token = crypto.randomBytes(32).toString('hex');
    u.reset = { hash: tokenId(token), expires: A.now() + RESET_MS }; users.put(u);
    return `${A.config.publicUrl || ''}/reset?token=${token}`;
  }
  A.makeResetLink = makeResetLink;

  A.publicRpc.add('requestPasswordReset');
  A.rpc.requestPasswordReset = async (me, args, req) => {
    A.limit(`reset:${req.ip}`, 6, 3600000);
    const email = clean(args.email, 254).toLowerCase();
    if (!EMAIL_RE.test(email)) throw A.err('That does not look like an email address.');
    // Without a mail provider there is no way to deliver a link. Say so
    // (it is true for every address, so it gives nothing away) and point at
    // the operator, who can make a link with `npm run admin -- reset-link`.
    if (!A.mailer) return { ok: true, mail: false };
    const u = users.find((x) => x.email === email);
    // The answer is the same whether or not the account exists: this form
    // must not be a way to learn who is a member.
    if (u) {
      // Past the per-account limit the answer is still "ok": a refusal here
      // would tell the caller the address belongs to a member.
      try { A.limit(`reset-to:${u.id}`, 3, 3600000); } catch { return { ok: true, mail: true }; }
      const link = makeResetLink(u);
      try {
        await A.mailer({ to: u.email, subject: 'Reset your VentureArena password', text: `Someone asked to reset the password for this VentureArena account. If it was you, choose a new one here (the link works once, for one hour):\n\n${link}\n\nIf it was not you, ignore this email. Your password has not changed.\n` });
      } catch (e) { console.error('[mail] reset failed:', e.message); }
    }
    return { ok: true, mail: true };
  };

  A.publicRpc.add('resetPassword');
  A.rpc.resetPassword = async (me, args, req) => {
    A.limit(`reset-use:${req.ip}`, 12, 3600000);
    const token = typeof args.token === 'string' ? args.token.slice(0, 200) : '';
    const password = typeof args.password === 'string' ? args.password : '';
    const hash = token ? tokenId(token) : '';
    const u = hash ? users.find((x) => x.reset && x.reset.hash === hash) : null;
    if (!u || A.now() > u.reset.expires) {
      if (u) { u.reset = null; users.put(u); }
      throw A.err('That reset link has expired or was already used. Ask for a new one.');
    }
    if (password.length < 8) throw A.err('Use a password of at least 8 characters.');
    u.pass = await hashPassword(password);
    u.reset = null;
    users.put(u);
    for (const s of sessions.filter((x) => x.userId === u.id)) sessions.delete(s.id);
    return { user: A.selfView(u), setSession: startSession(u) };
  };

  // ---- profile -------------------------------------------------------------------------------
  A.rpc.saveProfile = (me, args) => {
    const f = args || {};
    if (f.displayName !== undefined) me.displayName = clean(f.displayName, 40) || me.displayName || 'Player';
    if (f.username !== undefined) {
      const want = clean(f.username, 24).toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (want && want !== me.username) {
        if (want.length < 3) throw A.err('Usernames need at least 3 letters or numbers.');
        if (users.find((x) => x.username === want && x.id !== me.id)) throw A.err('That username is taken.');
        me.username = want;
      }
    }
    if (f.avatar !== undefined && AVATARS.includes(f.avatar)) me.avatar = f.avatar;
    if (f.colorRanks !== undefined) me.colorRanks = cleanList(f.colorRanks, 3, 12, COLORS.map((c) => c.id));
    if (f.headline !== undefined) me.headline = clean(f.headline, 120);
    if (f.bio !== undefined) me.bio = clean(f.bio, 600);
    if (f.stage !== undefined) {
      me.stage = STAGES.some((s) => s.id === f.stage) ? f.stage : null;
      // (Bug: the DNA's sophistication was written once, at the card sort.
      // Onboarding asks for the sort BEFORE the stage, so it was 1, "idea",
      // for every member who followed the steps in order.)
      if (me.dna && me.dna.collab) me.dna = { ...me.dna, sophistication: stageNum(me.stage) };
    }
    if (f.industry !== undefined) me.industry = clean(f.industry, 60);
    if (f.lookingFor !== undefined) me.lookingFor = clean(f.lookingFor, 160);
    if (f.goals !== undefined) me.goals = clean(f.goals, 300);
    if (f.currentProject !== undefined) me.currentProject = clean(f.currentProject, 200);
    if (f.skills !== undefined) me.skills = cleanList(typeof f.skills === 'string' ? f.skills.split(',') : f.skills, 12, 30);
    if (f.interests !== undefined) me.interests = cleanList(f.interests, 8, 30, INTEREST_TAGS);
    if (f.intent !== undefined) me.intent = cleanList(f.intent, 4, 20, INTENTS.map((i) => i.id));
    if (f.offers !== undefined) me.offers = cleanList(f.offers, 5, 20, OFFERS.map((i) => i.id));
    // A whole number of people. (Bug: 0.4 was stored as-is, which showed the
    // member as a mentor with room and then let one introduction through.)
    if (f.openToMentoring !== undefined) me.openToMentoring = Math.max(0, Math.min(10, Math.floor(Number(f.openToMentoring)) || 0));
    if (f.prompts !== undefined && Array.isArray(f.prompts)) {
      me.prompts = f.prompts.slice(0, 2).map((p) => ({ q: PROMPTS.includes(p && p.q) ? p.q : PROMPTS[0], a: clean(p && p.a, 140) })).filter((p) => p.a);
    }
    if (f.socialLinks !== undefined && f.socialLinks && typeof f.socialLinks === 'object') {
      const links = {};
      for (const { id } of SOCIAL_KEYS) {
        let v = clean(f.socialLinks[id], 200);
        if (!v) continue;
        if (!/^https?:\/\//i.test(v)) v = `https://${v.replace(/^@/, '')}`;
        links[id] = v;
      }
      me.socialLinks = links;
    }
    if (f.city !== undefined) me.city = clean(f.city, 60);
    if (f.region !== undefined) me.region = clean(f.region, 60);
    if (f.phone !== undefined) me.phone = clean(f.phone, 30);
    if (f.timezone !== undefined) me.timezone = clean(f.timezone, 60);
    users.put(me);
    const bonus = recomputeSurvey(me);
    return { user: A.selfView(me), bonus };
  };

  /** The business-savvy card sort: eight scenarios in, an archetype out. */
  A.rpc.cardSort = (me, args) => {
    // Whole numbers only. (Bug: picks went through Number(), so a skipped
    // scenario sent as null, "" or [] counted as answer 0.)
    const picks = Array.isArray(args.picks) ? args.picks : [];
    if (picks.length !== SCENARIOS.length || picks.some((p, i) => !Number.isInteger(p) || !SCENARIOS[i].answers[p])) throw A.err('Answer every scenario to get your card.');
    const r = scoreCardSort(picks);
    // The member always owns the label. A second sort replaces it; play only
    // ever SUGGESTS a different one (see play.js).
    me.archetype = ARCHETYPE_IDS.includes(args.archetype) ? args.archetype : r.archetype;
    me.dna = { risk: r.risk, pace: r.pace, collab: r.collab, sophistication: stageNum(me.stage) };
    me.cardSort = picks;
    users.put(me);
    const bonus = recomputeSurvey(me);
    return { user: A.selfView(me), result: r, bonus };
  };

  A.rpc.finishOnboarding = (me) => {
    if (!me.onboardedAt) { me.onboardedAt = A.now(); users.put(me); }
    return { user: A.selfView(me) };
  };

  // Photos are resized in the browser to a small JPEG before upload, so the
  // server stores a few kilobytes per member rather than a camera original.
  A.rpc.setPhoto = (me, args) => {
    if (me.isGuest) throw A.err('Create a free account to add a photo.', 403);
    if (args.remove) { if (me.photoId) photos.delete(me.photoId); me.photoId = null; users.put(me); return { user: A.selfView(me) }; }
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(args.dataUrl || ''));
    if (!m) throw A.err('Photos need to be JPEG, PNG or WebP.');
    if (m[2].length > 120000) throw A.err('That photo is too large. Try a smaller one.');
    if (me.photoId) photos.delete(me.photoId);
    const id = A.id();
    photos.put({ id, userId: me.id, type: m[1], b64: m[2], at: A.now() });
    me.photoId = id; users.put(me);
    return { user: A.selfView(me) };
  };
  A.photo = (id) => photos.get(id);

  // Location is double opt-in: a distance is shown only when BOTH people share,
  // and only rounded up to 5 km. Coordinates are rounded on the device and are
  // never sent to anyone else.
  A.rpc.setLocation = (me, args) => {
    if (!args.share) { me.shareLocation = false; me.loc = null; users.put(me); return { user: A.selfView(me) }; }
    // Only a number or a numeric string is a coordinate. (Bug: Number(null),
    // Number('') and Number([]) are all 0, so a browser that sent "no
    // position" put the member at latitude 0, longitude 0 and matched them
    // as "nearby" with everyone else that had happened to.)
    const coord = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
    const lat = coord(args.lat); const lon = coord(args.lon);
    me.shareLocation = true;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      me.loc = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
    }
    users.put(me);
    return { user: A.selfView(me) };
  };

  // ---- daily check-in --------------------------------------------------------------------------
  A.rpc.checkin = (me) => {
    const today = A.day();
    me.lastSeenAt = A.now();
    if (me.streakDay === today) { users.put(me); return { streak: me.streak, awarded: 0, points: me.points }; }
    const dayMs = 86400000;
    const gap = me.streakDay ? Math.round((Date.parse(today) - Date.parse(me.streakDay)) / dayMs) : Infinity;
    // One missed day is forgiven (life happens); two reset the streak.
    me.streak = gap <= 2 ? (me.streak || 0) + 1 : 1;
    me.streakDay = today;
    users.put(me);
    const amount = me.streak >= 7 ? POINTS.checkinStreak : POINTS.checkin;
    const awarded = A.award(me, 'checkin', amount, { once: today }) ? amount : 0;
    return { streak: me.streak, awarded, points: me.points };
  };

  A.rpc.heartbeat = (me) => { me.lastSeenAt = A.now(); users.put(me); return { ok: true }; };

  A.rpc.pointsHistory = (me) => ({
    balance: me.points || 0,
    rows: points.filter((p) => p.userId === me.id).sort((a, b) => b.at - a.at).slice(0, 20),
  });

  // ---- referral codes --------------------------------------------------------------------------
  A.referralCode = (u) => {
    if (u.isGuest) return null;
    if (!u.referralCode) {
      let code;
      do { code = A.code(8, REF_ALPHABET); } while (users.find((x) => x.referralCode === code));
      u.referralCode = code; users.put(u);
    }
    return u.referralCode;
  };
  function claimReferral(u, raw) {
    const code = clean(String(raw), 12).toUpperCase();
    const inviter = code ? users.find((x) => x.referralCode === code) : null;
    // Only a brand-new account can be referred. (The earlier build credited
    // the inviter when any existing member opened a ?ref link.) "New" is
    // counted from registration: a guest upgrades in place and keeps the
    // createdAt of their first visit, so someone who played as a guest for
    // two days before signing up from the invite was never credited.
    if (!inviter || inviter.id === u.id || u.referredBy || A.now() - (u.registeredAt || u.createdAt) > 86400000) return false;
    // A block either way means no referral and no request. (Bug: the
    // connection request below threw for a blocked pair, AFTER the account
    // had been created, so the newcomer saw an error for a registration
    // that had in fact gone through.)
    if (A.areBlocked && A.areBlocked(inviter.id, u.id)) return false;
    u.referredBy = inviter.id; users.put(u);
    const inv = A.c.invites.filter((i) => i.inviterId === inviter.id && !i.joinedUserId).sort((a, b) => b.at - a.at)[0];
    if (inv) { inv.joinedUserId = u.id; inv.joinedAt = A.now(); A.c.invites.put(inv); }
    A.award(inviter, 'referral', POINTS.referral, { ref: u.id, once: u.id });
    if (A.hooks.connectRequest) A.hooks.connectRequest(inviter, u, 'referral', { bypass: true });
    A.notify(inviter.id, `${u.displayName} joined from your invite. You earned ${POINTS.referral} Arena Points and a connection request is waiting for them.`);
    return true;
  }
  A.claimReferral = claimReferral;
  A.rpc.claimReferral = (me, args) => ({ ok: !me.isGuest && claimReferral(me, args.code) });
}
