// Four in a Row: what the table's Progress and Key tabs show. Pure data and
// pure functions of the state every browser already has; no React.
import { COLS, ROWS } from './rules.js';

const CELLS = COLS * ROWS;

/** How far along the game is, and what each seat has on the board. */
export function progress(G) {
  const board = Array.isArray(G.board) ? G.board : [];
  const discs = [0, 1].map((s) => board.filter((v) => v === s).length);
  const used = discs[0] + discs[1];
  const centre = [0, 1].map((s) => { let n = 0; for (let r = 0; r < ROWS; r++) if (board[r * COLS + 3] === s) n += 1; return n; });
  const full = Array.from({ length: COLS }, (_, c) => board[c] !== null && board[c] !== undefined).filter(Boolean).length;
  return {
    stage: { label: `${used} of ${CELLS} spaces filled`, done: used, of: CELLS },
    columns: ['Discs placed', 'In the centre column'],
    rows: [[discs[0], centre[0]], [discs[1], centre[1]]],
    notes: [full ? `${full} of ${COLS} columns are full.` : 'Every column still has room.'],
  };
}

export const key = {
  intro: 'One kind of piece and one rule, which is why the positions matter more than the pieces.',
  groups: [
    {
      id: 'pieces', name: 'The pieces',
      items: [
        { id: 'disc', name: 'Disc', icon: '\u{1F534}', power: 'Drops into a column and falls to the lowest empty space. It never moves again.', trait: 'Commitment', lesson: 'A decision you cannot take back deserves one more look before you make it. Most spending in a young business is like this.' },
      ],
    },
    {
      id: 'ideas', name: 'The ideas that win games',
      items: [
        { id: 'centre', name: 'The centre column', icon: '\u{1F3AF}', power: 'A disc in the middle column can be part of more lines of four than a disc anywhere else.', trait: 'Positioning', lesson: 'The best position in a market is the one the most customer journeys pass through.' },
        { id: 'double', name: 'The double threat', icon: '\u{2694}\u{FE0F}', power: 'Two different ways to make four on your next move. Your opponent can only block one.', trait: 'Optionality', lesson: 'Make choices that leave you two good next steps, and leave a competitor with one.' },
        { id: 'trap', name: 'The space underneath', icon: '\u{26A0}\u{FE0F}', power: 'A winning space cannot be used until the space under it is filled. Whoever fills it hands the other player the space above.', trait: 'Second-order thinking', lesson: 'Ask what your move makes possible for the other side, not only what it does for you.' },
      ],
    },
  ],
};

/** One sentence per log entry, for the table's "What happened" list. */
export function describe(e, nm) {
  return e.t === 'drop' ? `${nm(e.p)} dropped a disc in column ${e.col + 1}` : null;
}
