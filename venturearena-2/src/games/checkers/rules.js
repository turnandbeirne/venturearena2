// Checkers (English draughts): pure rules. No React, no DOM, no clock, no
// Math.random. The board, the bot and the move validator all import
// movesFor() / legalMoves() / applyMove() from here, so they share ONE
// definition of what is legal and of what a move does.
import { defineGame, refuse, pushLog, countMove, finish, twoSeatPlacements, INVALID_MOVE } from '../kit.js';

export const SIZE = 8;
export const CELLS = SIZE * SIZE;
/** Draw after this many plies in a row (40 by each side) with no capture
 *  and no man moved: only kings shuffling, nothing can change. */
export const QUIET_PLIES = 80;
/** Hard stop on single steps (each jump of a multi-jump counts as one).
 *  Real games finish in well under half of this. */
export const MERCY_MOVES = 400;

// Square contents. Integers so a position is cheap to copy in the bot.
export const EMPTY = 0;
export const MAN = [1, 3];
export const KING = [2, 4];
/** Seat that owns a piece, or null for an empty square. */
export const ownerOf = (v) => (v === EMPTY || v === null || v === undefined ? null : v <= 2 ? 0 : 1);
export const isKing = (v) => v === 2 || v === 4;

export const idx = (row, col) => row * SIZE + col;
export const rowOf = (cell) => (cell / SIZE) | 0;
export const colOf = (cell) => cell % SIZE;
/** Play happens on the dark squares only. */
export const isDark = (cell) => (rowOf(cell) + colOf(cell)) % 2 === 1;
/** Row a seat's men are crowned on: seat 0 starts at the bottom and moves up. */
export const kingRow = (seat) => (seat === 0 ? 0 : SIZE - 1);

// Diagonal steps as flat lists: the first two go up the board (seat 0's
// forward), the last two go down (seat 1's forward). Kings use all four.
const DR = [-1, -1, 1, 1];
const DC = [-1, 1, -1, 1];
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

/** Adds the piece's captures to `jumps` and, if `steps` is given, its plain
 *  moves to `steps`. One walk for both, because the bot calls this a lot. */
function scan(board, from, jumps, steps) {
  const v = board[from];
  const seat = ownerOf(v);
  if (seat === null) return;
  const king = isKing(v);
  const row = rowOf(from), col = colOf(from);
  const first = king || seat === 0 ? 0 : 2, last = king || seat === 1 ? 4 : 2;
  for (let d = first; d < last; d++) {
    const r1 = row + DR[d], c1 = col + DC[d];
    if (!inside(r1, c1)) continue;
    const near = board[idx(r1, c1)];
    if (near === EMPTY) { if (steps) steps.push({ from, to: idx(r1, c1), over: null }); continue; }
    if (ownerOf(near) === seat) continue;
    const r2 = r1 + DR[d], c2 = c1 + DC[d];
    if (inside(r2, c2) && board[idx(r2, c2)] === EMPTY) jumps.push({ from, to: idx(r2, c2), over: idx(r1, c1) });
  }
}

/** Captures the piece on `from` can make: { from, to, over }. */
export function jumpsFrom(board, from) {
  const jumps = [];
  scan(board, from, jumps, null);
  return jumps;
}

/** Plain one-square moves the piece on `from` can make: { from, to, over: null }. */
export function stepsFrom(board, from) {
  const steps = [];
  scan(board, from, [], steps);
  return steps;
}

/**
 * Every move `seat` may make in this position. Captures are mandatory: if
 * any piece can capture, only captures are returned. `mustFrom` is the piece
 * in the middle of a multi-jump; only it may move, and only by capturing.
 */
export function movesFor(board, seat, mustFrom = null) {
  if (mustFrom !== null && mustFrom !== undefined) return ownerOf(board[mustFrom]) === seat ? jumpsFrom(board, mustFrom) : [];
  const jumps = [], steps = [];
  for (let cell = 0; cell < CELLS; cell++) if (ownerOf(board[cell]) === seat) scan(board, cell, jumps, steps);
  return jumps.length ? jumps : steps;
}

/** Moves the seat may make right now. The single source of legality: empty
 *  when the game is over or it is not that seat's turn. */
export function legalMoves(G, seat = Number(G.turnP)) {
  if (G.over || String(G.turnP) !== String(seat)) return [];
  return movesFor(G.board, Number(seat), G.mustFrom === undefined ? null : G.mustFrom);
}

/**
 * Play one step on `board` (mutates it). Returns what happened:
 *   captured - the piece taken (EMPTY for a plain move)
 *   crowned  - a man reached the far row and became a king
 *   more     - the same piece must jump again. Never after a crowning: in
 *              English draughts the move ends when a man is crowned.
 */
export function applyMove(board, mv) {
  const v = board[mv.from];
  const seat = ownerOf(v);
  board[mv.from] = EMPTY;
  board[mv.to] = v;
  let captured = EMPTY;
  if (mv.over !== null && mv.over !== undefined) { captured = board[mv.over]; board[mv.over] = EMPTY; }
  const crowned = !isKing(v) && rowOf(mv.to) === kingRow(seat);
  if (crowned) board[mv.to] = KING[seat];
  const more = captured !== EMPTY && !crowned && jumpsFrom(board, mv.to).length > 0;
  return { captured, crowned, more };
}

/** Pieces on the board per seat: [{ men, kings }, { men, kings }]. */
export function tally(board) {
  const out = [{ men: 0, kings: 0 }, { men: 0, kings: 0 }];
  for (let cell = 0; cell < CELLS; cell++) {
    const v = board[cell];
    if (v === EMPTY) continue;
    if (isKing(v)) out[ownerOf(v)].kings += 1; else out[ownerOf(v)].men += 1;
  }
  return out;
}

/** Material lead for seat 0 (a king is worth a man and a half). */
function lead(board) {
  const [a, b] = tally(board);
  return (a.men * 2 + a.kings * 3) - (b.men * 2 + b.kings * 3);
}

const blankStat = () => ({ steps: 0, turns: 0, captures: 0, multi: 0, kings: 0 });
/** Per-seat counters for telemetry. Guarded where written (house rule 3.5). */
function statOf(G, seat) {
  if (!Array.isArray(G.stat) || G.stat.length !== 2) G.stat = [blankStat(), blankStat()];
  return G.stat[seat];
}

const piecesOf = (board) => tally(board).map((t) => t.men + t.kings);

/** The hard cap: whoever has more material wins, level material is a draw. */
function endOnStanding(G) {
  const d = lead(G.board);
  const winner = d > 0 ? 0 : d < 0 ? 1 : null;
  finish(G, twoSeatPlacements(winner), { reason: winner === null ? 'draw' : 'win', scores: piecesOf(G.board) });
}

function startBoard() {
  const board = Array(CELLS).fill(EMPTY);
  for (let cell = 0; cell < CELLS; cell++) {
    if (!isDark(cell)) continue;
    if (rowOf(cell) <= 2) board[cell] = MAN[1];
    else if (rowOf(cell) >= 5) board[cell] = MAN[0];
  }
  return board;
}

export const checkers = defineGame({
  name: 'checkers',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: startBoard(), turnP: '0', mustFrom: null, quiet: 0, chain: 0, stat: [blankStat(), blankStat()], trail: [] }),
  moves: {
    move: ({ G, playerID }, from, to) => {
      if (refuse(G, playerID)) return INVALID_MOVE;
      const seat = Number(playerID);
      if (seat !== 0 && seat !== 1) return INVALID_MOVE;
      if (!Number.isInteger(from) || !Number.isInteger(to)) return INVALID_MOVE;
      const mv = legalMoves(G, seat).find((m) => m.from === from && m.to === to);
      if (!mv) return INVALID_MOVE;

      const wasKing = isKing(G.board[from]);
      const res = applyMove(G.board, mv);
      const moveN = countMove(G);
      const capture = res.captured !== EMPTY;
      pushLog(G, { t: 'move', p: seat, from, to, cap: capture ? mv.over : null, capK: capture && isKing(res.captured), king: res.crowned });

      const st = statOf(G, seat);
      st.steps += 1;
      if (res.crowned) st.kings += 1;
      if (capture) {
        st.captures += 1;
        G.chain = (G.chain || 0) + 1;
        if (G.chain === 2) st.multi += 1;
      }
      // Only a king sliding about leaves the position where it was.
      G.quiet = capture || !wasKing ? 0 : (G.quiet || 0) + 1;
      if (moveN % 4 === 0) {
        if (!Array.isArray(G.trail)) G.trail = [];
        G.trail.push(lead(G.board));
      }

      // Mid multi-jump: the turn stays with the mover and only this piece
      // may move. Nothing else is decided until the jump is finished.
      if (res.more) {
        G.mustFrom = to;
        if (moveN >= MERCY_MOVES) endOnStanding(G);
        return undefined;
      }
      G.mustFrom = null;
      G.chain = 0;
      st.turns += 1;

      // Terminal conditions before the turn is handed over: an opponent with
      // no legal move (no pieces, or every piece blocked) has lost.
      const opp = 1 - seat;
      const replies = movesFor(G.board, opp, null);
      if (replies.length === 0) { finish(G, twoSeatPlacements(seat), { reason: 'win', scores: piecesOf(G.board) }); return undefined; }
      if (G.quiet >= QUIET_PLIES) { finish(G, twoSeatPlacements(null), { reason: 'draw', scores: piecesOf(G.board) }); return undefined; }
      if (moveN >= MERCY_MOVES) { endOnStanding(G); return undefined; }
      G.turnP = String(opp);
      return undefined;
    },
  },
});

/** What the arena learns about how this seat played (see server/arena/play.js). */
export function telemetry(G, seat) {
  const st = Array.isArray(G.stat) && G.stat[seat] ? G.stat[seat] : blankStat();
  const mine = tally(G.board)[seat];
  const out = {
    metrics: {
      moves: st.turns,
      captures: st.captures,
      multiJumps: st.multi,
      kings: st.kings,
      piecesLeft: mine.men + mine.kings,
    },
    skillTags: ['planning ahead', 'trade-offs', 'tempo'],
  };
  // No risk or horizon signal: the rules cannot tell a sound exchange from a
  // piece left hanging without searching, so any number here would be noise.
  // Rank by material at the midpoint; level material shares first place.
  const trail = Array.isArray(G.trail) ? G.trail : [];
  if (trail.length >= 2) {
    const d = trail[Math.floor((trail.length - 1) / 2)] * (seat === 0 ? 1 : -1);
    out.midRank = d >= 0 ? 1 : 2;
  }
  return out;
}
