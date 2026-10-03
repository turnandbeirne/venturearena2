// ============================================================================
// Game kit: the handful of rules every VentureArena game shares.
// ----------------------------------------------------------------------------
// HOUSE-RULES.md is the long form. The short form, and the bug behind each:
//
//  * Turn order is OUR field (G.turnP), not boardgame.io's ctx.currentPlayer.
//    boardgame.io's turn never ends; every seat may send a move at any time and
//    every move starts with refuse(). (Bug this prevents: ctx.currentPlayer and
//    the game's own idea of "whose go" drifting apart after an extra turn.)
//  * Every move is { client: false }. With PlayerView.STRIP_SECRETS the browser
//    holds a stripped G; an optimistic client-side run of a move reads fields
//    that are not there and crashes the board. The server is the only place a
//    move ever runs.
//  * Matches persist, so setup() never re-runs for a game in progress. Any
//    field added after launch must be guarded WHERE IT IS WRITTEN (see
//    pushLog). An unguarded new field crashes every live table on deploy.
//  * No "last thing that happened" slot. An append-only, capped log with a
//    monotonic counter (G.logN) is the only history. Boards key animations and
//    toasts off the counter, so two events in one update are both seen and a
//    re-render never replays one.
//  * Terminal check first, then "is something resolving", then "is it your go".
//  * Every game has a mercy limit so a stalemate ends.
// ============================================================================
import { INVALID_MOVE, PlayerView, ActivePlayers } from 'boardgame.io/core';

export { INVALID_MOVE };

/** Log entries kept in G. Old entries fall off; the counter never resets. */
export const LOG_CAP = 80;

/**
 * Append to the action log. Guards both fields where they are written so a
 * match created before the log existed keeps working (see header).
 */
export function pushLog(G, entry) {
  if (!Array.isArray(G.log)) G.log = [];
  if (typeof G.logN !== 'number') G.logN = 0;
  G.logN += 1;
  G.log.push({ n: G.logN, ...entry });
  if (G.log.length > LOG_CAP) G.log.splice(0, G.log.length - LOG_CAP);
  return G.logN;
}

/** Count a move toward the mercy limit. Returns the new total. */
export function countMove(G) {
  if (typeof G.moveN !== 'number') G.moveN = 0;
  G.moveN += 1;
  return G.moveN;
}

/**
 * The three guards every move starts with, in this order:
 * finished game, a round that is still resolving, somebody else's turn.
 * Returns true when the move must be refused.
 *   anySeat      - the move is legal out of turn (resign, reactions)
 *   whileResolving - the move is part of the resolution itself
 */
export function refuse(G, playerID, { anySeat = false, whileResolving = false } = {}) {
  if (G.over) return true;
  if (G.resolving && !whileResolving) return true;
  if (playerID === null || playerID === undefined) return true;
  if (!anySeat && String(G.turnP) !== String(playerID)) return true;
  return false;
}

/**
 * End the game. `placements[seat]` is 1 for first place; ties share a number.
 * Idempotent: the first call wins, so a late duplicate can never rewrite a
 * recorded result.
 */
export function finish(G, placements, extra = {}) {
  if (G.over) return;
  G.over = { placements, ...extra };
  G.resolving = false;
  pushLog(G, { t: 'over', placements, reason: extra.reason || 'win' });
}

/** Placements for a two-seat game: winner 1 / loser 2, or both 1 on a draw. */
export function twoSeatPlacements(winnerSeat) {
  if (winnerSeat === null || winnerSeat === undefined) return [1, 1];
  return Number(winnerSeat) === 0 ? [1, 2] : [2, 1];
}

/** Rank seats by score, highest first; equal scores share a placement. */
export function placementsFromScores(scores, tiebreak = null) {
  const order = scores.map((s, i) => i).sort((a, b) => {
    if (scores[b] !== scores[a]) return scores[b] - scores[a];
    return tiebreak ? tiebreak(a, b) : 0;
  });
  const placements = new Array(scores.length).fill(0);
  order.forEach((seat, pos) => {
    const prev = pos > 0 ? order[pos - 1] : null;
    const tied = prev !== null && scores[prev] === scores[seat] && (!tiebreak || tiebreak(prev, seat) === 0);
    placements[seat] = tied ? placements[prev] : pos + 1;
  });
  return placements;
}

/** Number of seats that play. Games with a house seat reserve the last id. */
export function seatCount(G, ctx) {
  if (typeof G.n === 'number') return G.n;
  return ctx.numPlayers;
}

/**
 * Wrap a plain definition into a boardgame.io game that follows the house
 * rules above. Each game file calls this once and exports the result.
 *
 *   name         - boardgame.io game name (also the socket namespace)
 *   minPlayers / maxPlayers - seats that play (house seat not counted)
 *   house        - true when the server needs its own seat for timers and
 *                  robots (see below)
 *   secret       - true when the game has hidden information
 *   setup(ctx, setupData, n) -> G   (n = seats that play)
 *   moves        - { name: ({G, ctx, playerID, random}, ...args) => void | INVALID_MOVE }
 *
 * The house seat: boardgame.io only accepts moves from a player id. Timers,
 * robot seats inside an engine, and "nobody answered, move on" all need a
 * caller no browser can impersonate. Games that need one get one extra player
 * id (the last) whose credentials never leave the server; `isHouse()` guards
 * those moves. Passing a secret as a move argument would not work: move
 * arguments are written to the log every browser receives.
 */
export function defineGame(def) {
  const moves = {};
  for (const [name, fn] of Object.entries(def.moves)) {
    // secret: true redacts every move's arguments from boardgame.io's own
    // log, which is broadcast to the whole table ("give card X" must not
    // tell everyone which card).
    moves[name] = { move: fn, client: false, ...(def.secret ? { redact: true } : {}) };
  }
  // Every 2-seat game can be resigned; multi-seat games hand the seat to a bot
  // at the table level instead (see server/arena/tables.js forfeit()).
  if (!moves.resign && def.maxPlayers === 2) {
    moves.resign = {
      client: false,
      move: ({ G, playerID }) => {
        if (refuse(G, playerID, { anySeat: true, whileResolving: true })) return INVALID_MOVE;
        const seat = Number(playerID);
        if (seat !== 0 && seat !== 1) return INVALID_MOVE;
        pushLog(G, { t: 'resign', p: seat });
        finish(G, twoSeatPlacements(1 - seat), { reason: 'resign' });
        return undefined;
      },
    };
  }
  const house = !!def.house;
  return {
    name: def.name,
    minPlayers: def.minPlayers + (house ? 1 : 0),
    maxPlayers: def.maxPlayers + (house ? 1 : 0),
    setup: ({ ctx, random }, setupData) => {
      const n = ctx.numPlayers - (house ? 1 : 0);
      const G = def.setup({ ctx, random, n }, setupData || {});
      G.n = n;
      if (house) G.house = String(n);
      if (!Array.isArray(G.log)) G.log = [];
      if (typeof G.logN !== 'number') G.logN = 0;
      if (typeof G.moveN !== 'number') G.moveN = 0;
      if (G.over === undefined) G.over = null;
      if (G.resolving === undefined) G.resolving = false;
      return G;
    },
    moves,
    // One boardgame.io turn for the whole game, everyone active: our own
    // G.turnP decides who may act (see header).
    turn: { activePlayers: ActivePlayers.ALL },
    endIf: ({ G }) => (G.over ? G.over : undefined),
    playerView: PlayerView.STRIP_SECRETS,
    disableUndo: true,
    // Not part of boardgame.io: read by the arena.
    arena: { house, seatsMin: def.minPlayers, seatsMax: def.maxPlayers },
  };
}

/** True when the caller is the server's own seat. */
export function isHouse(G, playerID) {
  return G.house !== undefined && String(playerID) === String(G.house);
}

/**
 * Seats that owe the table an action right now: the reaction list when a game
 * is waiting on several people (G.waiting), else the seat whose turn it is.
 * The board uses it for "your move", the bot runner to know which bot to
 * wake, and the idle sweep to know who is stalling.
 */
export function actingSeats(G) {
  if (!G || G.over) return [];
  if (Array.isArray(G.waiting) && G.waiting.length) return G.waiting.map(Number);
  if (G.turnP === null || G.turnP === undefined) return [];
  return [Number(G.turnP)];
}

// ---- dice and other random draws ---------------------------------------------
// A game that rolls dice (or draws anything else at random) records each
// outcome here, and the table's "Rolls" tab draws the histogram from it. Only
// counts are kept, so the record never grows with the length of the game.
// Guarded where it is written, like the log: a match created before a game
// started recording keeps working.

/**
 * Record one random outcome. `die` names what was rolled ("d6", "2d6",
 * "weather"); `value` is what came up (a number, or a short label).
 */
export function recordRoll(G, die, value) {
  if (!G.rolls || typeof G.rolls !== 'object') G.rolls = {};
  const d = String(die);
  if (!G.rolls[d] || typeof G.rolls[d] !== 'object') G.rolls[d] = {};
  const v = String(value);
  G.rolls[d][v] = (G.rolls[d][v] || 0) + 1;
}

/** What every outcome of one fair die roll is expected to come up, in a share of 1. */
const DICE_ODDS = {
  d6: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, 1 / 6])),
  '2d6': Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => [n, (6 - Math.abs(7 - n)) / 36])),
};

/**
 * The record as chart data: one chart per die.
 *   [{ id, title, unit, total, bars: [{ label, value, expected? }] }]
 * `faces` puts the bars in order and shows the faces that have not come up
 * yet; `expected` (a share of 1 per face) lets the chart say what a fair die
 * would have given. Plain dice ("d6", "2d6") get both for free.
 */
export function rollCharts(G, defs = {}) {
  const rolls = G && G.rolls && typeof G.rolls === 'object' ? G.rolls : {};
  const out = [];
  for (const die of Object.keys(rolls)) {
    const seen = rolls[die] || {};
    const def = defs[die] || {};
    const odds = def.expected || DICE_ODDS[die] || null;
    const faces = (def.faces || (odds ? Object.keys(odds) : Object.keys(seen))).map(String);
    for (const k of Object.keys(seen)) if (!faces.includes(k)) faces.push(k);
    const total = Object.values(seen).reduce((a, b) => a + b, 0);
    out.push({
      id: die, title: def.title || `Rolls of the ${die}`, unit: def.unit || 'rolls', total,
      bars: faces.map((f) => ({ label: def.labels && def.labels[f] ? def.labels[f] : f, value: seen[f] || 0, ...(odds && odds[f] !== undefined ? { expected: odds[f] * total } : {}) })),
    });
  }
  return out;
}
