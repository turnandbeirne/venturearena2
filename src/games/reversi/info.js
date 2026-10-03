// Reversi: what the table's Progress and Key tabs show. Pure; no React.
import { CELLS, CORNERS, counts, boardMoves } from './rules.js';

export function progress(G) {
  const board = Array.isArray(G.board) ? G.board : [];
  const c = counts(board);
  const discs = [c[0] || 0, c[1] || 0];
  const used = discs[0] + discs[1];
  const corners = [0, 1].map((s) => CORNERS.filter((i) => board[i] === s).length);
  const moves = [0, 1].map((s) => boardMoves(board, s).length);
  return {
    stage: { label: `${used} of ${CELLS} squares filled`, done: used, of: CELLS },
    columns: ['Discs', 'Corners held', 'Moves open now'],
    rows: [[discs[0], corners[0], moves[0]], [discs[1], corners[1], moves[1]]],
    notes: ['The disc count swings all game. Corners and the number of moves you have open say more about who is ahead.'],
  };
}

export const key = {
  intro: 'Every disc is the same. What changes is the square it stands on.',
  groups: [
    {
      id: 'pieces', name: 'The pieces',
      items: [
        { id: 'disc', name: 'Disc', icon: '\u{26AB}', power: 'Placed so that it traps a straight line of the other colour between itself and another disc of yours. Every trapped disc flips to your colour.', trait: 'Leverage', lesson: 'One well-placed move can change the value of everything already on the board. So can one well-placed hire or customer.' },
      ],
    },
    {
      id: 'squares', name: 'The squares',
      items: [
        { id: 'corner', name: 'Corner', icon: '\u{1F4D0}', power: 'A disc in a corner can never be flipped. It also anchors the edges that run from it.', trait: 'Durable advantage', lesson: 'Some positions cannot be taken back once held: a patent, a location, a trusted name. They are worth giving up short-term gains for.' },
        { id: 'xsquare', name: 'Next to an empty corner', icon: '\u{1F6A7}', power: 'The three squares beside an empty corner usually give that corner to your opponent.', trait: 'Patience', lesson: 'The move that looks like progress can be the one that opens the door for a competitor.' },
        { id: 'edge', name: 'Edge', icon: '\u{1F4CF}', power: 'A disc on an edge can only be flipped along that edge, so it is safer than one in the middle.', trait: 'Defensible ground', lesson: 'Fewer directions of attack means less to defend.' },
      ],
    },
    {
      id: 'ideas', name: 'The ideas that win games',
      items: [
        { id: 'mobility', name: 'Moves open', icon: '\u{1F9ED}', power: 'A player with no legal move is skipped. Leaving your opponent few moves, all of them bad, wins more games than having more discs early.', trait: 'Keeping options', lesson: 'Count your options, not your score. A business with choices outlasts one with a bigger number today.' },
      ],
    },
  ],
};

const square = (cell) => `${'abcdefgh'[cell % 8]}${Math.floor(cell / 8) + 1}`;
/** One sentence per log entry, for the table's "What happened" list. */
export function describe(e, nm) {
  if (e.t === 'place') { const n = Array.isArray(e.flips) ? e.flips.length : Number(e.flips) || 0; return `${nm(e.p)} played ${square(e.cell)} and flipped ${n} disc${n === 1 ? '' : 's'}`; }
  if (e.t === 'pass') return `${nm(e.p)} had no move and was skipped`;
  return null;
}
