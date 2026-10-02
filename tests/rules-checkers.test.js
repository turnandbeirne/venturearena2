// Checkers (English draughts): the rules themselves, then bot against bot.
import { describe, it, expect } from 'vitest';
import {
  checkers, legalMoves, movesFor, jumpsFrom, tally, telemetry, isDark, ownerOf, isKing,
  EMPTY, MAN, KING, CELLS, QUIET_PLIES, MERCY_MOVES,
} from '../src/games/checkers/rules.js';
import { bot } from '../src/games/checkers/bot.js';
import meta from '../src/games/checkers/meta.js';
import { INVALID_MOVE } from '../src/games/kit.js';
import { createMatch, playout } from '../src/games/sim.js';

const at = (row, col) => row * 8 + col;

/**
 * A plain G for positions that are awkward to reach by play: eight strings,
 * top row first. 'x' / 'X' are seat 0's man / king (seat 0 moves UP the
 * diagram), 'o' / 'O' are seat 1's. `stat` and `trail` are left out on
 * purpose, the way a match created before those fields existed would look.
 */
function position(rows, turnP = '0', extra = {}) {
  const map = { '.': EMPTY, x: MAN[0], X: KING[0], o: MAN[1], O: KING[1] };
  const board = rows.join('').split('').map((ch) => map[ch]);
  expect(board).toHaveLength(CELLS);
  board.forEach((v, cell) => { if (v !== EMPTY) expect(isDark(cell), `piece on a light square at ${cell}`).toBe(true); });
  return { board, turnP, mustFrom: null, quiet: 0, n: 2, log: [], logN: 0, moveN: 0, over: null, resolving: false, ...extra };
}
/** Run the real move function on a plain G. */
const step = (G, seat, from, to) => checkers.moves.move.move({ G, playerID: String(seat) }, from, to);

describe('checkers rules', () => {
  it('starts with twelve men a side on the dark squares and seven legal moves', () => {
    const m = createMatch(checkers, 2);
    expect(tally(m.G.board)).toEqual([{ men: 12, kings: 0 }, { men: 12, kings: 0 }]);
    m.G.board.forEach((v, cell) => { if (v !== EMPTY) expect(isDark(cell)).toBe(true); });
    // Seat 0 is at the bottom, with a dark square in its bottom-left corner.
    expect(ownerOf(m.G.board[at(7, 0)])).toBe(0);
    expect(ownerOf(m.G.board[at(0, 7)])).toBe(1);
    expect(m.G.turnP).toBe('0');
    const legal = legalMoves(m.G);
    expect(legal).toHaveLength(7);
    expect(legal.every((mv) => mv.over === null)).toBe(true);
    expect(legalMoves(m.G, 1)).toEqual([]); // not seat 1's turn yet
    expect(movesFor(m.G.board, 1)).toHaveLength(7);
  });

  it('refuses a move out of turn, an illegal move and junk arguments', () => {
    const m = createMatch(checkers, 2);
    const before = JSON.stringify(m.G);
    expect(m.move(1, 'move', at(2, 1), at(3, 0))).toBe(false); // seat 0 moves first
    expect(m.move(0, 'move', at(5, 0), at(4, 0))).toBe(false); // straight ahead, a light square
    expect(m.move(0, 'move', at(5, 2), at(3, 4))).toBe(false); // two squares with nothing to jump
    expect(m.move(0, 'move', at(6, 1), at(5, 2))).toBe(false); // own piece in the way
    expect(m.move(0, 'move', at(2, 1), at(3, 2))).toBe(false); // the opponent's piece
    expect(m.move(0, 'move', at(4, 1), at(3, 2))).toBe(false); // an empty square
    expect(m.move(0, 'move', at(5, 2))).toBe(false);
    expect(m.move(0, 'move', '42', '33')).toBe(false);
    expect(m.move(0, 'move', 42.5, 33)).toBe(false);
    expect(JSON.stringify(m.G)).toBe(before);

    expect(m.move(0, 'move', at(5, 2), at(4, 1))).toBe(true);
    expect(m.G.turnP).toBe('1');
    expect(m.move(0, 'move', at(5, 4), at(4, 3))).toBe(false); // no second move
    // A man never moves backwards.
    expect(m.move(1, 'move', at(2, 3), at(3, 2))).toBe(true);
    expect(legalMoves(m.G).some((mv) => mv.from === at(4, 1) && mv.to === at(5, 2))).toBe(false);
  });

  it('a capture is mandatory: with one on the board, nothing else is legal', () => {
    const m = createMatch(checkers, 2);
    expect(m.move(0, 'move', at(5, 2), at(4, 1))).toBe(true);
    expect(m.move(1, 'move', at(2, 3), at(3, 2))).toBe(true);
    expect(legalMoves(m.G)).toEqual([{ from: at(4, 1), to: at(2, 3), over: at(3, 2) }]);
    expect(m.move(0, 'move', at(5, 4), at(4, 3))).toBe(false); // a quiet move is refused
    expect(m.move(0, 'move', at(5, 6), at(4, 7))).toBe(false);
    expect(m.move(0, 'move', at(4, 1), at(2, 3))).toBe(true);
    expect(m.G.board[at(3, 2)]).toBe(EMPTY);
    expect(m.G.board[at(2, 3)]).toBe(MAN[0]);
    expect(tally(m.G.board)[1].men).toBe(11);
    expect(m.G.log[m.G.log.length - 1]).toMatchObject({ t: 'move', p: 0, from: at(4, 1), to: at(2, 3), cap: at(3, 2), king: false });
    // Seat 1 must take back, and has two ways to do it.
    expect(m.G.turnP).toBe('1');
    const replies = legalMoves(m.G);
    expect(replies).toHaveLength(2);
    expect(replies.every((mv) => mv.over === at(2, 3))).toBe(true);
    expect(m.move(1, 'move', at(2, 5), at(3, 6))).toBe(false);
  });

  it('a multi-jump keeps the turn, and only the jumping piece may move', () => {
    const G = position([
      '.o......',
      '........',
      '........',
      '....o...',
      '........',
      '..o.....',
      '.x......',
      '......x.',
    ]);
    expect(step(G, 0, at(6, 1), at(4, 3))).toBeUndefined();
    expect(G.board[at(5, 2)]).toBe(EMPTY);
    // Still seat 0, and locked to the piece that just jumped.
    expect(G.over).toBeNull();
    expect(G.turnP).toBe('0');
    expect(G.mustFrom).toBe(at(4, 3));
    expect(legalMoves(G)).toEqual([{ from: at(4, 3), to: at(2, 5), over: at(3, 4) }]);
    expect(legalMoves(G, 1)).toEqual([]);
    expect(step(G, 0, at(7, 6), at(6, 5))).toBe(INVALID_MOVE); // another piece
    expect(step(G, 0, at(4, 3), at(3, 2))).toBe(INVALID_MOVE); // the same piece, not capturing
    expect(step(G, 1, at(0, 1), at(1, 0))).toBe(INVALID_MOVE); // the opponent
    expect(step(G, 0, at(4, 3), at(2, 5))).toBeUndefined();
    expect(G.board[at(3, 4)]).toBe(EMPTY);
    expect(G.mustFrom).toBeNull();
    expect(G.turnP).toBe('1');
    expect(tally(G.board)).toEqual([{ men: 2, kings: 0 }, { men: 1, kings: 0 }]);
    expect(telemetry(G, 0).metrics).toMatchObject({ moves: 1, captures: 2, multiJumps: 1 });
  });

  it('a man reaching the far row is crowned and its move ends, even with a capture on', () => {
    const G = position([
      '........',
      '..o.o...',
      '.x......',
      '........',
      '........',
      '........',
      '........',
      '......x.',
    ]);
    expect(step(G, 0, at(2, 1), at(0, 3))).toBeUndefined();
    expect(G.board[at(0, 3)]).toBe(KING[0]);
    expect(G.log[G.log.length - 1]).toMatchObject({ t: 'move', king: true, cap: at(1, 2) });
    // As a king it could jump the man on (1,4); the crowning ended the move.
    expect(jumpsFrom(G.board, at(0, 3))).toEqual([{ from: at(0, 3), to: at(2, 5), over: at(1, 4) }]);
    expect(G.mustFrom).toBeNull();
    expect(G.turnP).toBe('1');
    expect(telemetry(G, 0).metrics.kings).toBe(1);

    // Seat 1 crowns on row 7 with a plain move.
    const H = position(['........', '........', '........', '........', '........', '........', '.o...x..', '........'], '1');
    expect(step(H, 1, at(6, 1), at(7, 0))).toBeUndefined();
    expect(H.board[at(7, 0)]).toBe(KING[1]);
  });

  it('kings move and capture backwards; men do not', () => {
    const rows = (piece) => ['.o......', '........', '........', `..${piece}.....`, '...o....', '........', '........', '........'];
    const man = position(rows('x'));
    expect(legalMoves(man).every((mv) => mv.over === null && mv.to < mv.from)).toBe(true);
    expect(step(man, 0, at(3, 2), at(5, 4))).toBe(INVALID_MOVE);

    const king = position(rows('X'));
    expect(legalMoves(king)).toEqual([{ from: at(3, 2), to: at(5, 4), over: at(4, 3) }]);
    expect(step(king, 0, at(3, 2), at(5, 4))).toBeUndefined();
    expect(isKing(king.board[at(5, 4)])).toBe(true);
    expect(king.board[at(4, 3)]).toBe(EMPTY);
  });

  it('a player with no pieces left loses', () => {
    const G = position(['........', '........', '........', '........', '........', '..o.....', '.x......', '........']);
    expect(step(G, 0, at(6, 1), at(4, 3))).toBeUndefined();
    expect(G.over).toMatchObject({ placements: [1, 2], reason: 'win', scores: [1, 0] });
    expect(step(G, 1, at(0, 1), at(1, 0))).toBe(INVALID_MOVE);
  });

  it('a player whose pieces are all blocked loses', () => {
    const G = position([
      '........',
      '........',
      '........',
      '........',
      '........',
      'o.......',
      '.x......',
      '..x...x.',
    ]);
    expect(movesFor(G.board, 1)).toEqual([]);
    expect(step(G, 0, at(7, 6), at(6, 5))).toBeUndefined();
    expect(G.over).toMatchObject({ placements: [1, 2], reason: 'win', scores: [3, 1] });
    expect(G.turnP).toBe('0'); // the turn is not handed to a finished game
  });

  it(`is a draw after ${QUIET_PLIES} plies with no capture and no man moved`, () => {
    const G = position(['.......O', '........', '........', '........', '........', '........', '........', 'X.......']);
    const spots = [[at(7, 0), at(6, 1)], [at(0, 7), at(1, 6)]];
    for (let ply = 0; ply < QUIET_PLIES; ply++) {
      const seat = ply % 2;
      const [a, b] = spots[seat];
      const from = ownerOf(G.board[a]) === seat ? a : b;
      expect(G.over, `ply ${ply}`).toBeNull();
      expect(step(G, seat, from, from === a ? b : a)).toBeUndefined();
    }
    expect(G.quiet).toBe(QUIET_PLIES);
    expect(G.over).toMatchObject({ placements: [1, 1], reason: 'draw', scores: [1, 1] });
  });

  it('a capture or a man move resets the draw count', () => {
    const G = position(['.......O', '........', '........', '........', '........', '........', '.x......', 'X.......'], '0', { quiet: QUIET_PLIES - 1 });
    expect(step(G, 0, at(6, 1), at(5, 2))).toBeUndefined();
    expect(G.quiet).toBe(0);
    expect(G.over).toBeNull();
    // A king move counts again.
    expect(step(G, 1, at(0, 7), at(1, 6))).toBeUndefined();
    expect(G.quiet).toBe(1);
  });

  it('the hard cap ends the game on material', () => {
    const ahead = position(['.......o', '........', '........', '........', '........', '........', '.x......', 'x.......'], '0', { moveN: MERCY_MOVES - 1 });
    expect(step(ahead, 0, at(6, 1), at(5, 2))).toBeUndefined();
    expect(ahead.over).toMatchObject({ placements: [1, 2], reason: 'win', scores: [2, 1] });

    const level = position(['.......o', '........', '........', '........', '........', '........', '.x......', '........'], '0', { moveN: MERCY_MOVES - 1 });
    expect(step(level, 0, at(6, 1), at(5, 2))).toBeUndefined();
    expect(level.over).toMatchObject({ placements: [1, 1], reason: 'draw' });
  });

  it('either seat can resign at any time', () => {
    const m = createMatch(checkers, 2);
    expect(m.move(1, 'resign')).toBe(true); // out of turn on purpose
    expect(m.G.over).toMatchObject({ placements: [1, 2], reason: 'resign' });
    expect(m.move(0, 'move', at(5, 2), at(4, 1))).toBe(false);
  });
});

describe('checkers bot', () => {
  it('only answers on its own turn, and only with a legal move, at every level', () => {
    let worst = 0;
    for (const level of [1, 2, 3]) {
      const m = createMatch(checkers, 2);
      expect(bot({ G: m.view(1), seat: 1, level })).toBeNull();
      let steps = 0;
      while (!m.G.over) {
        const seat = Number(m.G.turnP);
        const t = performance.now();
        const act = bot({ G: m.view(seat), seat, level });
        worst = Math.max(worst, performance.now() - t);
        expect(act.move).toBe('move');
        expect(legalMoves(m.G, seat).some((mv) => mv.from === act.args[0] && mv.to === act.args[1])).toBe(true);
        expect(m.move(seat, act.move, ...act.args)).toBe(true);
        expect(++steps).toBeLessThanOrEqual(MERCY_MOVES);
      }
    }
    // The sharp bot's budget is in positions, not time; this only catches a
    // blow-up. Measured worst case is far lower (see NODE_BUDGET in bot.js).
    expect(worst).toBeLessThan(1500);
  });

  it('prefers the double jump to a single capture', () => {
    // Seat 0 must capture and has two ways: (6,5) takes one man, (6,1)
    // takes two in the same turn.
    const G = position(['.o......', '........', '........', '....o...', '........', '..o...o.', '.x...x..', '........']);
    expect(legalMoves(G).map((mv) => mv.from).sort((a, b) => a - b)).toEqual([at(6, 1), at(6, 5)]);
    for (const level of [2, 3]) {
      for (let i = 0; i < 5; i++) expect(bot({ G, seat: 0, level })).toEqual({ move: 'move', args: [at(6, 1), at(4, 3)] });
    }
  });
});

describe('checkers playout', () => {
  it('bots reach a result with valid placements, every time', () => {
    for (let round = 0; round < 6; round++) {
      const m = playout({ game: checkers, bot, numSeats: 2 });
      const over = m.G.over;
      expect(over, 'game ended').toBeTruthy();
      expect(over.placements).toHaveLength(2);
      expect(Math.min(...over.placements)).toBe(1);
      expect([[1, 2], [2, 1], [1, 1]]).toContainEqual(over.placements);
      expect(['win', 'draw']).toContain(over.reason);
      const t = tally(m.G.board);
      expect(over.scores).toEqual(t.map((x) => x.men + x.kings));
      expect(m.G.moveN).toBeLessThanOrEqual(MERCY_MOVES);
      expect(m.G.mustFrom).toBeNull();
      expect(m.G.log.length).toBeLessThanOrEqual(80);
      const ns = m.G.log.map((e) => e.n);
      expect([...ns].sort((x, y) => x - y)).toEqual(ns);
      for (const seat of [0, 1]) {
        const tele = telemetry(m.G, seat);
        expect(tele.skillTags.length).toBeGreaterThanOrEqual(2);
        for (const v of Object.values(tele.metrics)) expect(Number.isInteger(v)).toBe(true);
        expect([1, 2]).toContain(tele.midRank);
      }
    }
  });
});

describe('checkers meta', () => {
  it('has what the lobby, the how-to panel and the SEO page read', () => {
    expect(meta).toMatchObject({ id: 'checkers', name: 'Checkers', family: 'classic', seats: { min: 2, max: 2 } });
    expect(meta.skills).toHaveLength(3);
    expect(meta.howTo.length).toBeGreaterThanOrEqual(3);
    expect(meta.howTo.length).toBeLessThanOrEqual(5);
    expect(meta.reflection).toHaveLength(3);
    expect(typeof meta.paceSec).toBe('number');
    expect([...meta.icon]).toHaveLength(1);
    expect(meta.seo.strategy.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(meta)).not.toContain('\u2014'); // house style: no em dashes
  });
});
