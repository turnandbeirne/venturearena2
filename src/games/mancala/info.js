// Mancala: what the table's Progress and Key tabs show. Pure; no React.
import { TOTAL, storeOf, sideCount } from './rules.js';

export function progress(G) {
  const pits = Array.isArray(G.pits) ? G.pits : [];
  const store = [pits[storeOf(0)] || 0, pits[storeOf(1)] || 0];
  const side = [sideCount(pits, 0), sideCount(pits, 1)];
  const banked = store[0] + store[1];
  const need = Math.floor(TOTAL / 2) + 1;
  const notes = [`${need} stones in a store is more than half: nobody can catch that.`];
  return {
    stage: { label: `${banked} of ${TOTAL} stones banked`, done: banked, of: TOTAL },
    columns: ['In the store', 'On their side'],
    rows: [[store[0], side[0]], [store[1], side[1]]],
    notes,
  };
}

export const key = {
  intro: 'Forty-eight identical stones. Where a stone sits decides what it is worth.',
  groups: [
    {
      id: 'pieces', name: 'The board',
      items: [
        { id: 'pit', name: 'Pit', icon: '\u{1F573}\u{FE0F}', power: 'Six on your side. Pick one: all its stones are lifted and dropped one at a time into the next pits, counter-clockwise.', trait: 'Working capital', lesson: 'Stones in a pit are still in play. They can earn you a move or be taken from you.' },
        { id: 'store', name: 'Store', icon: '\u{1F3E6}', power: 'The large pit on your right. You drop a stone in as you pass it, and your opponent\'s store is skipped. Stones here are safe and are your score.', trait: 'Banked profit', lesson: 'Only what you have banked counts at the end. Paper value on the board is not the same thing.' },
      ],
    },
    {
      id: 'ideas', name: 'The moves that win games',
      items: [
        { id: 'again', name: 'The extra move', icon: '\u{1F501}', power: 'If your last stone lands in your own store, you move again.', trait: 'Counting first', lesson: 'Count before you lift. The numbers tell you which move pays twice.' },
        { id: 'capture', name: 'The capture', icon: '\u{1F91D}', power: 'If your last stone lands in an empty pit on your side and the pit across from it has stones, both go into your store.', trait: 'Timing', lesson: 'An empty pit looks like nothing. Set up at the right moment, it is the biggest move on the board.' },
        { id: 'end', name: 'The last sweep', icon: '\u{1F3C1}', power: 'When one side has no stones left, the other player keeps what is still on their side.', trait: 'Knowing when it ends', lesson: 'Holding stones back can pay off at the end, and so can ending the game early when you are ahead.' },
      ],
    },
  ],
};

/** One sentence per log entry, for the table's "What happened" list. */
export function describe(e, nm) {
  if (e.t === 'sow') {
    const tail = e.cap ? `, capturing ${e.cap} stone${e.cap === 1 ? '' : 's'}` : e.extra ? ', ended in the store and moves again' : '';
    return `${nm(e.p)} sowed ${e.stones} stone${e.stones === 1 ? '' : 's'} from pit ${e.pit + 1}${tail}`;
  }
  if (e.t === 'sweep') return `${nm(e.p)} kept the ${e.stones} stone${e.stones === 1 ? '' : 's'} left on their side`;
  return null;
}
