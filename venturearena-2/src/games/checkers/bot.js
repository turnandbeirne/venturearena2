// Checkers bot. Sees only what a browser in its seat sees and picks from the
// same legalMoves() the validator uses; the search walks positions with the
// rules' own movesFor() and applyMove(), so forced captures, multi-jumps and
// crowning behave in its head exactly as they do on the table.
import { CELLS, EMPTY, ownerOf, isKing, rowOf, colOf, kingRow, legalMoves, movesFor, applyMove } from './rules.js';

const WIN = 100000;
/** Positions the sharp bot may look at per move. Keeps the worst case well
 *  under the 300 ms a table will wait without noticing. */
const NODE_BUDGET = 16000;
/** A second stop for a slow or busy machine: the bot runs on the server's
 *  one thread, so no single answer may hold it for long. */
const TIME_BUDGET_MS = 150;
/** Candidates this close to the best score are treated as equal (a man is 100). */
const MARGIN = 3;

/** Static score from `me`'s side. Material first; then men that are close to
 *  crowning, a guarded back row, and the centre. */
function evaluate(board, me) {
  let mat0 = 0, mat1 = 0, pos0 = 0, pos1 = 0, pieces = 0;
  for (let cell = 0; cell < CELLS; cell++) {
    const v = board[cell];
    if (v === EMPTY) continue;
    pieces++;
    const seat = ownerOf(v);
    const row = rowOf(cell), col = colOf(cell);
    const central = row >= 2 && row <= 5 && col >= 2 && col <= 5;
    let m, p;
    if (isKing(v)) {
      m = 160;
      p = central ? 6 : 0;
    } else {
      m = 100;
      const advanced = seat === 0 ? 7 - row : row; // 0 at home, 6 one step from a king
      p = advanced * 3 + (advanced === 0 ? 9 : 0) + (central ? 4 : 0); // a man at home stops a crowning there
    }
    if (seat === 0) { mat0 += m; pos0 += p; } else { mat1 += m; pos1 += p; }
  }
  const diff = (mat0 - mat1) * (me === 0 ? 1 : -1);
  let score = diff + (pos0 - pos1) * (me === 0 ? 1 : -1);
  // Ahead: trade down, and walk the kings toward what is left so the win
  // gets finished instead of drifting into the 40-move draw.
  if (diff !== 0) {
    score += Math.round((diff * 60) / (mat0 + mat1));
    if (pieces <= 8) score += (diff > 0 ? -1 : 1) * 3 * chase(board, diff > 0 ? me : 1 - me);
  }
  return score;
}

/** Sum over `seat`'s kings of the distance to the nearest enemy piece. */
function chase(board, seat) {
  let far = 0;
  for (let k = 0; k < CELLS; k++) {
    if (!isKing(board[k]) || ownerOf(board[k]) !== seat) continue;
    let near = 8;
    for (let t = 0; t < CELLS; t++) {
      if (board[t] === EMPTY || ownerOf(board[t]) === seat) continue;
      near = Math.min(near, Math.max(Math.abs(rowOf(k) - rowOf(t)), Math.abs(colOf(k) - colOf(t))));
    }
    far += near;
  }
  return far;
}

/** Captures of kings first, then moves that crown: better cut-offs. */
function order(board, moves) {
  if (moves.length < 2) return moves;
  const key = (m) => (m.over !== null && isKing(board[m.over]) ? 4 : 0)
    + (!isKing(board[m.from]) && rowOf(m.to) === kingRow(ownerOf(board[m.from])) ? 2 : 0);
  return moves.map((m) => [m, key(m)]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
}

/**
 * Alpha-beta over single steps. A multi-jump is several steps by the same
 * side and does not use up depth. At depth 0 the search keeps going while a
 * capture is forced, so it never stops in the middle of an exchange.
 * `state.nodes` counts down (and is zeroed when the clock runs out); at zero
 * the search unwinds on static scores and the caller discards that depth.
 */
function search(board, seat, mustFrom, depth, alpha, beta, me, state) {
  state.nodes -= 1;
  if ((state.nodes & 255) === 0 && Date.now() > state.until) state.nodes = 0;
  const moves = movesFor(board, seat, mustFrom);
  if (moves.length === 0) return seat === me ? -WIN - depth : WIN + depth;
  const forced = moves[0].over !== null;
  if (state.nodes <= 0) { state.cut = true; return evaluate(board, me); }
  if (depth <= 0 && !forced) return evaluate(board, me);
  const maxing = seat === me;
  let best = maxing ? -Infinity : Infinity;
  for (const mv of order(board, moves)) {
    const next = board.slice();
    const res = applyMove(next, mv);
    const v = res.more
      ? search(next, seat, mv.to, depth, alpha, beta, me, state)
      : search(next, 1 - seat, null, depth - 1, alpha, beta, me, state);
    if (maxing) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
const args = (mv) => ({ move: 'move', args: [mv.from, mv.to] });

/** level: 1 easy (looks one move ahead, sometimes wanders), 2 normal, 3 sharp. */
export function bot({ G, seat, level = 2 }) {
  const legal = legalMoves(G, seat);
  if (legal.length === 0) return null;
  if (legal.length === 1) return args(legal[0]);
  if (level <= 1 && Math.random() < 0.3) return args(pickRandom(legal));
  const board = G.board;

  // Shuffle, then order: equal candidates vary from game to game.
  const root = order(board, legal.map((m) => [m, Math.random()]).sort((a, b) => a[1] - b[1]).map((x) => x[0]));
  // Every candidate within MARGIN of the best gets an exact score (the window
  // is opened by that much), and one of them is picked at random: the bot
  // does not replay the same game, and it never picks a clearly worse move.
  const searchRoot = (depth, state) => {
    let bestScore = -Infinity;
    const scored = [];
    for (const mv of root) {
      const floor = bestScore - MARGIN;
      const next = board.slice();
      const res = applyMove(next, mv);
      const v = res.more
        ? search(next, seat, mv.to, depth, floor, Infinity, seat, state)
        : search(next, 1 - seat, null, depth - 1, floor, Infinity, seat, state);
      scored.push([mv, v]);
      if (v > bestScore) bestScore = v;
    }
    return pickRandom(scored.filter((x) => x[1] > bestScore - MARGIN))[0];
  };

  if (level <= 1) return args(searchRoot(1, { nodes: 1e9, cut: false, until: Infinity }));
  if (level === 2) return args(searchRoot(4, { nodes: 1e9, cut: false, until: Infinity }));

  // Sharp: deepen one ply at a time inside a fixed budget and keep the last
  // depth that finished.
  const state = { nodes: NODE_BUDGET, cut: false, until: Date.now() + TIME_BUDGET_MS };
  let best = root[0];
  for (let depth = 2; depth <= 12; depth++) {
    const pick = searchRoot(depth, state);
    if (state.cut) break;
    best = pick;
    // Put the current favourite first: the next depth cuts off sooner.
    const at = root.indexOf(pick);
    if (at > 0) root.unshift(root.splice(at, 1)[0]);
  }
  return args(best);
}
