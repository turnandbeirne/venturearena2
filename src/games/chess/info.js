// Chess: what the table's Progress and Key tabs show. Pure; no React.
import { VALUE, material, inCheck } from './rules.js';

const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const START_MATERIAL = 39; // each side: 8 pawns, 2 knights, 2 bishops, 2 rooks, a queen

/** "2 pawns, a knight" from a list of captured piece types. */
function listPieces(types) {
  const n = {};
  for (const t of types || []) n[t] = (n[t] || 0) + 1;
  const out = ['q', 'r', 'b', 'n', 'p'].filter((t) => n[t]).map((t) => (n[t] === 1 ? `a ${NAME[t]}` : `${n[t]} ${NAME[t]}s`));
  return out.length ? out.join(', ') : 'nothing yet';
}

export function progress(G) {
  const fen = String(G.fen || '');
  const move = Number(fen.split(' ')[5]) || 1;
  const m = material(fen);
  const taken = Array.isArray(G.taken) ? G.taken : [[], []];
  const gone = START_MATERIAL * 2 - m[0] - m[1];
  const notes = [];
  if (!G.over && fen && inCheck(G)) notes.push(`${fen.split(' ')[1] === 'w' ? 'White' : 'Black'} is in check.`);
  const lead = m[0] - m[1];
  notes.push(lead === 0 ? 'Material is level.' : `${lead > 0 ? 'White' : 'Black'} is ahead by ${Math.abs(lead)} point${Math.abs(lead) === 1 ? '' : 's'} of material.`);
  return {
    // Chess has no fixed length, so the meter shows how much has been traded off.
    stage: { label: `Move ${move}`, done: gone, of: START_MATERIAL * 2, caption: `${gone} of ${START_MATERIAL * 2} points of material traded off` },
    columns: ['Material', 'Has captured'],
    rows: [[m[0], listPieces(taken[0])], [m[1], listPieces(taken[1])]],
    notes,
  };
}

const piece = (id, name, icon, power, trait, lesson) => ({ id, name, icon, power, trait, lesson, count: id === 'k' ? null : `${VALUE[id]} point${VALUE[id] === 1 ? '' : 's'}` });

export const key = {
  intro: 'Six kinds of piece. The points are the usual guide to what each is worth in a trade; the king has no price because losing it loses the game.',
  groups: [
    {
      id: 'pieces', name: 'The pieces',
      items: [
        piece('k', 'King', '\u{265A}', 'One square in any direction. It may never move onto an attacked square.', 'The thing you must not lose', 'Every business has one: cash, a licence, a key customer. Know which piece is your king.'),
        piece('q', 'Queen', '\u{265B}', 'Any number of squares in a straight line or on a diagonal.', 'Reach', 'Your most capable resource is also the costliest to lose. Do not send it out alone too early.'),
        piece('r', 'Rook', '\u{265C}', 'Any number of squares in a straight line. Strongest on a file with no pawns in the way.', 'Power that needs an open road', 'Some strengths only work once the path is cleared. Clearing it is part of the job.'),
        piece('b', 'Bishop', '\u{265D}', 'Any number of squares on a diagonal. It stays on one colour all game.', 'The specialist', 'Excellent on its own ground and absent from half the board. Pair it with what covers the other half.'),
        piece('n', 'Knight', '\u{265E}', 'An L: two squares one way and one to the side. The only piece that jumps over others.', 'The unexpected route', 'When the direct road is blocked, the indirect one still works.'),
        piece('p', 'Pawn', '\u{265F}', 'One square forward (two on its first move). It captures one square diagonally forward and can never go back.', 'Small, steady, promotable', 'The least valuable piece is the only one that can become a queen. Structure built early is hard to change later.'),
      ],
    },
    {
      id: 'special', name: 'Special moves',
      items: [
        { id: 'castle', name: 'Castling', icon: '\u{1F3F0}', power: 'Once a game the king moves two squares toward a rook and the rook jumps to its other side, if neither has moved and nothing is in the way or under attack.', trait: 'Safety first', lesson: 'Protect what matters before you go on the attack.' },
        { id: 'promote', name: 'Promotion', icon: '\u{2B06}\u{FE0F}', power: 'A pawn that reaches the far side becomes a queen, rook, bishop or knight of your choice.', trait: 'Patience rewarded', lesson: 'A long, unglamorous effort can turn into your strongest asset.' },
        { id: 'enpassant', name: 'En passant', icon: '\u{2194}\u{FE0F}', power: 'Right after an enemy pawn runs two squares past yours, your pawn may capture it as if it had moved one.', trait: 'A short window', lesson: 'Some opportunities are only there for one move.' },
      ],
    },
    {
      id: 'endings', name: 'How it ends',
      items: [
        { id: 'check', name: 'Check and checkmate', icon: '\u{2757}', power: 'Check: the king is attacked and must be made safe on the next move. Checkmate: it cannot be, and the game is over.', trait: 'The one threat you cannot ignore', lesson: 'When the thing you cannot lose is at risk, everything else waits.' },
        { id: 'draw', name: 'Draws', icon: '\u{1F91D}', power: 'Stalemate (no legal move, but not in check), the same position three times, fifty moves each with no capture or pawn move, or too few pieces left to mate.', trait: 'Half a point', lesson: 'From a losing position, a draw is a result worth working for.' },
      ],
    },
  ],
};

/** One sentence per log entry, for the table's "What happened" list. */
export function describe(e, nm) {
  if (e.t !== 'move') return null;
  const n = Math.floor(((e.ply || 1) - 1) / 2) + 1;
  return `${n}. ${nm(e.p)} played ${e.san}${e.cap ? `, taking a ${NAME[e.cap] || 'piece'}` : ''}${e.promo ? `, promoting to a ${NAME[e.promo] || 'piece'}` : ''}`;
}
