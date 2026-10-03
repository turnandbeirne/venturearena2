// Checkers: what the table's Progress and Key tabs show. Pure; no React.
import { tally, QUIET_PLIES } from './rules.js';

const START = 12;

export function progress(G) {
  const t = tally(Array.isArray(G.board) ? G.board : []);
  const left = t.map((x) => x.men + x.kings);
  const taken = [START - left[1], START - left[0]]; // what each seat has captured
  const gone = taken[0] + taken[1];
  const quiet = Number.isFinite(G.quiet) ? G.quiet : 0;
  const notes = [];
  if (quiet >= QUIET_PLIES / 2) notes.push(`${Math.floor(quiet / 2)} moves each with no capture and only kings moving. At ${QUIET_PLIES / 2} the game is a draw.`);
  return {
    stage: { label: `${gone} of ${START * 2} pieces captured`, done: gone, of: START * 2 },
    columns: ['Pieces left', 'Kings', 'Captured'],
    rows: [[left[0], t[0].kings, taken[0]], [left[1], t[1].kings, taken[1]]],
    notes,
  };
}

export const key = {
  intro: 'Two kinds of piece, and one rule that drives the whole game: if you can capture, you must.',
  groups: [
    {
      id: 'pieces', name: 'The pieces',
      items: [
        { id: 'man', name: 'Man', icon: '\u{26AA}', power: 'Moves one square diagonally forward on the dark squares. Captures by jumping a piece next to it into the empty square behind.', trait: 'Steady progress', lesson: 'Most of a business is ordinary work moving one square at a time. It is also what gets promoted.' },
        { id: 'king', name: 'King', icon: '\u{1F451}', power: 'A man that reaches the far row is crowned and its move ends. A king moves and captures backwards as well as forwards.', trait: 'Earned reach', lesson: 'Experience buys freedom of movement. A piece that has crossed the whole board can go where the others cannot.' },
      ],
    },
    {
      id: 'ideas', name: 'The ideas that win games',
      items: [
        { id: 'forced', name: 'The forced capture', icon: '\u{27A1}\u{FE0F}', power: 'If any of your pieces can capture, you have to. If the same piece can jump again, it keeps jumping in the same turn.', trait: 'Trade-offs', lesson: 'You can offer one piece to pull an opponent out of position and take two back. Giving something up on purpose is a strategy.' },
        { id: 'backrow', name: 'The back row', icon: '\u{1F6E1}\u{FE0F}', power: 'While your back row is occupied, the other player cannot crown a king there.', trait: 'Defence', lesson: 'Keep the basics covered at home while you expand.' },
      ],
    },
  ],
};

const square = (cell) => `${'abcdefgh'[cell % 8]}${8 - Math.floor(cell / 8)}`;
/** One sentence per log entry, for the table's "What happened" list. */
export function describe(e, nm) {
  if (e.t !== 'move') return null;
  const took = e.cap !== null && e.cap !== undefined ? `, capturing a ${e.capK ? 'king' : 'piece'}` : '';
  return `${nm(e.p)} moved ${square(e.from)} to ${square(e.to)}${took}${e.king ? ' and was crowned' : ''}`;
}
