// Four in a Row: pure rules. No React, no DOM, no clock, no Math.random.
// The board, the bot and the move validator all import legalMoves() from
// here, so they share ONE definition of what is legal and cannot drift.
import { defineGame, refuse, pushLog, countMove, finish, twoSeatPlacements, INVALID_MOVE } from '../kit.js';

export const COLS = 7;
export const ROWS = 6;
/** A full board is 42 moves; the limit only exists so the rule is uniform. */
export const MERCY_MOVES = COLS * ROWS;

export const idx = (row, col) => row * COLS + col;

/** Row a disc dropped in `col` would land on, or -1 if the column is full. */
export function landingRow(board, col) {
  for (let row = ROWS - 1; row >= 0; row--) if (board[idx(row, col)] === null) return row;
  return -1;
}

/** Columns that can take a disc. The single source of legality. */
export function legalMoves(G) {
  if (G.over) return [];
  const out = [];
  for (let col = 0; col < COLS; col++) if (G.board[idx(0, col)] === null) out.push(col);
  return out;
}

const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** The winning four as { seat, cells: [index x4] }, or null. */
export function findWin(board) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const seat = board[idx(row, col)];
      if (seat === null) continue;
      for (const [dr, dc] of DIRS) {
        const cells = [idx(row, col)];
        for (let k = 1; k < 4; k++) {
          const r = row + dr * k, c = col + dc * k;
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[idx(r, c)] !== seat) break;
          cells.push(idx(r, c));
        }
        if (cells.length === 4) return { seat, cells };
      }
    }
  }
  return null;
}

export const fourInARow = defineGame({
  name: 'fourinarow',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => ({ board: Array(COLS * ROWS).fill(null), turnP: '0', line: null }),
  moves: {
    drop: ({ G, playerID }, col) => {
      if (refuse(G, playerID)) return INVALID_MOVE;
      if (!Number.isInteger(col) || !legalMoves(G).includes(col)) return INVALID_MOVE;
      const seat = Number(playerID);
      const row = landingRow(G.board, col);
      G.board[idx(row, col)] = seat;
      const moveN = countMove(G);
      pushLog(G, { t: 'drop', p: seat, col, row });
      // Terminal conditions before anything else: a winning drop must never
      // also hand the turn over.
      const win = findWin(G.board);
      if (win) { G.line = win.cells; finish(G, twoSeatPlacements(win.seat), { reason: 'win' }); return undefined; }
      if (legalMoves(G).length === 0 || moveN >= MERCY_MOVES) { finish(G, twoSeatPlacements(null), { reason: 'draw' }); return undefined; }
      G.turnP = String(1 - seat);
      return undefined;
    },
  },
});

/** What the arena learns about how this seat played (see server/arena/play.js). */
export function telemetry(G, seat) {
  const mine = (G.log || []).filter((e) => e.t === 'drop' && e.p === seat);
  const center = mine.filter((e) => e.col >= 2 && e.col <= 4).length;
  return {
    metrics: { moves: mine.length, centerShare: mine.length ? Math.round((center / mine.length) * 100) : 0 },
    skillTags: ['pattern recognition', 'positioning'],
  };
}
