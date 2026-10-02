// Reversi: the rules themselves, then bot against bot to a real result.
import { describe, it, expect } from 'vitest';
import { reversi, legalMoves, flipsFor, boardMoves, counts, telemetry, idx, CELLS } from '../src/games/reversi/rules.js';
import { bot } from '../src/games/reversi/bot.js';
import meta from '../src/games/reversi/meta.js';
import { INVALID_MOVE } from '../src/games/kit.js';
import { createMatch, playout } from '../src/games/sim.js';

/** 'd3' -> cell index. Columns a-h left to right, rows 1-8 top to bottom. */
const sq = (name) => (Number(name[1]) - 1) * 8 + (name.charCodeAt(0) - 97);

/**
 * A plain G for positions that are awkward to reach by play: eight strings of
 * '.', 'x' (seat 0) and 'o' (seat 1). `stat` and `trail` are left out on
 * purpose, the way a match created before those fields existed would look.
 */
function position(rows, turnP = '0') {
  const board = rows.join('').split('').map((ch) => (ch === 'x' ? 0 : ch === 'o' ? 1 : null));
  expect(board).toHaveLength(CELLS);
  return { board, turnP, n: 2, log: [], logN: 0, moveN: 0, over: null, resolving: false };
}
/** Run the real move function on a plain G. */
const place = (G, seat, cell) => reversi.moves.place.move({ G, playerID: String(seat) }, cell);

describe('reversi rules', () => {
  it('starts with the four centre discs and four legal moves for seat 0', () => {
    const m = createMatch(reversi, 2);
    expect(counts(m.G.board)).toEqual([2, 2]);
    expect(m.G.board[idx(3, 3)]).toBe(1);
    expect(m.G.board[idx(4, 4)]).toBe(1);
    expect(m.G.board[idx(3, 4)]).toBe(0);
    expect(m.G.board[idx(4, 3)]).toBe(0);
    expect(m.G.turnP).toBe('0');
    expect(legalMoves(m.G).sort((a, b) => a - b)).toEqual([19, 26, 37, 44]);
    // Not seat 1's turn: nothing is legal for it yet.
    expect(legalMoves(m.G, 1)).toEqual([]);
    expect(boardMoves(m.G.board, 1)).toHaveLength(4);
  });

  it('a placement flips the trapped disc and hands the turn over', () => {
    const m = createMatch(reversi, 2);
    expect(m.move(0, 'place', 19)).toBe(true);
    expect(m.G.board[19]).toBe(0);
    expect(m.G.board[27]).toBe(0);
    expect(counts(m.G.board)).toEqual([4, 1]);
    expect(m.G.turnP).toBe('1');
    const last = m.G.log[m.G.log.length - 1];
    expect(last).toMatchObject({ t: 'place', p: 0, cell: 19, flips: [27] });
    expect(legalMoves(m.G, 1).sort((a, b) => a - b)).toEqual([18, 20, 34]);
  });

  it('flips every capped run in every direction, and nothing else', () => {
    const G = position([
      '...x....',
      '...o....',
      '...o....',
      'xoo.oo..', // the pair on the right is not capped: it stays
      '...oo...',
      '...o.x..',
      '...o....',
      '...o....', // a run to the edge is not capped: it stays
    ]);
    const target = idx(3, 3);
    expect(flipsFor(G.board, 0, target).sort((a, b) => a - b)).toEqual([11, 19, 25, 26, 36]);
    expect(place(G, 0, target)).toBeUndefined();
    for (const c of [11, 19, 25, 26, 36, target]) expect(G.board[c]).toBe(0);
    for (const c of [28, 29, 35, 43, 51, 59]) expect(G.board[c]).toBe(1);
    // A match from before the telemetry fields existed still works.
    expect(() => telemetry(G, 0)).not.toThrow();
    expect(telemetry(G, 0).metrics).toMatchObject({ moves: 1, flips: 5 });
  });

  it('refuses a move out of turn, an illegal square and junk arguments', () => {
    const m = createMatch(reversi, 2);
    const before = JSON.stringify(m.G);
    expect(m.move(1, 'place', 18)).toBe(false); // seat 0 moves first
    expect(m.move(0, 'place', 27)).toBe(false); // occupied
    expect(m.move(0, 'place', 0)).toBe(false); // flips nothing
    expect(m.move(0, 'place', 20)).toBe(false); // next to a disc, flips nothing
    expect(m.move(0, 'place', -1)).toBe(false);
    expect(m.move(0, 'place', 64)).toBe(false);
    expect(m.move(0, 'place', 19.5)).toBe(false);
    expect(m.move(0, 'place', '19')).toBe(false);
    expect(m.move(0, 'place')).toBe(false);
    expect(JSON.stringify(m.G)).toBe(before);
    expect(place(position(['........', '........', '........', '...ox...', '...xo...', '........', '........', '........']), 1, 19)).toBe(INVALID_MOVE);
  });

  it('passes automatically when a player has no legal move', () => {
    const m = createMatch(reversi, 2);
    // Eight ordinary moves after which seat 0 has nowhere to place.
    const line = [[0, 37], [1, 45], [0, 19], [1, 38], [0, 39], [1, 31], [0, 54], [1, 47]];
    for (const [seat, cell] of line) expect(m.move(seat, 'place', cell), `seat ${seat} at ${cell}`).toBe(true);
    expect(m.G.over).toBeNull();
    expect(boardMoves(m.G.board, 0)).toEqual([]);
    // The pass happened inside the rules: it is in the log and the turn
    // never left seat 1.
    expect(m.G.turnP).toBe('1');
    expect(m.G.log[m.G.log.length - 1]).toMatchObject({ t: 'pass', p: 0 });
    expect(legalMoves(m.G, 0)).toEqual([]);
    for (const cell of [0, 23, 46, 63]) expect(m.move(0, 'place', cell)).toBe(false);
    const next = legalMoves(m.G, 1);
    expect(next.length).toBeGreaterThan(0);
    expect(m.move(1, 'place', next[0])).toBe(true);
    expect(telemetry(m.G, 1).metrics.passesForced).toBe(1);
  });

  it('ends when neither side can move, before the board is full (the nine-move wipe-out)', () => {
    const m = createMatch(reversi, 2);
    ['e6', 'f4', 'e3', 'f6', 'g5', 'd6', 'e7', 'f5', 'c5'].forEach((name, i) => {
      expect(m.move(i % 2, 'place', sq(name)), name).toBe(true);
    });
    expect(m.G.over).toMatchObject({ placements: [1, 2], reason: 'win', scores: [13, 0] });
    expect(m.G.log[m.G.log.length - 1]).toMatchObject({ t: 'over' });
    // No pass is logged for a game that is simply over.
    expect(m.G.log.some((e) => e.t === 'pass')).toBe(false);
    expect(legalMoves(m.G)).toEqual([]);
    expect(m.move(1, 'place', 0)).toBe(false);
    expect(m.move(1, 'resign')).toBe(false);
  });

  it('most discs wins on a full board; an equal count is a draw', () => {
    const rows = ['.oxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo'];
    const draw = position(rows);
    expect(place(draw, 0, 0)).toBeUndefined();
    expect(draw.over).toMatchObject({ placements: [1, 1], reason: 'draw', scores: [32, 32] });

    // Same last move with one more disc already on seat 1's side: 31 to 33.
    const lost = position(['.oxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxo', 'oooooooo', 'oooooooo', 'oooooooo', 'oooooooo']);
    expect(place(lost, 0, 0)).toBeUndefined();
    expect(lost.over).toMatchObject({ placements: [2, 1], reason: 'win', scores: [31, 33] });
  });

  it('either seat can resign at any time', () => {
    const m = createMatch(reversi, 2);
    expect(m.move(1, 'resign')).toBe(true); // out of turn on purpose
    expect(m.G.over).toMatchObject({ placements: [1, 2], reason: 'resign' });
    expect(m.move(0, 'place', 19)).toBe(false);
  });
});

describe('reversi bot', () => {
  it('only answers on its own turn, and only with a legal square, at every level', () => {
    let worst = 0;
    for (const level of [1, 2, 3]) {
      const m = createMatch(reversi, 2);
      expect(bot({ G: m.view(1), seat: 1, level })).toBeNull();
      let steps = 0;
      while (!m.G.over) {
        const seat = Number(m.G.turnP);
        const t = performance.now();
        const act = bot({ G: m.view(seat), seat, level });
        worst = Math.max(worst, performance.now() - t);
        expect(act.move).toBe('place');
        expect(legalMoves(m.G, seat)).toContain(act.args[0]);
        expect(m.move(seat, act.move, ...act.args)).toBe(true);
        expect(++steps).toBeLessThanOrEqual(60);
      }
    }
    // The sharp bot's budget is in positions, not time; this only catches a
    // blow-up. Measured worst case is far lower (see NODE_BUDGET in bot.js).
    expect(worst).toBeLessThan(1500);
  });
});

describe('reversi playout', () => {
  it('bots reach a result with valid placements, every time', () => {
    for (let round = 0; round < 6; round++) {
      const m = playout({ game: reversi, bot, numSeats: 2 });
      const over = m.G.over;
      expect(over, 'game ended').toBeTruthy();
      expect(over.placements).toHaveLength(2);
      expect(Math.min(...over.placements)).toBe(1);
      expect([[1, 2], [2, 1], [1, 1]]).toContainEqual(over.placements);
      const [a, b] = counts(m.G.board);
      expect(over.scores).toEqual([a, b]);
      expect(a + b).toBeLessThanOrEqual(CELLS);
      expect(over.placements).toEqual(a > b ? [1, 2] : b > a ? [2, 1] : [1, 1]);
      // Neither side had a move left.
      expect(boardMoves(m.G.board, 0)).toEqual([]);
      expect(boardMoves(m.G.board, 1)).toEqual([]);
      expect(m.G.moveN).toBeLessThanOrEqual(60);
      expect(m.G.log.length).toBeLessThanOrEqual(80);
      const ns = m.G.log.map((e) => e.n);
      expect([...ns].sort((x, y) => x - y)).toEqual(ns);
      for (const seat of [0, 1]) {
        const tele = telemetry(m.G, seat);
        expect(tele.skillTags.length).toBeGreaterThanOrEqual(2);
        for (const v of Object.values(tele.metrics)) expect(Number.isInteger(v)).toBe(true);
        for (const v of Object.values(tele.signals || {})) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
        expect([1, 2]).toContain(tele.midRank);
      }
    }
  });
});

describe('reversi meta', () => {
  it('has what the lobby, the how-to panel and the SEO page read', () => {
    expect(meta).toMatchObject({ id: 'reversi', name: 'Reversi', family: 'classic', seats: { min: 2, max: 2 } });
    expect(meta.skills).toHaveLength(3);
    expect(meta.howTo.length).toBeGreaterThanOrEqual(3);
    expect(meta.howTo.length).toBeLessThanOrEqual(5);
    expect(meta.reflection).toHaveLength(3);
    expect(typeof meta.paceSec).toBe('number');
    expect([...meta.icon]).toHaveLength(1);
    expect(meta.seo.strategy.length).toBeGreaterThanOrEqual(3);
    const text = JSON.stringify(meta);
    expect(text).not.toMatch(/othello/i); // a trademark; the generic name only
    expect(text).not.toContain('\u2014'); // house style: no em dashes
  });
});
