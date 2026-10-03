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

/**
 * A game's Key without its board: the standalone Key page (/key/<game>) reads
 * the cards or pieces and nothing else. Resolves to { info, keyArt }.
 */
const INFO = {
  ventureflow: () => import('./ventureflow/info.js').then((info) => ({ info })),
  ventureboom: () => Promise.all([import('./ventureboom/info.js'), import('./ventureboom/art.js')]).then(([info, art]) => ({ info, keyArt: art.artFor })),
  fourinarow: () => import('./fourinarow/info.js').then((info) => ({ info })),
  chess: () => import('./chess/info.js').then((info) => ({ info })),
  checkers: () => import('./checkers/info.js').then((info) => ({ info })),
  reversi: () => import('./reversi/info.js').then((info) => ({ info })),
  mancala: () => import('./mancala/info.js').then((info) => ({ info })),
};

export function loadGameInfo(id) {
  const loader = Object.prototype.hasOwnProperty.call(INFO, id) ? INFO[id] : null;
  if (!loader) return Promise.reject(new Error(`No key for "${id}"`));
  return loader();
}
