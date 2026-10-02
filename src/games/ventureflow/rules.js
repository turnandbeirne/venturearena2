// VentureFlow on VentureArena: the SERVER runs the game.
// ----------------------------------------------------------------------------
// VentureFlow's engine is a pure reducer (vf/game/reducer.js) with a seeded,
// snapshot-able RNG. Until now a table was "remote hot-seat": every browser
// replayed a shared move list through that reducer, and the HOST'S BROWSER ran
// the robots and the timers. Two failures came out of that (HOUSE-RULES
// section 6): rows 7 (the host closed the tab and the table froze) and 8 (one
// non-deterministic line would silently desync a table).
//
// Here the same reducer runs in exactly one place. G.vf is the engine's state,
// G.secret.rng is its RNG cursor (stripped from every browser), people send
// actions for their own seat through `act`, and the server's own seat plays
// the robots and runs every timer through `houseAct`, scheduled by
// `housekeeping`. The engine and its rules are unchanged.
//
// No React, no DOM, no clock, no Math.random in here. Time only ever arrives
// as an argument of a house move (`now`, `deadlineAt`).
import { defineGame, refuse, isHouse, finish, placementsFromScores, pushLog, countMove, INVALID_MOVE } from '../kit.js';
import { gameReducer } from './vf/game/reducer';
import { seedRng, snapshotRng, restoreRng } from './vf/game/rng';
import { netWorth, passiveIncome } from './vf/game/players';
import { aiDecideExitOffer } from './vf/game/turnEngine';
import { isOffensiveName } from './vf/game/nameFilter';
import { ASSETS, BUSINESS_UPGRADE_TRACKS, TURN_TIME_SECONDS, PLAYER_AVATARS } from './vf/data/gameConfig';
import { normalizeSettings, botLineup, LEVEL_SKILL, MAX_SEATS } from './settings.js';
import { plain, readMode } from './draft.js';

export { normalizeSettings, botLineup };
/** For the tests: how the engine state is read out of its Immer draft here (see draft.js). */
export const engineReadMode = readMode;

// ---- pacing: what the host's browser did, now done by the house ---------------
// Robot beats are the game's default "Steady" play speed (vf/game/playSpeed.js)
// with the per-turn acceleration from the old hooks/useGame.js. A browser's own
// speed slider used to pace the robots when that browser was the host; with no
// special browser any more there is one pace for the table.
export const PACE = {
  aiStepMs: 950,          // pause before each robot decision
  turnHandoffMs: 800,     // pause after a robot's last move, before the turn passes
  stepAcceleration: 0.82, // each move in the same robot turn comes a little faster
  stepFloorFactor: 0.3,
  absoluteStepFloorMs: 110,
  peekMs: 2600,           // a robot's card stays up long enough for everyone's peek
  personAckMs: 25000,     // a person's forgotten card or launch celebration is continued for them
  endingMs: 20000,        // the end-of-game recap, if nobody presses Continue
  stallMs: 80000,         // a live person's turn with no move: the table may replace them
  fastForwardMs: 120,     // every beat, once no person is playing any seat
};
/** Consecutive turns ended by the clock, with no action at all from the seat, before it counts as stalled. */
export const MISSED_TURNS_STALL = 2;
/** Mercy limit (house rule 9). A full game is a few thousand moves; this only stops a runaway. */
export const MERCY_MOVES = 12000;
const MAX_TRADE_QTY = 100000;
const CLOCK_GRACE_MS = 100;
const CHAT_MAX = 140;

export function stepDelayMs(stepsTaken) {
  const floor = Math.max(PACE.absoluteStepFloorMs, PACE.aiStepMs * PACE.stepFloorFactor);
  return Math.max(floor, Math.round(PACE.aiStepMs * PACE.stepAcceleration ** (stepsTaken || 0)));
}

// ---- style signals (first arena's SPEC section 6) --------------------------------
const MID_VOLATILITY = 0.12;
const BUSINESS_VOLATILITY = 0.30;
const MAX_VOLATILITY = 0.40;
const FIXED_COST = { START_BUSINESS: 300, UPGRADE_BUSINESS: 150, LEARN_SKILL: 100 };
const ASSET_IDS = ASSETS.map((a) => a.id);
const volatilityOf = (assetId) => { const a = ASSETS.find((x) => x.id === assetId); return a ? a.volatility : MID_VOLATILITY; };
const newStats = () => ({ spend: 0, weightedVol: 0, longSpend: 0, offersAccepted: 0, offersDeclined: 0, chats: 0 });
const clamp100 = (v) => Math.max(0, Math.min(100, Math.round(v)));

// ---- reading the engine state -----------------------------------------------------
const isLive = (p) => !!p && p.type === 'human';

/** Engine player id ('p1', 'ai2', ...) of an arena seat. Arena seat i is always players[i]. */
export function playerIdOf(G, seat) {
  const p = G && G.vf && G.vf.players[seat];
  return p ? p.id : null;
}
export function seatOfPlayer(vf, playerId) {
  return vf.players.findIndex((p) => p.id === playerId);
}
/**
 * The seat that acts as host for "Replace now": the lowest seat a person is
 * still playing. The table's host always holds seat 0 at the start; if they
 * resign, the next person down inherits the button, so a table is never left
 * without one.
 */
export function hostSeat(vf) {
  const i = vf.players.findIndex(isLive);
  return i < 0 ? null : i;
}

/** The fortune card currently on the table, or null. */
function currentCard(vf) {
  return vf.status === 'monthRecap' ? (vf.fortuneRecap || [])[vf.fortuneRecapIndex] || null : null;
}

/**
 * The seat that owes the table an action when that seat is a PERSON: the
 * active player, the owner of a pending buyout offer, or the owner of the
 * fortune card that is waiting for Continue. null whenever the house must act
 * (a robot's turn, a robot's card, the end-of-game pause).
 */
function owedSeat(vf) {
  let playerId = null;
  if (vf.status === 'playing') playerId = (vf.players[vf.activePlayerIndex] || {}).id;
  else if (vf.status === 'exitOffer') playerId = vf.pendingExitOffer ? vf.pendingExitOffer.playerId : null;
  else if (vf.status === 'monthRecap') { const card = currentCard(vf); playerId = card ? card.playerId : null; }
  const seat = playerId ? seatOfPlayer(vf, playerId) : -1;
  return seat >= 0 && isLive(vf.players[seat]) ? seat : null;
}

const scoresOf = (vf) => vf.players.map((p) => netWorth(p, vf.assetPrices));

/** The one place G.turnP, G.stall and the end of the game are brought in line with the engine state. */
function sync(G) {
  const vf = G.vf;
  // Terminal check first (house rule 7).
  if (vf.status === 'gameover') {
    const scores = scoresOf(vf);
    finish(G, placementsFromScores(scores), { scores, reason: 'months' });
  }
  const seat = owedSeat(vf);
  G.turnP = seat === null ? null : String(seat);
  // A stall only exists while that seat's own person still holds the turn.
  if (G.stall && (vf.status !== 'playing' || vf.activePlayerIndex !== G.stall.seat || !isLive(vf.players[G.stall.seat]))) G.stall = null;
}

// ---- setup -------------------------------------------------------------------------
function engineSeats(setupSeats, n) {
  const list = Array.isArray(setupSeats) ? setupSeats : [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = list[i] || {};
    if (s.bot) {
      const spec = s.botSpec && typeof s.botSpec === 'object' ? s.botSpec : {};
      // The arena resolves "surprise me" before the table starts (botLineup), so
      // the seat's name matches. A seat that arrives without a personality (the
      // workbench, a generic bot) is rolled by the engine from the table's seed.
      out.push({ type: 'ai', personalityId: spec.personalityId || 'random', skillLevelId: spec.skillLevelId || LEVEL_SKILL[spec.level] || 'random' });
    } else {
      out.push({ type: 'human', name: String(s.name || `Player ${i + 1}`).slice(0, 40), avatar: s.avatar || PLAYER_AVATARS[i] || '\u{1F642}' });
    }
  }
  return out;
}

function setup({ random, n }, setupData) {
  const settings = normalizeSettings(setupData.settings);
  const seats = engineSeats(setupData.seats, Math.min(n, MAX_SEATS));
  // The table's seed comes from the arena. Without one (the playout tests) it
  // is drawn from boardgame.io's own server-side RNG, never Math.random.
  const seed = typeof setupData.seed === 'number' && Number.isFinite(setupData.seed) ? setupData.seed : Math.floor(random.Number() * 2147483647);
  seedRng(seed);
  const humans = seats.filter((s) => s.type === 'human');
  const robots = seats.filter((s) => s.type === 'ai');
  const vf = gameReducer(null, {
    type: 'START_GAME',
    mode: { type: 'online', seats },
    humanNames: humans.map((s) => s.name),
    humanAvatars: humans.map((s) => s.avatar),
    botConfigs: robots.map((s) => ({ personalityId: s.personalityId, skillLevelId: s.skillLevelId })),
    difficultyId: settings.difficultyId,
    scenarioId: settings.scenarioId,
    weatherSeverityId: settings.weatherSeverityId,
    turnTimer: !!settings.turnTimer,
  });
  const G = {
    vf,
    secret: { rng: snapshotRng() },
    turnP: null,
    stall: null,                       // { seat } while the table may replace a silent player
    stats: seats.map(newStats),        // per-seat counters for the style signals
    missed: seats.map(() => 0),        // consecutive turns the clock ended with no action from the seat
    actN: 0,                           // counts real activity; boards time "idle for 40s" from its last change
    houseAt: null,                     // server clock at the last house move, so a board can correct its own
  };
  sync(G);
  return G;
}

// ---- who may send what (ported from the first arena's vf-move function) --------------
// Returns the action the reducer will be given, rebuilt from scratch so nothing
// a browser adds rides along, with the player id ALWAYS taken from the seat
// (failure-table rows 3 and 6). null means "not yours to send".
function personAction(G, vf, seat, raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return null;
  const me = vf.players[seat];
  if (!isLive(me)) return null; // a seat a robot is finishing sends nothing more
  const id = me.id;
  const type = raw.type;
  const myTurn = vf.status === 'playing' && vf.activePlayerIndex === seat;
  switch (type) {
    case 'BUY_ASSET':
    case 'SELL_ASSET': {
      if (!myTurn) return null;
      const qty = raw.qty === undefined ? 1 : raw.qty;
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_TRADE_QTY || !ASSET_IDS.includes(raw.assetId)) return null;
      return { type, playerId: id, assetId: raw.assetId, qty };
    }
    case 'START_BUSINESS': {
      if (!myTurn) return null;
      const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 40) : '';
      if (name && isOffensiveName(name)) return null; // the whole table reads this name
      return name ? { type, playerId: id, name } : { type, playerId: id };
    }
    case 'LEARN_SKILL':
    case 'END_TURN':
      return myTurn ? { type, playerId: id } : null;
    case 'UPGRADE_BUSINESS':
      if (!myTurn || typeof raw.businessId !== 'string' || !Object.prototype.hasOwnProperty.call(BUSINESS_UPGRADE_TRACKS, raw.trackId)) return null;
      return { type, playerId: id, businessId: raw.businessId, trackId: raw.trackId };
    case 'EXTEND_TURN':
      // The reducer extends from max(deadline, now). A browser's `now` cannot be
      // trusted, so the extension always counts from the running deadline.
      if (!myTurn || !vf.turnTimer || !vf.turnDeadlineAt) return null;
      return { type, playerId: id, now: 0 };
    case 'RESOLVE_EXIT_OFFER':
      if (vf.status !== 'exitOffer' || !vf.pendingExitOffer || vf.pendingExitOffer.playerId !== id || typeof raw.accept !== 'boolean') return null;
      return { type, playerId: id, accept: raw.accept };
    case 'ACK_FORTUNE_CARD': {
      const card = currentCard(vf);
      if (!card || card.playerId !== id) return null;
      // A double click must not also dismiss the NEXT card (which may be the same owner's).
      if (raw.index !== undefined && raw.index !== vf.fortuneRecapIndex) return null;
      return { type };
    }
    case 'ACK_STARTUP_LAUNCH':
      return vf.pendingLaunch && vf.pendingLaunch.playerId === id ? { type } : null;
    case 'SEND_CHAT': {
      const message = typeof raw.message === 'string' ? raw.message.trim().slice(0, CHAT_MAX) : '';
      if (!message || isOffensiveName(message)) return null;
      const target = typeof raw.targetPlayerId === 'string' && vf.players.some((p) => p.id === raw.targetPlayerId) ? raw.targetPlayerId : null;
      return { type, playerId: id, message, targetPlayerId: target };
    }
    case 'KICK_VOTE': {
      // Only against the seat the server has marked as stalled, only as yourself, never against yourself.
      const target = stalledPlayerId(G, vf);
      if (!target || raw.playerId !== target || target === id) return null;
      return { type, playerId: target, voterId: id };
    }
    case 'CONVERT_SEAT_TO_AI': {
      if (vf.status === 'gameover') return null;
      const target = raw.playerId === undefined || raw.playerId === null ? id : raw.playerId;
      if (target === id) return { type, playerId: id, reason: 'resigned' };
      // The host's "Replace now": only for the seat the server has marked as stalled.
      if (hostSeat(vf) !== seat || stalledPlayerId(G, vf) !== target) return null;
      return { type, playerId: target, reason: 'host' };
    }
    case 'FINALIZE_GAME_OVER':
      return vf.status === 'gameEnding' ? { type } : null;
    default:
      return null; // START_GAME, LOAD_GAME, RUN_AI_*, timers: never from a browser
  }
}

function stalledPlayerId(G, vf) {
  if (!G.stall) return null;
  const p = vf.players[G.stall.seat];
  return isLive(p) && vf.status === 'playing' && vf.activePlayerIndex === G.stall.seat ? p.id : null;
}

/** What the server's own seat may do. Everything here used to be done by "the host's browser". */
function houseAction(G, vf, raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return null;
  const type = raw.type;
  const active = vf.players[vf.activePlayerIndex];
  switch (type) {
    case 'RUN_AI_STEP':
      return vf.status === 'playing' && active && active.type === 'ai' && !vf.aiTurnDone ? { type, playerId: active.id } : null;
    case 'END_TURN': {
      if (vf.status !== 'playing' || !active) return null;
      if (active.type === 'ai') return vf.aiTurnDone ? { type, playerId: active.id } : null;
      // A person's turn ends from here only when the table's clock has run out.
      if (!vf.turnTimer || !vf.turnDeadlineAt || !(Number(raw.now) >= vf.turnDeadlineAt)) return null;
      return { type, playerId: active.id, clock: true };
    }
    case 'START_TURN_TIMER':
      if (vf.status !== 'playing' || !isLive(active) || !vf.turnTimer || vf.turnDeadlineAt || !Number.isFinite(raw.deadlineAt)) return null;
      return { type, deadlineAt: raw.deadlineAt };
    case 'ACK_FORTUNE_CARD': {
      if (!currentCard(vf)) return null;
      if (raw.index !== undefined && raw.index !== vf.fortuneRecapIndex) return null;
      return { type };
    }
    case 'ACK_STARTUP_LAUNCH':
      return vf.pendingLaunch ? { type } : null;
    case 'FINALIZE_GAME_OVER':
      return vf.status === 'gameEnding' ? { type } : null;
    case 'RESOLVE_EXIT_OFFER': {
      // Only for an offer whose owner a robot is now finishing for.
      const offer = vf.status === 'exitOffer' ? vf.pendingExitOffer : null;
      const owner = offer ? vf.players.find((p) => p.id === offer.playerId) : null;
      if (!owner || owner.type !== 'ai') return null;
      return { type, playerId: owner.id, accept: !!aiDecideExitOffer(owner, offer) };
    }
    case 'MARK_STALL': {
      if (vf.status !== 'playing' || !isLive(active) || raw.seat !== vf.activePlayerIndex) return null;
      return { type, seat: raw.seat };
    }
    case 'CONVERT_SEAT_TO_AI': {
      const p = vf.players.find((x) => x.id === raw.playerId);
      if (!isLive(p) || vf.status === 'gameover') return null;
      return { type, playerId: p.id, reason: ['resigned', 'host', 'vote'].includes(raw.reason) ? raw.reason : 'away' };
    }
    default:
      return null;
  }
}

/** Fold one accepted action into the seat's style counters, priced from the state BEFORE the move. */
function tally(G, vf, seat, a) {
  if (!Array.isArray(G.stats)) G.stats = vf.players.map(newStats);
  if (!G.stats[seat]) G.stats[seat] = newStats();
  const s = G.stats[seat];
  if (a.type === 'BUY_ASSET') {
    const cost = (vf.assetPrices[a.assetId] || 0) * a.qty;
    s.spend += cost; s.weightedVol += cost * volatilityOf(a.assetId);
  } else if (a.type === 'START_BUSINESS') {
    s.spend += FIXED_COST[a.type]; s.weightedVol += FIXED_COST[a.type] * BUSINESS_VOLATILITY; s.longSpend += FIXED_COST[a.type];
  } else if (a.type === 'UPGRADE_BUSINESS' || a.type === 'LEARN_SKILL') {
    s.spend += FIXED_COST[a.type]; s.weightedVol += FIXED_COST[a.type] * MID_VOLATILITY; s.longSpend += FIXED_COST[a.type];
  } else if (a.type === 'RESOLVE_EXIT_OFFER') {
    if (a.accept) s.offersAccepted += 1; else s.offersDeclined += 1;
  } else if (a.type === 'SEND_CHAT') {
    s.chats = (s.chats || 0) + 1;
  }
}

const QUIET = new Set(['SEND_CHAT', 'KICK_VOTE', 'START_TURN_TIMER']); // not counted toward the mercy limit

/**
 * Run one action through the engine and store the result.
 * The engine's RNG is module state shared by every table in this process, so
 * its cursor is restored from this table's snapshot before the call and saved
 * back after: the outcome depends only on (G, action).
 */
function apply(G, vf, a, seat) {
  if (!G.secret || !restoreRng(G.secret.rng)) return INVALID_MOVE;
  const next = gameReducer(vf, a);
  // A refused action changes nothing at all. The engine reports a failed
  // purchase by returning a state carrying `lastError`; online that state is
  // never stored (it would show one player's error to the whole table). The
  // board asks explain() first and shows the same message to that player only.
  if (!next || next === vf || next.lastError) return INVALID_MOVE;
  G.vf = next;
  G.secret.rng = snapshotRng();

  if (!Array.isArray(G.missed)) G.missed = next.players.map(() => 0);
  if (seat !== null) {
    tally(G, vf, seat, a);
    G.missed[seat] = 0;
    // Any action from the stalled seat is the cure: the mark and the votes go.
    if (G.stall && G.stall.seat === seat) {
      G.stall = null;
      if (next.kickVotes && next.kickVotes[vf.players[seat].id]) {
        const kickVotes = { ...next.kickVotes };
        delete kickVotes[vf.players[seat].id];
        G.vf = { ...next, kickVotes };
      }
    }
  } else if (a.type === 'END_TURN' && a.clock) {
    G.missed[vf.activePlayerIndex] = (G.missed[vf.activePlayerIndex] || 0) + 1;
  }
  // A seat that changed hands (resign, vote, host, away) goes in the arena's log.
  if (a.type === 'CONVERT_SEAT_TO_AI' || a.type === 'KICK_VOTE') {
    const i = seatOfPlayer(vf, a.playerId);
    if (i >= 0 && isLive(vf.players[i]) && !isLive(G.vf.players[i])) pushLog(G, { t: 'takeover', p: i, reason: G.vf.players[i].takeoverReason || 'away' });
  }
  if (a.type !== 'KICK_VOTE') G.actN = (typeof G.actN === 'number' ? G.actN : 0) + 1;
  sync(G);
  if (!QUIET.has(a.type) && countMove(G) >= MERCY_MOVES && !G.over) {
    const scores = scoresOf(G.vf);
    finish(G, placementsFromScores(scores), { scores, reason: 'mercy' });
    G.turnP = null;
  }
  return undefined;
}

export const ventureFlow = defineGame({
  name: 'ventureflow',
  minPlayers: 2,
  maxPlayers: 4,
  house: true,
  setup,
  moves: {
    /** A seated person's action. Legal out of turn for some types, so the turn check is per action. */
    act: ({ G, playerID }, action) => {
      if (refuse(G, playerID, { anySeat: true })) return INVALID_MOVE;
      if (isHouse(G, playerID)) return INVALID_MOVE;
      const seat = Number(playerID);
      const vf = plain(G.vf);
      if (!Number.isInteger(seat) || !vf.players[seat]) return INVALID_MOVE;
      const a = personAction(G, vf, seat, action);
      if (!a) return INVALID_MOVE;
      return apply(G, vf, a, seat);
    },
    /** The server's own seat: robots, timers, takeovers. No browser holds its credentials. */
    houseAct: ({ G, playerID }, action) => {
      if (refuse(G, playerID, { anySeat: true })) return INVALID_MOVE;
      if (!isHouse(G, playerID)) return INVALID_MOVE;
      const vf = plain(G.vf);
      const a = houseAction(G, vf, action);
      if (!a) return INVALID_MOVE;
      if (action && Number.isFinite(action.now)) G.houseAt = action.now;
      if (a.type === 'MARK_STALL') {
        if (G.stall && G.stall.seat === a.seat) return INVALID_MOVE;
        G.stall = { seat: a.seat };
        return undefined;
      }
      return apply(G, vf, a, null);
    },
  },
});

// ---- what the board asks ------------------------------------------------------------
/** True when `seat` may send `action` right now. The board never decides this itself. */
export function allowed(G, seat, action) {
  if (!G || G.over || seat === null || seat === undefined || !G.vf.players[seat]) return false;
  return personAction(G, G.vf, seat, action) !== null;
}

/**
 * Why an action a person is about to send would fail, in the engine's own
 * words ("Not enough cash for Tree House."), or null if it would go through.
 * A dry run of the reducer on the board's copy of the state; the result is
 * thrown away. Only for the purchase-type actions, whose failure checks all
 * run before any random roll.
 */
const EXPLAINED = new Set(['BUY_ASSET', 'SELL_ASSET', 'START_BUSINESS', 'LEARN_SKILL', 'UPGRADE_BUSINESS', 'EXTEND_TURN']);
export function explain(G, seat, action) {
  if (!G || G.over || !action || seat === null || seat === undefined || !G.vf.players[seat]) return null;
  if (action.type === 'START_BUSINESS' && typeof action.name === 'string' && isOffensiveName(action.name)) return 'Please pick a different name.';
  if (!EXPLAINED.has(action.type)) return null;
  const a = personAction(G, G.vf, seat, action);
  if (!a) return null;
  try {
    const next = gameReducer(G.vf, a);
    return next && next.lastError ? next.lastError : null;
  } catch {
    return null;
  }
}

/** The player the table may currently vote out or the host may replace, or null. */
export function stalledPlayer(G) {
  return G && G.vf && !G.over ? stalledPlayerId(G, G.vf) : null;
}

// ---- the server's own seat: robots and timers ----------------------------------------
/**
 * The next thing the house should do, and how long after the last state change
 * (`afterMs`). Only one chore is returned: the one that falls due soonest.
 * `table.lastMoveAt` is when the state last changed; without a table (tests,
 * the workbench) every delay counts from now.
 */
export function housekeeping(G, { now = 0, table = null } = {}) {
  if (!G || G.over || !G.vf) return null;
  const vf = G.vf;
  const since = table && Number.isFinite(table.lastMoveAt) ? Math.max(0, now - table.lastMoveAt) : 0;
  const after = (ms) => Math.max(0, ms - since);
  const chores = [];
  // When every seat is a robot's (everyone resigned, left or was voted out)
  // there is no turn to wait for and nobody to pace it for: the rest of the
  // game is fast-forwarded so whoever stayed to watch reaches the result in a
  // minute or two instead of a quarter of an hour.
  const quick = !vf.players.some(isLive);
  const add = (afterMs, action, exact = false) => chores.push({ move: 'houseAct', args: [{ ...action, now }], afterMs: quick ? Math.min(afterMs, PACE.fastForwardMs) : afterMs, exact });

  if (vf.status === 'gameEnding') {
    add(after(PACE.endingMs), { type: 'FINALIZE_GAME_OVER' });
  } else if (vf.status === 'monthRecap') {
    const card = currentCard(vf);
    if (card) {
      const owner = vf.players.find((p) => p.id === card.playerId);
      // A robot's card moves on once everyone has had their peek; a person's
      // card is theirs to continue, and is continued for them if they forgot.
      add(after(isLive(owner) ? PACE.personAckMs : PACE.peekMs), { type: 'ACK_FORTUNE_CARD', index: vf.fortuneRecapIndex });
    }
  } else if (vf.status === 'exitOffer') {
    const offer = vf.pendingExitOffer;
    const owner = offer ? vf.players.find((p) => p.id === offer.playerId) : null;
    // A person decides their own offer (the arena's idle sweep hands the seat to
    // a robot if they never do); a seat a robot now plays is answered here.
    if (owner && owner.type === 'ai') add(after(PACE.turnHandoffMs), { type: 'RESOLVE_EXIT_OFFER', playerId: owner.id });
  } else if (vf.status === 'playing') {
    const seat = vf.activePlayerIndex;
    const active = vf.players[seat];
    if (vf.pendingLaunch) {
      const founder = vf.players.find((p) => p.id === vf.pendingLaunch.playerId);
      add(after(isLive(founder) ? PACE.personAckMs : PACE.peekMs), { type: 'ACK_STARTUP_LAUNCH' });
    }
    if (active && active.type === 'ai') {
      if (vf.aiTurnDone) add(after(PACE.turnHandoffMs), { type: 'END_TURN', playerId: active.id });
      else add(after(stepDelayMs(vf.aiTurnSteps)), { type: 'RUN_AI_STEP', playerId: active.id });
    } else if (isLive(active)) {
      const others = vf.players.some((p, i) => i !== seat && isLive(p));
      const marked = !!G.stall && G.stall.seat === seat;
      if (vf.turnTimer) {
        if (!vf.turnDeadlineAt) add(0, { type: 'START_TURN_TIMER', deadlineAt: now + TURN_TIME_SECONDS * 1000 });
        else {
          // A hair past the deadline: a timer that fires a millisecond early would be refused.
          add(Math.max(0, vf.turnDeadlineAt - now) + CLOCK_GRACE_MS, { type: 'END_TURN', playerId: active.id }, true);
          // On a clocked table a silent seat never reaches 80 seconds: the clock
          // ends its turn first. Two turns in a row lost to the clock with no
          // action at all is the same silence, so the table may act on the third.
          if (others && !marked && ((G.missed || [])[seat] || 0) >= MISSED_TURNS_STALL) add(0, { type: 'MARK_STALL', seat });
        }
      } else if (others && !marked) {
        add(after(PACE.stallMs), { type: 'MARK_STALL', seat });
      }
    }
  }
  if (!chores.length) return null;
  return chores.reduce((best, c) => (c.afterMs < best.afterMs ? c : best));
}

/** A person left the table or was timed out by the arena: a robot finishes their seat. */
export function onLeave(G, seat, reason) {
  const p = G && G.vf ? G.vf.players[seat] : null;
  if (!isLive(p) || G.over) return null;
  return { as: 'house', move: 'houseAct', args: [{ type: 'CONVERT_SEAT_TO_AI', playerId: p.id, reason: reason === 'resigned' ? 'resigned' : 'away' }] };
}

// ---- what the arena learns from a finished game ----------------------------------------
/** Rank at the half-way point: 1 + the number of OTHER players strictly richer at month 12. */
function midRank(vf, seat) {
  const at12 = (p) => { const e = (p.netWorthHistory || []).find((x) => x.month === 12); return e ? e.netWorth : null; };
  const mine = at12(vf.players[seat]);
  if (mine === null || vf.players.length < 2) return undefined;
  return 1 + vf.players.filter((p, i) => i !== seat && at12(p) !== null && at12(p) > mine).length;
}

export function telemetry(G, seat) {
  const vf = G.vf;
  const p = vf.players[seat];
  if (!p) return { metrics: {}, skillTags: [] };
  const worth = netWorth(p, vf.assetPrices);
  const holdings = { ...(p.holdings || {}) };
  const cards = p.fortuneCardHistory || [];
  const st = (Array.isArray(G.stats) && G.stats[seat]) || newStats();
  const offers = st.offersAccepted + st.offersDeclined;
  const out = {
    // Exactly the fields the old reportArenaResults() sent, plus `score`.
    metrics: {
      netWorth: worth,
      cash: Math.round(p.cash),
      passive: Math.round(passiveIncome(p, { allPlayers: vf.players, prices: vf.assetPrices, month: vf.month, weatherIncomeAmounts: vf.weatherIncomeAmounts })),
      businesses: (p.businesses || []).length,
      badges: (p.badges || []).length,
      holdings,
      units: Object.values(holdings).reduce((a, b) => a + b, 0),
      spent: Object.values(p.purchaseStats || {}).reduce((a, x) => a + (x.spent || 0), 0),
      goodCards: cards.filter((c) => c.deckId === 'opportunity').length,
      badCards: cards.filter((c) => c.deckId !== 'opportunity').length,
      tookOver: p.type === 'ai',
      takeoverReason: p.takeoverReason || null,
      finishedBy: p.finishedBy || null,
      scenarioId: vf.scenarioId,
      difficultyId: vf.difficultyId,
      weatherSeverityId: vf.weatherSeverityId,
      months: vf.month,
      goalMonth: p.scenarioGoalMonth ?? null,
      score: worth,
    },
    skillTags: [
      'cash flow',
      ...((p.businesses || []).length ? ['business building'] : []),
      ...(Object.keys(holdings).filter((k) => holdings[k] > 0).length >= 3 ? ['diversification'] : []),
    ],
    signals: {
      risk: clamp100(st.spend > 0 ? (st.weightedVol / st.spend / MAX_VOLATILITY) * 100 : 35),
      horizon: clamp100(st.spend > 0 ? (st.longSpend / st.spend) * 100 : 40),
      negotiation: clamp100(offers === 0 ? 50 : 50 + (25 * (st.offersDeclined - st.offersAccepted)) / offers),
      // The arena adds its own table talk on top of this base. Most of a
      // VentureFlow table's talking happens in the game's own chat panel.
      cooperation: clamp100(35 + Math.min(st.chats || 0, 8) * 8),
    },
  };
  const mid = midRank(vf, seat);
  if (mid !== undefined) out.midRank = mid;
  return out;
}

/** "How you played" lines for the debrief. The arena adds the win and takeover lines itself. */
export function observations(metrics, placement) {
  const m = metrics || {};
  const o = [];
  if ((m.businesses ?? 0) >= 2) o.push(`Builder: started ${m.businesses} businesses`);
  else if ((m.businesses ?? 0) === 1) o.push('Started a business');
  if ((m.passive ?? 0) >= 150) o.push(`Cashflow engine: $${Math.round(m.passive).toLocaleString('en-US')}/month passive at the end`);
  if ((m.units ?? 0) >= 30) o.push(`Accumulator: ${m.units} units held across assets`);
  if ((m.badCards ?? 0) > (m.goodCards ?? 0) && placement === 1) o.push('Resilient: won despite more bad fortune cards than good');
  if ((m.goodCards ?? 0) + (m.badCards ?? 0) > 0) o.push(`Fortune: ${m.goodCards ?? 0} good · ${m.badCards ?? 0} bad`);
  if (m.goalMonth) o.push(`Hit the scenario goal in month ${m.goalMonth}`);
  return o;
}

/** One line on how a member plays VentureFlow, from the metrics of all their games. null with no games. */
export function playStyle(metricsList) {
  const list = (Array.isArray(metricsList) ? metricsList : []).filter(Boolean);
  if (!list.length) return null;
  const avg = (k) => list.reduce((a, m) => a + (Number(m[k]) || 0), 0) / list.length;
  if (avg('businesses') >= 2) return 'Builder: starts businesses early and often';
  if (avg('passive') >= 150) return 'Cashflow-minded: stacks passive income';
  if (avg('units') >= 30) return 'Accumulator: buys in volume and rides the market';
  return 'Balanced: mixes cash, assets and businesses';
}
