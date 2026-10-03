// Reversi: pure rules. No React, no DOM, no clock, no Math.random.
// The board, the bot and the move validator all import flipsFor() and
// legalMoves() from here, so they share ONE definition of what is legal.
import { defineGame, refuse, pushLog, countMove, finish, twoSeatPlacements, INVALID_MOVE } from '../kit.js';

export const SIZE = 8;
export const CELLS = SIZE * SIZE;
/** 60 empty squares at the start, so 60 placements at most. The limit only
 *  exists so the mercy rule is uniform across games. */
export const MERCY_MOVES = CELLS;

/** Plies during which a move beside an empty corner counts as a gamble. */
export const RISK_WINDOW = 40;

export const idx = (row, col) => row * SIZE + col;

// The eight directions as two flat lists: this runs in the bot's inner loop.
const DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const DC = [-1, 0, 1, -1, 1, -1, 0, 1];
export const CORNERS = [0, 7, 56, 63];
/** Squares that touch a corner, with the corner each one gives away. Playing
 *  one while its corner is empty is the classic way to lose that corner. */
export const CORNER_NEIGHBOURS = { 1: 0, 8: 0, 9: 0, 6: 7, 14: 7, 15: 7, 48: 56, 49: 56, 57: 56, 54: 63, 55: 63, 62: 63 };

const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

/**
 * Discs `seat` would flip by placing on `cell`: every unbroken run of the
 * opponent's discs that ends on one of seat's own. Empty means the placement
 * is illegal. Works on any 64-long array of null | 0 | 1.
 */
export function flipsFor(board, seat, cell) {
  if (board[cell] !== null) return [];
  const opp = 1 - seat;
  const row = (cell / SIZE) | 0, col = cell % SIZE;
  const out = [];
  for (let d = 0; d < 8; d++) {
    const dr = DR[d], dc = DC[d];
    let r = row + dr, c = col + dc;
    if (!inside(r, c) || board[r * SIZE + c] !== opp) continue;
    const start = out.length;
    do { out.push(r * SIZE + c); r += dr; c += dc; } while (inside(r, c) && board[r * SIZE + c] === opp);
    // A run only counts when it is capped by one of the mover's own discs.
    if (!inside(r, c) || board[r * SIZE + c] !== seat) out.length = start;
  }
  return out;
}

/** True when flipsFor() would be non-empty. Same walk, stops at the first run. */
export function canPlace(board, seat, cell) {
  if (board[cell] !== null) return false;
  const opp = 1 - seat;
  const row = (cell / SIZE) | 0, col = cell % SIZE;
  for (let d = 0; d < 8; d++) {
    const dr = DR[d], dc = DC[d];
    let r = row + dr, c = col + dc;
    if (!inside(r, c) || board[r * SIZE + c] !== opp) continue;
    do { r += dr; c += dc; } while (inside(r, c) && board[r * SIZE + c] === opp);
    if (inside(r, c) && board[r * SIZE + c] === seat) return true;
  }
  return false;
}

/** Every square `seat` could place on in this position, whoever's turn it is. */
export function boardMoves(board, seat) {
  const out = [];
  for (let cell = 0; cell < CELLS; cell++) if (canPlace(board, seat, cell)) out.push(cell);
  return out;
}

export function hasMove(board, seat) {
  for (let cell = 0; cell < CELLS; cell++) if (canPlace(board, seat, cell)) return true;
  return false;
}

/** Squares the seat may place on right now. The single source of legality:
 *  empty when the game is over or it is not that seat's turn. */
export function legalMoves(G, seat = Number(G.turnP)) {
  if (G.over || String(G.turnP) !== String(seat)) return [];
  return boardMoves(G.board, Number(seat));
}

/** Discs on the board as [seat 0, seat 1]. */
export function counts(board) {
  let a = 0, b = 0;
  for (let cell = 0; cell < CELLS; cell++) { if (board[cell] === 0) a++; else if (board[cell] === 1) b++; }
  return [a, b];
}

const blankStat = () => ({ moves: 0, flips: 0, corners: 0, risky: 0, choices: 0, greedy: 0, passes: 0 });
/** Per-seat counters for telemetry. Guarded where written (house rule 3.5). */
function statOf(G, seat) {
  if (!Array.isArray(G.stat) || G.stat.length !== 2) G.stat = [blankStat(), blankStat()];
  return G.stat[seat];
}

function end(G) {
  const [a, b] = counts(G.board);
  const winner = a > b ? 0 : b > a ? 1 : null;
  finish(G, twoSeatPlacements(winner), { reason: winner === null ? 'draw' : 'win', scores: [a, b] });
}

function startBoard() {
  const board = Array(CELLS).fill(null);
  // Seat 0 moves first, so it takes the squares the first player holds in
  // the standard opening: e4 and d5 (seat 1 has d4 and e5).
  board[idx(3, 3)] = 1; board[idx(4, 4)] = 1;
  board[idx(3, 4)] = 0; board[idx(4, 3)] = 0;
  return board;
}

export const reversi = defineGame({
  name: 'reversi',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: startBoard(), turnP: '0', stat: [blankStat(), blankStat()], trail: [] }),
  moves: {
    place: ({ G, playerID }, cell) => {
      if (refuse(G, playerID)) return INVALID_MOVE;
      const seat = Number(playerID);
      if (seat !== 0 && seat !== 1) return INVALID_MOVE;
      const legal = legalMoves(G, seat);
      if (!Number.isInteger(cell) || !legal.includes(cell)) return INVALID_MOVE;
      const flips = flipsFor(G.board, seat, cell);

      // What the choice says about the player, read before the board changes.
      const st = statOf(G, seat);
      st.moves += 1;
      st.flips += flips.length;
      if (CORNERS.includes(cell)) st.corners += 1;
      // Only while the board is open: in the last third these squares are
      // often all that is left, and taking one is no longer a choice.
      const corner = CORNER_NEIGHBOURS[cell];
      if (corner !== undefined && G.board[corner] === null && (G.moveN || 0) < RISK_WINDOW) st.risky += 1;
      // First half only: grabbing the most discs early is the short-term
      // play; in the last moves it is simply correct, so it is not counted.
      if ((G.moveN || 0) < 30 && legal.length > 1) {
        let lo = Infinity, hi = 0;
        for (const c of legal) { const k = flipsFor(G.board, seat, c).length; if (k < lo) lo = k; if (k > hi) hi = k; }
        if (hi > lo) { st.choices += 1; if (flips.length === hi) st.greedy += 1; }
      }

      G.board[cell] = seat;
      for (const f of flips) G.board[f] = seat;
      const moveN = countMove(G);
      pushLog(G, { t: 'place', p: seat, cell, flips });
      // The lead, sampled every fourth move, so telemetry can say who was
      // ahead at the midpoint of a game of any length.
      if (moveN % 4 === 0) {
        if (!Array.isArray(G.trail)) G.trail = [];
        const [a, b] = counts(G.board);
        G.trail.push(a - b);
      }

      // Terminal conditions before anything else. The game ends when neither
      // side can place, which covers a full board and a wipe-out too.
      const opp = 1 - seat;
      const oppCan = hasMove(G.board, opp);
      const meCan = oppCan ? true : hasMove(G.board, seat);
      if ((!oppCan && !meCan) || moveN >= MERCY_MOVES) { end(G); return undefined; }
      if (oppCan) { G.turnP = String(opp); return undefined; }
      // The opponent has nowhere to go: they pass here, in the rules, so
      // nobody is ever asked to click a move that does nothing.
      statOf(G, opp).passes += 1;
      pushLog(G, { t: 'pass', p: opp });
      return undefined;
    },
  },
});

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

/** What the arena learns about how this seat played (see server/arena/play.js). */
export function telemetry(G, seat) {
  const st = Array.isArray(G.stat) && G.stat[seat] ? G.stat[seat] : blankStat();
  const other = Array.isArray(G.stat) && G.stat[1 - seat] ? G.stat[1 - seat] : blankStat();
  const out = {
    metrics: {
      moves: st.moves,
      discs: counts(G.board)[seat],
      flips: st.flips,
      corners: st.corners,
      cornerRisks: st.risky,
      passesForced: other.passes,
    },
    skillTags: ['positioning', 'patience', 'planning ahead'],
  };
  // Style signals only from a real sample; a three-move resignation says nothing.
  if (st.moves >= 10) {
    const signals = {
      // Share of moves made next to an empty corner: each one bets the
      // corner. A careful player sits near 4% (35); one in five reads 75.
      risk: clamp(25 + 250 * (st.risky / st.moves)),
    };
    // Share of first-half choices where the player did NOT take the biggest
    // immediate flip. Always grabbing the most discs reads 0.
    if (st.choices >= 6) signals.horizon = clamp(100 * (1 - st.greedy / st.choices));
    out.signals = signals;
  }
  // Rank by discs at the midpoint; an even count shares first place.
  const trail = Array.isArray(G.trail) ? G.trail : [];
  if (trail.length >= 2) {
    const lead = trail[Math.floor((trail.length - 1) / 2)] * (seat === 0 ? 1 : -1);
    out.midRank = lead >= 0 ? 1 : 2;
  }
  return out;
}
