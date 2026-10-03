// Tables: the lobby, seats and observers, invites, chat, starting a match,
// leaving one, and the housekeeping that keeps a small site tidy.
//
// Rules that came out of the first two builds and are enforced here:
//  * Up to 7 people at any table. Players fill the game's seats; everyone
//    else watches, chats and joins the debrief.
//  * People always outrank robots. Robots are never seats while a table is
//    open; they fill whatever is still empty at the moment the game starts.
//    (The first build reserved chairs for robots and locked people out.)
//  * A stalled or departed seat is finished by a bot, so one person can never
//    hold a table hostage.
import { clean } from './context.js';
import { GAMES, GAME_ORDER, getGame } from '../../games/registry.js';
import { actingSeats } from '../../games/kit.js';
import { HOST_LIMIT } from '../../shared/tiers.js';
import { PACES, PACE_IDS, paceOf } from '../../shared/pace.js';
import { assignSeatColors, TABLE_QUESTIONS, BOT_AVATAR, colorHex } from '../../shared/profile.js';

export const TABLE_CAPACITY = 7;
const STALE_OPEN_MS = 2 * 3600 * 1000;
const STALE_PLAYING_MS = 24 * 3600 * 1000;
const TURN_BASED_LIMIT_MS = 24 * 3600 * 1000;
const MAX_SETTINGS_CHARS = 4000;
const BOT_NAMES = ['Robo-Trader', 'Ledger Lee', 'Margin Mo', 'Runway Rae', 'Pivot Pat', 'Burn-Rate Bo'];

/** Games that are listed but cannot be launched here. */
export const EXTRA_CATALOG = [
  { id: 'venturemaker', name: 'VentureMaker', status: 'soon', icon: '\u{1F6E0}', tagline: 'Build and pitch a startup with your table. Coming soon.' },
  { id: 'boardgamearena', name: 'Board Game Arena', status: 'partner', icon: '\u{1F3B2}', tagline: 'Hundreds of classic and modern board games, free to play online.', url: 'https://boardgamearena.com' },
  { id: 'boardgameuniverse', name: 'BoardGameUniverse', status: 'partner', icon: '\u{1F310}', tagline: 'Free online board games and strategy challenges.', url: 'https://boardgameuniverse.com' },
];

export function install(A) {
  const { tables, messages, users, ratings } = A.c;

  const metaOf = (gameId) => { const g = getGame(gameId); if (!g) throw A.err('No such game', 404); return g.meta; };
  const must = (id) => { const t = tables.get(id); if (!t) throw A.err('Table not found. It may have closed.', 404); return t; };
  const people = (t) => t.players.length + t.observers.length;
  const isAt = (t, uid) => t.players.includes(uid) || t.observers.includes(uid);
  const seatOf = (t, uid) => (t.seats ? t.seats.findIndex((s) => s.userId === uid) : -1);
  A.tableSeatOf = seatOf;
  A.isAtTable = isAt;

  function defaults(gameId) {
    const g = getGame(gameId);
    const base = { size: g.meta.seats.defaultSize || g.meta.seats.max, fillBots: true, botLevel: 2 };
    return g.normalizeSettings ? g.normalizeSettings(base) : base;
  }
  function normalize(gameId, raw, prev) {
    const g = getGame(gameId);
    // Settings are stored on the table and sent to everyone who looks at it,
    // so what a host may put there is bounded. (Bug: every key the request
    // carried was kept, so a host could park 250 KB of anything in a public
    // table's settings and have it broadcast to the lobby.)
    const sent = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    if (JSON.stringify(sent).length > MAX_SETTINGS_CHARS) throw A.err('Those settings are too large.');
    const s = { ...prev, ...sent };
    const base = {
      size: Math.max(g.meta.seats.min, Math.min(g.meta.seats.max, Math.round(Number(s.size)) || g.meta.seats.max)),
      fillBots: s.fillBots !== false,
      botLevel: [1, 2, 3].includes(Number(s.botLevel)) ? Number(s.botLevel) : 2,
    };
    // A game with its own settings owns their shape (normalizeSettings); a
    // game without any keeps only the three every table has.
    const out = g.normalizeSettings ? g.normalizeSettings({ ...s, ...base }) : base;
    // The result is capped too: a game's normalizeSettings may keep keys it
    // does not know, and those would otherwise pile up call after call.
    if (JSON.stringify(out).length > MAX_SETTINGS_CHARS) throw A.err('Those settings are too large.');
    return out;
  }

  // ---- views ------------------------------------------------------------------------
  function seatViews(t, viewer) {
    if (t.seats) {
      return t.seats.map((s, i) => ({
        seat: i, kind: s.bot ? 'bot' : 'human', color: s.color, hex: colorHex(s.color), takeover: !!s.takeover,
        name: s.name, avatar: s.avatar, bot: s.bot || null,
        card: s.userId ? A.card(users.get(s.userId), viewer) : null,
      }));
    }
    const g = metaOf(t.gameId);
    const out = t.players.map((uid, i) => {
      const u = users.get(uid);
      return { seat: i, kind: 'human', name: u ? u.displayName : 'Player', avatar: u ? u.avatar : null, card: A.card(u, viewer) };
    });
    const size = Math.max(t.settings.size || g.seats.max, out.length);
    for (let i = out.length; i < size; i++) out.push({ seat: i, kind: 'open', botIfEmpty: !!t.settings.fillBots });
    return out;
  }

  A.tableView = (t, viewer) => {
    const g = metaOf(t.gameId);
    const uid = viewer ? viewer.id : null;
    const role = !uid ? null : t.hostId === uid && t.players.includes(uid) ? 'host' : t.players.includes(uid) ? 'player' : t.observers.includes(uid) ? 'observer' : null;
    return {
      id: t.id, gameId: t.gameId, gameName: g.name, hostId: t.hostId, visibility: t.visibility, mode: t.mode, status: t.status,
      inviteCode: t.inviteCode, createdAt: t.createdAt, startedAt: t.startedAt || null, endedAt: t.endedAt || null,
      now: A.now(), // the server's clock, so the table clock is right on a device whose own clock is not
      pace: paceOf(t.pace), canPace: canPace(t, uid),
      resign: resignOptions(t, uid), // what the Resign button offers this viewer; null for a spectator or a finished game
      // How long a live seat may sit on its move before a bot finishes the game for it (null: a day, turn-based).
      idleLimitMs: t.mode === 'turn_based' ? null : (A.config.idleTakeoverMs ?? 180000),
      settings: t.settings, question: t.question, auto: !!t.auto, autoStartAt: t.autoStartAt || null,
      seats: seatViews(t, viewer),
      observers: t.observers.map((id) => A.card(users.get(id), viewer)).filter(Boolean),
      people: people(t), capacity: TABLE_CAPACITY, maxSeats: g.seats.max, minSeats: g.seats.min,
      me: { role, seat: uid ? seatOf(t, uid) : -1 },
      host: A.card(users.get(t.hostId), viewer),
      challengeId: t.challengeId || null,
    };
  };

  function lobbyRow(t, viewer) {
    const g = metaOf(t.gameId);
    return {
      id: t.id, gameId: t.gameId, gameName: g.name, status: t.status, mode: t.mode, visibility: t.visibility, createdAt: t.createdAt,
      host: A.card(users.get(t.hostId), viewer),
      players: t.players.map((id) => { const u = users.get(id); return u ? { id, name: u.displayName, avatar: u.avatar, archetype: u.archetype } : null; }).filter(Boolean),
      watching: t.observers.length, maxSeats: g.seats.max, people: people(t),
      role: viewer ? (t.hostId === viewer.id ? 'host' : t.players.includes(viewer.id) ? 'player' : t.observers.includes(viewer.id) ? 'observer' : null) : null,
      myTurn: viewer && t.status === 'playing' ? isMyTurn(t, viewer.id) : false,
    };
  }
  function isMyTurn(t, uid) {
    const seat = seatOf(t, uid);
    if (seat < 0 || !A.bgio) return false;
    const st = A.bgio.state(t.id);
    return !!st && actingSeats(st.G).includes(seat);
  }

  const touchLobby = () => A.emit('lobby', 'lobby', {});
  const touchTable = (t) => { A.emit(`t:${t.id}`, 'table', { id: t.id, status: t.status }); if (t.visibility === 'public') touchLobby(); };

  // ---- catalog and lobby --------------------------------------------------------------
  A.publicRpc.add('games');
  A.rpc.games = () => ({
    games: GAME_ORDER.map((id) => {
      const m = GAMES[id].meta;
      return { id: m.id, name: m.name, family: m.family, icon: m.icon, tagline: m.tagline, skills: m.skills, seats: m.seats, minutes: m.minutes, status: 'live', howTo: m.howTo, watchFor: m.watchFor, hasSettings: !!m.hasSettings, brand: m.brand || null };
    }),
    extras: EXTRA_CATALOG,
  });

  A.rpc.lobby = (me) => {
    const open = tables.filter((t) => t.status === 'open' && t.visibility === 'public')
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map((t) => lobbyRow(t, me));
    const live = tables.filter((t) => t.status === 'playing' && t.visibility === 'public' && people(t) < TABLE_CAPACITY)
      .sort((a, b) => b.startedAt - a.startedAt).slice(0, 12).map((t) => lobbyRow(t, me));
    const mine = tables.filter((t) => (t.status === 'open' || t.status === 'playing') && isAt(t, me.id))
      .sort((a, b) => b.createdAt - a.createdAt).map((t) => lobbyRow(t, me));
    const online = users.filter((u) => !u.isBot && A.isOnline(u));
    return {
      open, live, mine,
      online: online.length,
      onlineSample: online.filter((u) => u.id !== me.id).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 12).map((u) => A.card(u, me)),
      hostLimit: HOST_LIMIT[A.tier(me)],
    };
  };

  // ---- create / join / leave -------------------------------------------------------------
  function createTable(me, gameId, { visibility = 'public', mode = 'realtime', settings = null, auto = false, challengeId = null } = {}) {
    metaOf(gameId);
    // Only the exact word asks for a private table. (Bug: the check was
    // `!== 'public'`, so a request with visibility null or '' was refused as
    // "a Subscriber feature" for a table that would have been public.)
    if (visibility === 'private') A.need(me, 'private_table', 'Private tables are a Subscriber feature.');
    // One-click bot games and accepted challenges (`solo`) are not hosted
    // tables. (Bug: an accepted challenge waiting for its start counted as
    // the challenger's one open table and blocked them from hosting or
    // quick-matching: a paywall on basic play.)
    const openCount = tables.count((t) => t.hostId === me.id && t.status === 'open' && !t.solo);
    const lim = HOST_LIMIT[A.tier(me)];
    if (openCount >= lim) {
      throw A.err(`You already have ${openCount} open table${openCount === 1 ? '' : 's'}. Close one first, or upgrade: Subscribers host 3 at a time, VIPs 10.`, 403);
    }
    const t = {
      id: A.id(), gameId, hostId: me.id, visibility: visibility === 'private' ? 'private' : 'public',
      mode: mode === 'turn_based' ? 'turn_based' : 'realtime', status: 'open',
      inviteCode: A.code(8), createdAt: A.now(), lastMoveAt: A.now(),
      players: [me.id], observers: [], seats: null,
      settings: normalize(gameId, settings, defaults(gameId)),
      question: TABLE_QUESTIONS[Math.floor(Math.random() * TABLE_QUESTIONS.length)],
      auto, autoStartAt: null, challengeId,
    };
    tables.put(t);
    touchTable(t);
    return t;
  }
  A.createTable = createTable;

  A.rpc.createTable = (me, args) => {
    const t = createTable(me, clean(args.gameId, 40), { visibility: args.visibility, mode: args.mode, settings: args.settings });
    return { table: A.tableView(t, me) };
  };

  function join(me, t, wantRole = 'player') {
    if (isAt(t, me.id)) return t;
    if (t.status !== 'open' && t.status !== 'playing') throw A.err('That table has already ended.');
    if (people(t) >= TABLE_CAPACITY) throw A.err('That table is full (7 people max).');
    const g = metaOf(t.gameId);
    // A person can take a seat only while the table is open and a seat is
    // free; otherwise they watch.
    const asPlayer = wantRole === 'player' && t.status === 'open' && t.players.length < g.seats.max;
    if (asPlayer) {
      t.players.push(me.id);
      if (t.settings.size < t.players.length) t.settings.size = t.players.length;
    } else {
      t.observers.push(me.id);
    }
    tables.put(t);
    touchTable(t);
    if (asPlayer && t.auto) maybeAutoStart(t);
    return t;
  }
  A.joinTable = join;

  A.rpc.joinTable = (me, args) => {
    const t = args.code ? tables.find((x) => x.inviteCode === clean(args.code, 16).toLowerCase()) : tables.get(args.id);
    if (!t) throw A.err('That invite link is no longer valid.', 404);
    // A private table is entered with its invite code. (Bug: joining by id
    // skipped the check the table view makes, so anyone who had seen the id,
    // e.g. in a member's game history, could sit down at a private table and
    // read its chat.)
    if (!args.code && t.visibility === 'private' && !isAt(t, me.id) && t.hostId !== me.id) throw A.err('That table is private. Ask the host for the invite link.', 403);
    join(me, t, args.role === 'observer' ? 'observer' : 'player');
    return { table: A.tableView(t, me) };
  };

  A.rpc.setRole = (me, args) => {
    const t = must(args.id);
    if (!isAt(t, me.id)) throw A.err('You are not at this table.');
    if (t.status !== 'open') throw A.err('Roles are locked once the game starts.');
    const g = metaOf(t.gameId);
    if (args.role === 'player' && !t.players.includes(me.id)) {
      if (t.players.length >= g.seats.max) throw A.err('All player seats are taken.');
      t.observers = t.observers.filter((id) => id !== me.id);
      t.players.push(me.id);
    } else if (args.role === 'observer' && t.players.includes(me.id)) {
      if (t.hostId === me.id) throw A.err('The host plays. Leave the table to hand off hosting.');
      t.players = t.players.filter((id) => id !== me.id);
      t.observers.push(me.id);
    }
    tables.put(t); touchTable(t);
    return { table: A.tableView(t, me) };
  };

  A.rpc.table = (me, args) => {
    const t = must(args.id);
    if (t.visibility === 'private' && !isAt(t, me.id) && t.hostId !== me.id) throw A.err('That table is private. Ask the host for the invite link.', 403);
    const chat = messages.filter((m) => m.tableId === t.id).sort((a, b) => a.at - b.at).slice(-100).map(chatView);
    return { table: A.tableView(t, me), chat };
  };

  /** How this browser connects to the boardgame.io match. */
  A.rpc.seatAccess = (me, args) => {
    const t = must(args.id);
    if (t.status !== 'playing' && t.status !== 'finished') throw A.err('The game has not started.');
    if (t.visibility === 'private' && !isAt(t, me.id)) throw A.err('That table is private.', 403);
    const seat = seatOf(t, me.id);
    const mine = seat >= 0 && !t.seats[seat].takeover;
    return { matchID: t.id, gameId: t.gameId, playerID: mine ? String(seat) : null, credentials: mine ? t.creds[seat] : null };
  };

  // ---- pace of play ---------------------------------------------------------------------
  // Unlike the game's settings, the pace can change while the game is on: it
  // only stretches the pauses meant for people (shared/pace.js). The host
  // sets it; at a table with one person and bots, that person does.
  function canPace(t, uid) {
    if (!uid || !t.players.includes(uid)) return false;
    const people = (t.seats || []).filter((s) => s.userId && !s.takeover);
    if (t.status === 'playing' && people.length === 1) return people[0].userId === uid;
    return t.hostId === uid;
  }
  A.rpc.setPace = (me, args) => {
    const t = must(args.id);
    if (!PACE_IDS.includes(args.pace)) throw A.err('Pick Quick, Steady or Slow.', 400);
    if (t.status !== 'open' && t.status !== 'playing') throw A.err('That game is over.');
    if (!canPace(t, me.id)) throw A.err(t.players.includes(me.id) ? 'Only the host can change the pace.' : 'Only a player at the table can change the pace.', 403);
    A.limit(`pace:${me.id}`, 20, 60000);
    if (t.pace !== args.pace) {
      t.pace = args.pace;
      tables.put(t); touchTable(t);
      if (t.status === 'playing') A.tableSay(t, 'arena', `${me.displayName} set the pace to ${PACES[args.pace].label}.`, true);
      if (t.status === 'playing' && A.hooks.planMatch) A.hooks.planMatch(t); // a pause already running is re-timed
    }
    return { table: A.tableView(t, me) };
  };

  A.rpc.setTableSettings = (me, args) => {
    const t = must(args.id);
    if (t.hostId !== me.id) throw A.err('Only the host can change the settings.', 403);
    if (t.status !== 'open') throw A.err('Settings are locked once the table starts.');
    const next = normalize(t.gameId, args.settings, t.settings);
    if (next.size < t.players.length) next.size = t.players.length;
    t.settings = next;
    if (args.visibility === 'private' || args.visibility === 'public') {
      if (args.visibility === 'private') A.need(me, 'private_table', 'Private tables are a Subscriber feature.');
      t.visibility = args.visibility;
    }
    // Live: a seat that stalls for a few minutes is finished by a bot.
    // Turn-based: a move a day, for people in different time zones.
    if (args.mode === 'realtime' || args.mode === 'turn_based') t.mode = args.mode;
    tables.put(t); touchTable(t);
    return { table: A.tableView(t, me) };
  };

  // ---- starting -------------------------------------------------------------------------
  async function start(t) {
    if (t.status !== 'open') return t;
    const g = getGame(t.gameId);
    const humans = t.players.map((id) => users.get(id)).filter(Boolean);
    if (humans.length < 1) throw A.err('A table needs at least one person.');
    const size = Math.max(Math.min(t.settings.size || g.meta.seats.max, g.meta.seats.max), humans.length, t.settings.fillBots ? g.meta.seats.min : 0);
    const seats = humans.map((u) => ({ userId: u.id, name: u.displayName, avatar: u.avatar, bot: null, colorRanks: u.colorRanks }));
    const lineup = g.botLineup ? g.botLineup(t.settings, size - seats.length) : null;
    let b = 0;
    while (t.settings.fillBots && seats.length < size) {
      const spec = lineup && lineup[b] ? lineup[b] : { name: BOT_NAMES[b % BOT_NAMES.length], level: t.settings.botLevel };
      seats.push({ userId: null, name: spec.name, avatar: spec.avatar || BOT_AVATAR, bot: { level: spec.level || t.settings.botLevel, ...spec }, colorRanks: [] });
      b++;
    }
    if (seats.length < g.meta.seats.min) {
      throw A.err(`${g.meta.name} needs at least ${g.meta.seats.min} players. Invite someone, or turn on "fill empty seats with bots".`);
    }
    const colors = assignSeatColors(seats);
    seats.forEach((s, i) => { s.color = colors[i]; delete s.colorRanks; });
    const setupData = {
      arena: true,
      seats: seats.map((s) => ({ name: s.name, avatar: s.avatar, bot: !!s.bot, botSpec: s.bot, color: s.color })),
      settings: t.settings,
      seed: Math.floor(Math.random() * 2147483647),
    };
    // Mark the table as starting BEFORE the await: two "start" clicks in the
    // same tick would otherwise both pass the status check and create the
    // match twice.
    t.status = 'starting'; tables.put(t);
    try {
      const { credentials, house } = await A.bgio.createMatch(t.id, t.gameId, seats.length, setupData, seats.map((s) => s.name));
      t.seats = seats; t.creds = credentials; t.house = house;
      t.status = 'playing'; t.startedAt = A.now(); t.lastMoveAt = A.now(); t.think = {};
      t.settings = { ...t.settings, size: seats.length };
      tables.put(t);
    } catch (e) {
      t.status = 'open'; tables.put(t);
      throw e;
    }
    touchTable(t);
    if (A.hooks.planMatch) A.hooks.planMatch(t);
    return t;
  }
  A.startTable = start;

  A.rpc.startTable = async (me, args) => {
    const t = must(args.id);
    if (t.hostId !== me.id) throw A.err('Only the host can start the game.', 403);
    await start(t);
    return { table: A.tableView(t, me) };
  };

  function maybeAutoStart(t) {
    const g = metaOf(t.gameId);
    if (t.status === 'open' && t.auto && t.players.length >= Math.min(t.settings.size, g.seats.max)) {
      start(t).catch((e) => console.error('[tables] auto-start failed:', e.message));
    }
  }

  // Quick match: back to your own open table, else a public table near your
  // rating, else a new table that fills with bots if nobody shows.
  A.rpc.quickMatch = async (me, args) => {
    const gameId = clean(args.gameId, 40);
    const g = metaOf(gameId);
    let t = tables.filter((x) => x.hostId === me.id && x.gameId === gameId && x.status === 'open').sort((a, b) => b.createdAt - a.createdAt)[0];
    if (t) return { table: A.tableView(t, me) };
    const myRating = A.ratingOf(me.id, gameId);
    const avg = (x) => { const rs = x.players.map((id) => A.ratingOf(id, gameId)); return rs.reduce((a, b) => a + b, 0) / Math.max(1, rs.length); };
    // Never across a block: a block exists so two people do not meet. (Bug:
    // quick match seated a member at the table of someone who blocked them.)
    const blockedAt = (x) => !!A.areBlocked && x.players.some((id) => A.areBlocked(me.id, id));
    t = tables.filter((x) => x.gameId === gameId && x.status === 'open' && x.visibility === 'public' && !isAt(x, me.id)
        && x.players.length < g.seats.max && people(x) < TABLE_CAPACITY && Math.abs(avg(x) - myRating) <= 400 && !blockedAt(x))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (t) { join(me, t, 'player'); return { table: A.tableView(t, me) }; }
    t = createTable(me, gameId, { auto: true });
    t.autoStartAt = A.now() + (A.config.quickMatchBotAfterMs ?? 20000);
    tables.put(t);
    return { table: A.tableView(t, me) };
  };

  /** One click to a game against bots: the fastest path from landing page to first move. */
  A.rpc.playBots = async (me, args) => {
    const gameId = clean(args.gameId, 40);
    metaOf(gameId);
    // Generous for a person, tight for a script farming Arena Points off bots.
    A.limit(`playbots:${me.id}`, 40, 3600000);
    // A bot table is private-by-nature and does not count against the open-table limit.
    // Only a bot table that never started. (Bug: an accepted challenge is
    // also `solo` and open, so "play a bot" deleted the table the challenged
    // member was sitting at.)
    const stale = tables.filter((x) => x.hostId === me.id && x.status === 'open' && x.solo && !x.challengeId);
    for (const x of stale) tables.delete(x.id);
    const t = {
      id: A.id(), gameId, hostId: me.id, visibility: 'private', mode: 'realtime', status: 'open', solo: true,
      inviteCode: A.code(8), createdAt: A.now(), lastMoveAt: A.now(), players: [me.id], observers: [], seats: null,
      settings: normalize(gameId, { ...(args.settings || {}), fillBots: true, botLevel: args.level }, defaults(gameId)),
      question: TABLE_QUESTIONS[0], auto: false, autoStartAt: null,
    };
    tables.put(t);
    await start(t);
    return { table: A.tableView(t, me) };
  };

  // ---- leaving, forfeits, takeovers --------------------------------------------------------
  /** Hand a seat to a bot for the rest of the game. */
  async function takeover(t, seat, reason, { playOn = false } = {}) {
    const s = t.seats[seat];
    if (!s || s.bot || s.takeover) return;
    const g = getGame(t.gameId);
    s.takeover = reason; tables.put(t);
    // The seat is the bot's now: the browser that left must not be able to
    // keep moving it. (Bug: its credentials stayed valid, so a member who
    // was taken over could play the seat alongside the bot.)
    if (A.bgio.revokeSeat) { const fresh = await A.bgio.revokeSeat(t.id, seat); if (fresh && t.creds) { t.creds[seat] = fresh; tables.put(t); } }
    const u = users.get(s.userId);
    if (u) {
      u.reputation.score = Math.max(0, u.reputation.score - 10); u.reputation.abandons += 1; users.put(u);
    }
    // A two-seat game someone walks away from is over: the seat resigns.
    // `playOn` is the other choice a player can make on purpose (resignTable):
    // the bot plays the seat to the end, so the person across the table still gets their game.
    const plan = g.onLeave ? g.onLeave(A.bgio.state(t.id).G, seat, reason) : (g.meta.seats.max === 2 && !playOn ? { as: 'seat', move: 'resign', args: [] } : null);
    if (plan) await A.bgio.submit(t.id, t.gameId, plan.as === 'house' ? t.house : seat, plan.move, plan.args || []);
    touchTable(t);
    if (A.hooks.planMatch) A.hooks.planMatch(t);
  }
  A.takeoverSeat = takeover;

  async function leave(me, t) {
    if (t.observers.includes(me.id)) {
      t.observers = t.observers.filter((id) => id !== me.id); tables.put(t); touchTable(t); return;
    }
    if (!t.players.includes(me.id)) return;
    if (t.status === 'open') {
      t.players = t.players.filter((id) => id !== me.id);
      if (t.players.length === 0) { tables.delete(t.id); touchLobby(); A.emit(`t:${t.id}`, 'table', { id: t.id, status: 'closed' }); return; }
      if (t.hostId === me.id) t.hostId = t.players[0];
      tables.put(t); touchTable(t);
    } else if (t.status === 'playing') {
      await takeover(t, seatOf(t, me.id), 'resigned');
    }
  }
  A.rpc.leaveTable = async (me, args) => { const t = tables.get(args.id); if (t) await leave(me, t); return { ok: true }; };

  // ---- resigning -----------------------------------------------------------------------------
  // Two ways to stop playing on purpose, offered by the Resign button at every table:
  //   concede  the game ends now and the other player wins. Only where one
  //            player giving up settles the game: the two-seat games.
  //   bot      a bot plays the seat to the end, so everyone else still gets
  //            their game. Where only bots are left it is played out at once.
  // Conceding is a proper end to a game and costs nothing but the result.
  // Handing a seat to a bot counts as leaving does: other people sat down to
  // play a person.
  function resignOptions(t, uid) {
    if (t.status !== 'playing' || !uid) return null;
    const seat = seatOf(t, uid);
    if (seat < 0 || t.seats[seat].takeover) return null;
    const g = getGame(t.gameId);
    const concede = !!(g && g.rules.moves && g.rules.moves.resign);
    const others = t.seats.filter((s, i) => i !== seat && s.userId && !s.takeover).length;
    // Against a bot alone in a two-seat game there is nobody to play on for.
    return { concede, bot: !(concede && others === 0), others };
  }
  A.rpc.resignTable = async (me, args) => {
    const t = must(args.id);
    const opts = resignOptions(t, me.id);
    if (!opts) throw A.err(t.status === 'playing' ? 'You are not playing at this table.' : 'That game is not in play.', 403);
    const seat = seatOf(t, me.id);
    if (args.how === 'concede') {
      if (!opts.concede) throw A.err('This game cannot be conceded: with more than two players it goes on without you. Hand your seat to a bot instead.');
      const ok = await A.bgio.submit(t.id, t.gameId, seat, 'resign', []);
      if (!ok) throw A.err('The game could not be conceded. It may have just ended.');
      A.tableSay(t, 'arena', `${t.seats[seat].name} conceded the game.`, true);
      return { ok: true, how: 'concede' };
    }
    if (args.how === 'bot') {
      if (!opts.bot) throw A.err('There is nobody left to play on for. Concede instead.');
      A.tableSay(t, 'arena', `${t.seats[seat].name} resigned. A bot is playing their seat.`, true);
      await takeover(t, seat, 'resigned', { playOn: true });
      return { ok: true, how: 'bot' };
    }
    throw A.err('Choose to concede or to hand your seat to a bot.', 400);
  };

  A.rpc.closeMyTables = async (me, args) => {
    let n = 0;
    for (const t of tables.filter((x) => (x.status === 'open' || x.status === 'playing') && isAt(x, me.id))) {
      if (args.staleOnly && A.now() - t.createdAt < STALE_OPEN_MS) continue;
      if (t.hostId === me.id && t.status === 'open') { tables.delete(t.id); A.emit(`t:${t.id}`, 'table', { id: t.id, status: 'closed' }); } else await leave(me, t);
      n++;
    }
    touchLobby();
    return { closed: n };
  };

  // ---- chat ---------------------------------------------------------------------------------
  function chatView(m) {
    const u = users.get(m.fromId);
    return { id: m.id, fromId: m.fromId, name: u ? u.displayName : 'Player', avatar: u ? u.avatar : null, body: m.body, at: m.at, system: !!m.system };
  }
  A.chatView = chatView;
  A.tableSay = (t, fromId, body, system = false) => {
    const m = { id: A.id(), tableId: t.id, fromId, body, at: A.now(), system };
    messages.put(m);
    A.emit(`t:${t.id}`, 'chat', chatView(m));
    t.chatCount = t.chatCount || {};
    t.chatCount[fromId] = (t.chatCount[fromId] || 0) + 1; tables.put(t);
    return m;
  };
  A.rpc.sendChat = (me, args) => {
    const t = must(args.id);
    if (!isAt(t, me.id)) throw A.err('Take a seat or watch to chat at this table.', 403);
    const body = clean(args.body, 500);
    if (!body) return { ok: false };
    A.limit(`chat:${me.id}`, 30, 60000);
    return { message: chatView(A.tableSay(t, me.id, body)) };
  };

  // ---- match state: think time, results, stalls --------------------------------------------------
  A.hooks.matchState = (matchID, state, deltalog) => {
    const t = tables.get(matchID);
    if (!t || t.status !== 'playing') return;
    const now = A.now();
    const mover = deltalog && deltalog[0] && deltalog[0].action && deltalog[0].action.payload ? Number(deltalog[0].action.payload.playerID) : null;
    if (mover !== null && t.seats[mover] && t.seats[mover].userId && !t.seats[mover].takeover) {
      // How long this person took: the "speed" style signal for every game.
      const took = Math.min(now - (t.lastMoveAt || now), 5 * 60 * 1000);
      const k = t.think[mover] || (t.think[mover] = { n: 0, ms: 0, list: [] });
      k.n += 1; k.ms += took; if (k.list.length < 200) k.list.push(Math.round(took / 1000));
    }
    t.lastMoveAt = now;
    // A game may hand a seat to a robot itself (VentureFlow: resign, a table
    // vote, the host's "replace now"). It says so with a { t: 'takeover', p }
    // log entry; the table has to hear about it or the seat keeps its
    // credentials, the member is still told "your move", and walking away
    // from a game costs nothing.
    for (const e of Array.isArray(state.G.log) ? state.G.log : []) {
      if (e.t !== 'takeover' || (t.takeoverN || 0) >= e.n) continue;
      t.takeoverN = e.n;
      const s = t.seats[e.p];
      if (s && s.userId && !s.takeover) {
        s.takeover = e.reason || 'resigned';
        const u = users.get(s.userId);
        if (u) { u.reputation.score = Math.max(0, u.reputation.score - 10); u.reputation.abandons += 1; users.put(u); }
        if (A.bgio && A.bgio.revokeSeat) A.bgio.revokeSeat(t.id, e.p).then((fresh) => { if (fresh && t.creds) { t.creds[e.p] = fresh; tables.put(t); } }).catch(() => {});
        touchTable(t);
      }
    }
    tables.put(t);
    if (state.ctx.gameover !== undefined) {
      Promise.resolve(A.hooks.matchOver(t, state)).catch((e) => console.error('[tables] recording a result failed:', e));
      return;
    }
    A.emit(`t:${t.id}`, 'turn', { id: t.id });
    for (const seat of actingSeats(state.G)) {
      const s = t.seats[seat];
      if (s && s.userId && !s.takeover) A.emit(`u:${s.userId}`, 'yourTurn', { tableId: t.id, gameId: t.gameId });
    }
    if (A.hooks.planMatch) A.hooks.planMatch(t);
  };

  A.finishTable = (t, status = 'finished') => {
    t.status = status; t.endedAt = A.now(); tables.put(t);
    touchTable(t);
  };

  /** Runs every few seconds: bot-fill quick matches, time out stalls, close stale tables. */
  A.sweepTables = async () => {
    const now = A.now();
    for (const t of tables.all()) {
      try {
        if (t.status === 'open') {
          if (t.auto && t.autoStartAt && now >= t.autoStartAt) { await start(t); continue; }
          if (now - t.createdAt > STALE_OPEN_MS) { tables.delete(t.id); A.emit(`t:${t.id}`, 'table', { id: t.id, status: 'closed' }); touchLobby(); }
        } else if (t.status === 'playing') {
          const idle = now - (t.lastMoveAt || t.startedAt);
          if (idle > STALE_PLAYING_MS + TURN_BASED_LIMIT_MS) { A.finishTable(t, 'abandoned'); continue; }
          const limit = t.mode === 'turn_based' ? TURN_BASED_LIMIT_MS : (A.config.idleTakeoverMs ?? 180000);
          if (idle < limit) continue;
          const st = A.bgio.state(t.id);
          if (!st) { A.finishTable(t, 'abandoned'); continue; }
          for (const seat of actingSeats(st.G)) {
            const s = t.seats[seat];
            if (s && s.userId && !s.takeover) {
              A.tableSay(t, 'arena', `${s.name} has been away, so a bot is finishing their game.`, true);
              await takeover(t, seat, 'away');
            }
          }
        }
      } catch (e) { console.error('[tables] sweep failed for', t.id, e.message); }
    }
  };

  A.ratingOf = (userId, gameId) => { const r = ratings.get(`${userId}:${gameId}`); return r ? r.rating : 1200; };
}
