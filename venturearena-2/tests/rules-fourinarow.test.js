// Four in a Row: the rules themselves, played through the same reducer the
// server uses, then the bot against them.
import { describe, it, expect } from 'vitest';
import { fourInARow, legalMoves, landingRow, findWin, telemetry, idx, COLS, ROWS, MERCY_MOVES } from '../src/games/fourinarow/rules.js';
import { bot } from '../src/games/fourinarow/bot.js';
import meta from '../src/games/fourinarow/meta.js';
import { createMatch, playout, actingSeats } from '../src/games/sim.js';

/** Play columns in order, seats alternating from seat 0. Every move must be accepted. */
function play(m, cols) {
  cols.forEach((col, i) => { expect(m.move(i % 2, 'drop', col), `move ${i} (seat ${i % 2}, column ${col})`).toBe(true); });
  return m;
}
/** 42 moves that fill the board with no four in a row (found by search; checked below). */
const DRAW = [0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 3, 4, 5, 3, 4, 5, 5, 0, 1, 2, 3, 4, 1, 6, 0, 1, 2, 6, 0, 2, 6];

describe('four in a row: setup and opening moves', () => {
  it('starts empty, seat 0 to move, every column legal', () => {
    const m = createMatch(fourInARow, 2);
    expect(COLS).toBe(7); expect(ROWS).toBe(6);
    expect(m.G.board).toHaveLength(42);
    expect(m.G.board.every((c) => c === null)).toBe(true);
    expect(m.G.turnP).toBe('0');
    expect(m.G.over).toBe(null);
    expect(m.G.n).toBe(2);
    expect(legalMoves(m.G)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(actingSeats(m.G)).toEqual([0]);
    expect(m.ctx.gameover).toBeUndefined();
  });

  it('a disc falls to the lowest empty space and the turn passes', () => {
    const m = createMatch(fourInARow, 2);
    expect(m.move(0, 'drop', 3)).toBe(true);
    expect(m.G.board[idx(5, 3)]).toBe(0);
    expect(m.G.turnP).toBe('1');
    expect(m.move(1, 'drop', 3)).toBe(true);
    expect(m.G.board[idx(4, 3)]).toBe(1); // stacked on top
    expect(m.G.turnP).toBe('0');
    expect(m.move(0, 'drop', 0)).toBe(true);
    expect(m.G.board[idx(5, 0)]).toBe(0);
    expect(m.G.board.filter((c) => c !== null)).toHaveLength(3);
    expect(landingRow(m.G.board, 3)).toBe(3);
    expect(landingRow(m.G.board, 6)).toBe(5);
    expect(m.G.log.map((e) => [e.t, e.p, e.col, e.row])).toEqual([['drop', 0, 3, 5], ['drop', 1, 3, 4], ['drop', 0, 0, 5]]);
    expect(m.G.log.map((e) => e.n)).toEqual([1, 2, 3]);
    expect(m.G.moveN).toBe(3);
  });
});

describe('four in a row: wins', () => {
  it('vertical', () => {
    const m = play(createMatch(fourInARow, 2), [0, 1, 0, 1, 0, 1, 0]);
    expect(m.G.over).toMatchObject({ placements: [1, 2], reason: 'win' });
    expect(m.G.line).toEqual([idx(2, 0), idx(3, 0), idx(4, 0), idx(5, 0)]);
    expect(m.ctx.gameover).toMatchObject({ placements: [1, 2] });
    expect(m.G.turnP).toBe('0'); // a winning drop never hands the turn over
    expect(legalMoves(m.G)).toEqual([]);
    expect(actingSeats(m.G)).toEqual([]);
  });

  it('horizontal, for seat 1', () => {
    const m = play(createMatch(fourInARow, 2), [0, 1, 0, 2, 0, 3, 6, 4]);
    expect(m.G.over).toMatchObject({ placements: [2, 1], reason: 'win' });
    expect(m.G.line).toEqual([idx(5, 1), idx(5, 2), idx(5, 3), idx(5, 4)]);
  });

  it('diagonal, rising to the right', () => {
    // Seat 0 lands on (5,0), (4,1), (3,2), (2,3).
    const m = play(createMatch(fourInARow, 2), [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    expect(m.G.over).toMatchObject({ placements: [1, 2], reason: 'win' });
    expect([...m.G.line].sort((a, b) => a - b)).toEqual([idx(2, 3), idx(3, 2), idx(4, 1), idx(5, 0)].sort((a, b) => a - b));
  });

  it('diagonal, falling to the right', () => {
    // The mirror image: seat 0 lands on (5,6), (4,5), (3,4), (2,3).
    const m = play(createMatch(fourInARow, 2), [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
    expect(m.G.over).toMatchObject({ placements: [1, 2], reason: 'win' });
    expect([...m.G.line].sort((a, b) => a - b)).toEqual([idx(2, 3), idx(3, 4), idx(4, 5), idx(5, 6)].sort((a, b) => a - b));
  });

  it('three in a row is not a win, and a line does not wrap round the edge', () => {
    const m = play(createMatch(fourInARow, 2), [0, 1, 0, 1, 0]);
    expect(m.G.over).toBe(null);
    const board = Array(42).fill(null);
    for (const c of [4, 5, 6]) board[idx(5, c)] = 0;
    board[idx(4, 0)] = 0; // the "fourth" disc is on the next row, first column
    expect(findWin(board)).toBe(null);
    board[idx(5, 3)] = 0;
    expect(findWin(board)).toMatchObject({ seat: 0 });
  });

  it('nothing can be played after the game is over', () => {
    const m = play(createMatch(fourInARow, 2), [0, 1, 0, 1, 0, 1, 0]);
    const before = JSON.stringify(m.G);
    expect(m.move(1, 'drop', 2)).toBe(false);
    expect(m.move(0, 'drop', 2)).toBe(false);
    expect(m.move(1, 'resign')).toBe(false);
    expect(JSON.stringify(m.G)).toBe(before);
  });
});

describe('four in a row: a full board is a draw', () => {
  it('42 moves, no line: both placed first, reason "draw"', () => {
    const m = createMatch(fourInARow, 2);
    play(m, DRAW.slice(0, 41));
    expect(m.G.over).toBe(null);
    expect(legalMoves(m.G)).toEqual([DRAW[41]]);
    expect(m.move(1, 'drop', DRAW[41])).toBe(true);
    expect(m.G.board.every((c) => c !== null)).toBe(true);
    expect(findWin(m.G.board)).toBe(null);
    expect(m.G.over).toMatchObject({ placements: [1, 1], reason: 'draw' });
    expect(m.G.moveN).toBe(MERCY_MOVES);
    expect(legalMoves(m.G)).toEqual([]);
    expect(m.G.log.length).toBeLessThanOrEqual(80);
  });

  it('a win on the very last disc is a win, not a draw', () => {
    // Terminal conditions are checked in order: the line first.
    const G = { board: Array(42).fill(null), turnP: '0', n: 2, log: [], logN: 0, moveN: 41, over: null, resolving: false, line: null };
    const filled = createMatch(fourInARow, 2); play(filled, DRAW);
    G.board = [...filled.G.board];
    // Empty the top of column 0 and make the three below it seat 0's, so the last disc completes a vertical four.
    G.board[idx(0, 0)] = null; for (const r of [1, 2, 3]) G.board[idx(r, 0)] = 0;
    fourInARow.moves.drop.move({ G, playerID: '0' }, 0);
    expect(G.over).toMatchObject({ placements: [1, 2], reason: 'win' });
  });
});

describe('four in a row: refused moves', () => {
  it('out of turn', () => {
    const m = createMatch(fourInARow, 2);
    expect(m.move(1, 'drop', 3)).toBe(false);
    expect(m.G.board.every((c) => c === null)).toBe(true);
    expect(m.G.turnP).toBe('0');
    m.move(0, 'drop', 3);
    expect(m.move(0, 'drop', 3)).toBe(false); // twice in a row
    expect(m.G.board.filter((c) => c !== null)).toHaveLength(1);
  });

  it('a full column', () => {
    const m = play(createMatch(fourInARow, 2), [3, 3, 3, 3, 3, 3]);
    expect(landingRow(m.G.board, 3)).toBe(-1);
    expect(legalMoves(m.G)).toEqual([0, 1, 2, 4, 5, 6]);
    expect(m.move(0, 'drop', 3)).toBe(false);
    expect(m.G.turnP).toBe('0');
    expect(m.G.moveN).toBe(6);
    expect(m.move(0, 'drop', 4)).toBe(true);
  });

  it('a column that is not on the board, or not a whole number', () => {
    const m = createMatch(fourInARow, 2);
    for (const col of [-1, 7, 99, 1.5, '3', null, undefined, NaN, [3], { col: 3 }, true]) {
      expect(m.move(0, 'drop', col), JSON.stringify(col)).toBe(false);
    }
    expect(m.G.board.every((c) => c === null)).toBe(true);
    expect(m.G.moveN).toBe(0);
    expect(m.G.log).toEqual([]);
  });

  it('a seat that is not at the table, and a move that does not exist', () => {
    const m = createMatch(fourInARow, 2);
    expect(m.move(2, 'drop', 3)).toBe(false);
    expect(m.move(0, 'teleport', 3)).toBe(false);
    expect(m.G.board.every((c) => c === null)).toBe(true);
  });
});

describe('four in a row: resign', () => {
  it('either seat may resign at any time; the other seat wins', () => {
    const a = createMatch(fourInARow, 2);
    a.move(0, 'drop', 3);
    expect(a.move(0, 'resign')).toBe(true); // not seat 0's turn: resigning is allowed out of turn
    expect(a.G.over).toMatchObject({ placements: [2, 1], reason: 'resign' });
    expect(a.G.log[a.G.log.length - 2]).toMatchObject({ t: 'resign', p: 0 });
    expect(a.G.log[a.G.log.length - 1]).toMatchObject({ t: 'over', reason: 'resign' });
    const b = createMatch(fourInARow, 2);
    expect(b.move(1, 'resign')).toBe(true);
    expect(b.G.over).toMatchObject({ placements: [1, 2], reason: 'resign' });
    expect(b.move(0, 'resign')).toBe(false); // the game is already over; the result stands
    expect(b.G.over.placements).toEqual([1, 2]);
  });
});

describe('four in a row: every move runs on the server only, and the view hides nothing it should not', () => {
  it('moves are client: false; the game has no hidden state to strip', () => {
    for (const [name, mv] of Object.entries(fourInARow.moves)) expect(mv.client, name).toBe(false);
    expect(Object.keys(fourInARow.moves).sort()).toEqual(['drop', 'resign']);
    expect(fourInARow.arena).toEqual({ house: false, seatsMin: 2, seatsMax: 2 });
    expect(fourInARow.minPlayers).toBe(2); expect(fourInARow.maxPlayers).toBe(2);
    const m = play(createMatch(fourInARow, 2), [3, 2]);
    expect(m.view(0)).toEqual(m.view(1));
    expect(m.view(null).board).toEqual(m.G.board);
  });
});

describe('four in a row: telemetry and bot', () => {
  it('telemetry counts a seat\'s own drops and its share of centre columns', () => {
    const m = play(createMatch(fourInARow, 2), [3, 0, 2, 0, 6, 0]);
    expect(telemetry(m.G, 0)).toEqual({ metrics: { moves: 3, centerShare: 67 }, skillTags: ['pattern recognition', 'positioning'] });
    expect(telemetry(m.G, 1).metrics).toEqual({ moves: 3, centerShare: 0 });
    expect(telemetry({}, 0).metrics).toEqual({ moves: 0, centerShare: 0 }); // a state with no log does not throw
  });

  it('the bot only ever plays legal columns, takes a win and blocks one', () => {
    for (const level of [1, 2, 3]) {
      const m = createMatch(fourInARow, 2);
      for (let i = 0; i < 12 && !m.G.over; i++) {
        const seat = Number(m.G.turnP);
        const act = bot({ G: m.view(seat), ctx: m.ctx, seat, level });
        expect(act.move).toBe('drop');
        expect(legalMoves(m.G)).toContain(act.args[0]);
        expect(m.move(seat, act.move, ...act.args)).toBe(true);
      }
    }
    // Seat 0 has three in column 0: at level 2 and 3, seat 0 completes it and seat 1 blocks it.
    const win = play(createMatch(fourInARow, 2), [0, 6, 0, 6, 0, 5]);
    for (const level of [2, 3]) expect(bot({ G: win.view(0), ctx: win.ctx, seat: 0, level }).args).toEqual([0]);
    const block = play(createMatch(fourInARow, 2), [0, 6, 0, 5, 0]);
    for (const level of [2, 3]) expect(bot({ G: block.view(1), ctx: block.ctx, seat: 1, level }).args).toEqual([0]);
    // No legal move: no action.
    const done = play(createMatch(fourInARow, 2), DRAW);
    expect(bot({ G: done.view(0), ctx: done.ctx, seat: 0, level: 2 })).toBe(null);
  });

  it('bot against bot always reaches a result within the mercy limit', () => {
    for (let i = 0; i < 5; i++) {
      const m = playout({ game: fourInARow, bot, numSeats: 2 });
      expect(m.G.over.placements).toHaveLength(2);
      expect(Math.min(...m.G.over.placements)).toBe(1);
      expect(m.G.moveN).toBeLessThanOrEqual(MERCY_MOVES);
      expect(['win', 'draw']).toContain(m.G.over.reason);
    }
  });

  it('the metadata matches the rules', () => {
    expect(meta.id).toBe('fourinarow');
    expect(meta.seats).toEqual({ min: fourInARow.arena.seatsMin, max: fourInARow.arena.seatsMax });
  });
});
