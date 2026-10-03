// Board registry (browser only). Each entry lazy-loads one game's client
// bundle: its rules (boardgame.io needs the move names) and its React board.
// The server never imports this file; the browser never imports registry.js.
export const BOARDS = {
  ventureflow: () => import('./ventureflow/client.js'),
  ventureboom: () => import('./ventureboom/client.js'),
  fourinarow: () => import('./fourinarow/client.js'),
  chess: () => import('./chess/client.js'),
  checkers: () => import('./checkers/client.js'),
  reversi: () => import('./reversi/client.js'),
  mancala: () => import('./mancala/client.js'),
};

export function loadGameClient(id) {
  const loader = Object.prototype.hasOwnProperty.call(BOARDS, id) ? BOARDS[id] : null;
  if (!loader) return Promise.reject(new Error(`No board registered for "${id}"`));
  return loader();
}
