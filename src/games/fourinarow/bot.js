// Four in a Row bot. Sees only what a browser in its seat sees (the stripped
// view) and picks from the same legalMoves() the validator uses.
import { COLS, ROWS, idx, landingRow, legalMoves, findWin } from './rules.js';

const ORDER = [3, 2, 4, 1, 5, 0, 6]; // centre first: more lines pass through it

function play(board, col, seat) {
  const row = landingRow(board, col);
  const next = board.slice();
  next[idx(row, col)] = seat;
  return next;
}

function score(board, seat) {
  // Count open twos and threes for each side; cheap and good enough.
  let total = 0;
  const lines = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) for (const [dr, dc] of lines) {
    const er = row + dr * 3, ec = col + dc * 3;
    if (er < 0 || er >= ROWS || ec < 0 || ec >= COLS) continue;
    let mine = 0, theirs = 0;
    for (let k = 0; k < 4; k++) {
      const v = board[idx(row + dr * k, col + dc * k)];
      if (v === seat) mine++; else if (v !== null) theirs++;
    }
    if (mine && theirs) continue;
    if (mine === 3) total += 30; else if (mine === 2) total += 6;
    if (theirs === 3) total -= 40; else if (theirs === 2) total -= 6;
  }
  for (let row = 0; row < ROWS; row++) if (board[idx(row, 3)] === seat) total += 3;
  return total;
}

function search(board, seat, me, depth, alpha, beta) {
  const win = findWin(board);
  if (win) return win.seat === me ? 10000 + depth : -10000 - depth;
  const cols = ORDER.filter((c) => board[idx(0, c)] === null);
  if (cols.length === 0) return 0;
  if (depth === 0) return score(board, me);
  if (seat === me) {
    let best = -Infinity;
    for (const c of cols) {
      best = Math.max(best, search(play(board, c, seat), 1 - seat, me, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  let best = Infinity;
  for (const c of cols) {
    best = Math.min(best, search(play(board, c, seat), 1 - seat, me, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/** level: 1 easy (looks 2 ahead, sometimes wanders), 2 normal, 3 sharp. */
export function bot({ G, seat, level = 2 }) {
  const legal = legalMoves(G);
  if (legal.length === 0) return null;
  const depth = level >= 3 ? 6 : level === 2 ? 4 : 2;
  if (level <= 1 && Math.random() < 0.25) return { move: 'drop', args: [legal[Math.floor(Math.random() * legal.length)]] };
  let best = null, bestScore = -Infinity;
  for (const c of ORDER.filter((x) => legal.includes(x))) {
    const s = search(play(G.board, c, seat), 1 - seat, seat, depth - 1, -Infinity, Infinity) + Math.random() * 0.5;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return { move: 'drop', args: [best] };
}
