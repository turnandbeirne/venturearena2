// Reversi bot. Sees only what a browser in its seat sees and picks from the
// same legalMoves() the validator uses; the search walks positions with the
// rules' own flipsFor(), so it cannot imagine a move the rules would refuse.
import { CELLS, CORNERS, CORNER_NEIGHBOURS, flipsFor, canPlace, legalMoves, counts } from './rules.js';

// Corners can never be flipped back; the squares next to an empty corner
// hand it to the opponent; edges are hard to attack.
const WEIGHT = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 0, 0, 1, -2, 10,
  5, -2, 0, 0, 0, 0, -2, 5,
  5, -2, 0, 0, 0, 0, -2, 5,
  10, -2, 1, 0, 0, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];
/** Squares in the order worth trying: best cut-offs come from corners first. */
const ORDER = Array.from({ length: CELLS }, (_, i) => i).sort((a, b) => WEIGHT[b] - WEIGHT[a]);
const WIN = 100000;
/** Candidates this close to the best score are treated as equal (a mobility
 *  point is worth 9, so this is less than half of one). */
const MARGIN = 4;
/** Positions the sharp bot may look at per move. Keeps the worst case well
 *  under the 300 ms a table will wait without noticing. */
const NODE_BUDGET = 6000;
/** A second stop for a slow or busy machine: the bot runs on the server's
 *  one thread, so no single answer may hold it for long. */
const TIME_BUDGET_MS = 150;
/** CORNER_NEIGHBOURS as a flat list (-1: not beside a corner) for the inner loop. */
const CORNER_OF = Array.from({ length: CELLS }, (_, i) => (CORNER_NEIGHBOURS[i] === undefined ? -1 : CORNER_NEIGHBOURS[i]));

/** Moves for `seat` as [cell, flips], corners first. */
function movesOf(board, seat) {
  const out = [];
  for (const cell of ORDER) {
    // canPlace first: it allocates nothing, and most empty squares are illegal.
    if (canPlace(board, seat, cell)) out.push([cell, flipsFor(board, seat, cell)]);
  }
  return out;
}

function play(board, seat, cell, flips) {
  const next = board.slice();
  next[cell] = seat;
  for (const f of flips) next[f] = seat;
  return next;
}

/** Static score from the side of `me`, the seat about to move. */
function evaluate(board, me) {
  let pos = 0, discs = 0, empty = 0, myMoves = 0, oppMoves = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    const v = board[cell];
    if (v === null) {
      empty++;
      if (canPlace(board, me, cell)) myMoves++;
      if (canPlace(board, 1 - me, cell)) oppMoves++;
      continue;
    }
    let w = WEIGHT[cell];
    // A square beside a corner is only dangerous while the corner is open.
    const corner = CORNER_OF[cell];
    if (corner >= 0 && board[corner] !== null) w = board[corner] === v ? 8 : 0;
    if (v === me) { pos += w; discs++; } else { pos -= w; discs--; }
  }
  // Neither side can place: the game is over and only the count matters.
  if (myMoves === 0 && oppMoves === 0) return finalScore(board, me);
  // Mobility matters most while the board is open; disc count only at the end.
  const late = empty <= 12;
  return pos + (myMoves - oppMoves) * (late ? 4 : 9) + discs * (late ? 6 : -1);
}

function finalScore(board, me) {
  const [a, b] = counts(board);
  const diff = me === 0 ? a - b : b - a;
  return diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0;
}

/** Negamax with alpha-beta. `state.nodes` counts down (and is zeroed when the
 *  clock runs out); at zero the search unwinds on static scores and the
 *  caller discards that depth. */
function search(board, seat, depth, alpha, beta, passed, state) {
  state.nodes -= 1;
  if ((state.nodes & 255) === 0 && Date.now() > state.until) state.nodes = 0;
  if (depth <= 0 || state.nodes <= 0) {
    if (state.nodes <= 0) state.cut = true;
    return evaluate(board, seat);
  }
  const moves = movesOf(board, seat);
  if (moves.length === 0) {
    if (passed) return finalScore(board, seat);
    return -search(board, 1 - seat, depth, -beta, -alpha, true, state);
  }
  let best = -Infinity;
  for (const [cell, flips] of moves) {
    const v = -search(play(board, seat, cell, flips), 1 - seat, depth - 1, -beta, -alpha, false, state);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

/** level: 1 easy (grabs discs, sometimes wanders), 2 normal, 3 sharp. */
export function bot({ G, seat, level = 2 }) {
  const legal = legalMoves(G, seat);
  if (legal.length === 0) return null;
  if (legal.length === 1) return { move: 'place', args: [legal[0]] };
  const board = G.board;

  if (level <= 1) {
    if (Math.random() < 0.3) return { move: 'place', args: [pickRandom(legal)] };
    // The beginner's plan: take a corner if it is there, else the most discs.
    let best = legal[0], bestScore = -Infinity;
    for (const cell of legal) {
      const s = flipsFor(board, seat, cell).length + (CORNERS.includes(cell) ? 20 : 0) + Math.random();
      if (s > bestScore) { bestScore = s; best = cell; }
    }
    return { move: 'place', args: [best] };
  }

  // Shuffle, then order by square value: equal candidates vary game to game.
  const root = legal.map((cell) => [cell, flipsFor(board, seat, cell), Math.random()])
    .sort((a, b) => (WEIGHT[b[0]] - WEIGHT[a[0]]) || (a[2] - b[2]));
  let empty = 0;
  for (let cell = 0; cell < CELLS; cell++) if (board[cell] === null) empty++;

  // Every candidate within MARGIN of the best gets an exact score (the window
  // is opened by that much), and one of them is picked at random: the bot
  // does not replay the same game, and it never picks a clearly worse move.
  const searchRoot = (depth, state) => {
    let bestScore = -Infinity;
    const scored = [];
    for (const [cell, flips] of root) {
      const floor = bestScore - MARGIN;
      const v = -search(play(board, seat, cell, flips), 1 - seat, depth - 1, -Infinity, -floor, false, state);
      scored.push([cell, v]);
      if (v > bestScore) bestScore = v;
    }
    return pickRandom(scored.filter((x) => x[1] > bestScore - MARGIN))[0];
  };

  if (level === 2) return { move: 'place', args: [searchRoot(3, { nodes: 1e9, cut: false, until: Infinity })] };

  // Sharp: deepen one ply at a time inside a fixed budget and keep the last
  // depth that finished. With few squares left, that reaches the end of the
  // game and the choice is exact.
  const state = { nodes: NODE_BUDGET, cut: false, until: Date.now() + TIME_BUDGET_MS };
  const maxDepth = empty <= 11 ? empty : 7;
  let best = root[0][0];
  for (let depth = 2; depth <= maxDepth; depth++) {
    const pick = searchRoot(depth, state);
    if (state.cut) break;
    best = pick;
    // Put the current favourite first: the next depth cuts off sooner.
    const at = root.findIndex((r) => r[0] === pick);
    if (at > 0) root.unshift(root.splice(at, 1)[0]);
  }
  return { move: 'place', args: [best] };
}
