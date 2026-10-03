// Mancala rules: sowing, the extra turn, captures, the end-of-game sweep, the
// mercy limit, refusals, and bot-vs-bot playouts at every level.
import { describe, it, expect } from 'vitest';
import { mancala, legalMoves, sow, pathOf, settle, telemetry, storeOf, pitIndex, MERCY_MOVES, TOTAL } from '../src/games/mancala/rules.js';
import { bot } from '../src/games/mancala/bot.js';
import meta from '../src/games/mancala/meta.js';
import { createMatch, playout } from '../src/games/sim.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);
/** A hand-built position, shaped like a match in progress, for calling a move directly. */
const position = (pits, turnP = '0', extra = {}) => ({ pits: pits.slice(), turnP, n: 2, log: [], logN: 0, moveN: 0, over: null, resolving: false, ...extra });
const play = (G, seat, pit) => mancala.moves.sow.move({ G, playerID: String(seat) }, pit);

describe('mancala: setup', () => {
  it('starts with 4 stones in each of 12 pits, empty stores, seat 0 to move', () => {
    const m = createMatch(mancala, 2);
    expect(m.G.pits).toEqual([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(m.G.turnP).toBe('0');
    expect(legalMoves(m.G)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(legalMoves(m.G, 1)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(mancala.minPlayers).toBe(2);
    expect(mancala.maxPlayers).toBe(2);
  });
});

describe('mancala: sowing', () => {
  it('drops one stone per pit counter-clockwise and passes the turn', () => {
    const m = createMatch(mancala, 2);
    expect(m.move(0, 'sow', 0)).toBe(true);
    expect(m.G.pits).toEqual([0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(m.G.turnP).toBe('1');
    expect(m.G.moveN).toBe(1);
  });

  it('puts a stone in the sower\'s own store and carries on round the other side', () => {
    const m = createMatch(mancala, 2);
    expect(m.move(0, 'sow', 5)).toBe(true);
    expect(m.G.pits).toEqual([4, 4, 4, 4, 4, 0, 1, 5, 5, 5, 4, 4, 4, 0]);
    expect(m.G.turnP).toBe('1');
  });

  it('skips the opponent\'s store (seat 0 sowing right round)', () => {
    const r = sow([0, 0, 2, 0, 0, 10, 0, 1, 1, 1, 1, 1, 1, 5], 0, 5);
    expect(pathOf(0, 5, 10)).toEqual([6, 7, 8, 9, 10, 11, 12, 0, 1, 2]);
    expect(r.pits[13], 'opponent store untouched').toBe(5);
    expect(r.pits).toEqual([1, 1, 3, 0, 0, 0, 1, 2, 2, 2, 2, 2, 2, 5]);
    expect(sum(r.pits)).toBe(23);
  });

  it('skips the opponent\'s store (seat 1 sowing right round)', () => {
    const G = position([1, 1, 1, 1, 1, 1, 7, 0, 2, 0, 0, 0, 9, 0], '1');
    expect(play(G, 1, 5)).toBeUndefined();
    expect(G.pits[6], 'seat 0 store untouched').toBe(7);
    expect(G.pits).toEqual([2, 2, 2, 2, 2, 2, 7, 1, 3, 0, 0, 0, 0, 1]);
  });

  it('keeps the number of stones constant through a whole game', () => {
    playout({ game: mancala, bot, numSeats: 2, onStep: (m) => expect(sum(m.G.pits)).toBe(TOTAL) });
  });
});

describe('mancala: extra turn', () => {
  it('last stone in your own store keeps the turn with you', () => {
    const m = createMatch(mancala, 2);
    expect(m.move(0, 'sow', 2)).toBe(true); // 4 stones from the third pit end in the store
    expect(m.G.pits).toEqual([4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0]);
    expect(m.G.turnP).toBe('0');
    expect(m.G.log[m.G.log.length - 1]).toMatchObject({ t: 'sow', p: 0, pit: 2, stones: 4, extra: true, cap: 0 });
    expect(m.move(1, 'sow', 0), 'the other seat may not move').toBe(false);
    expect(m.move(0, 'sow', 5)).toBe(true);
    expect(m.G.turnP).toBe('1');
  });

  it('works for seat 1 too', () => {
    const m = createMatch(mancala, 2);
    m.move(0, 'sow', 0);
    expect(m.move(1, 'sow', 2)).toBe(true);
    expect(m.G.pits[13]).toBe(1);
    expect(m.G.turnP).toBe('1');
  });
});

describe('mancala: capture', () => {
  it('last stone in an empty pit of your own takes it and the pit across', () => {
    const G = position([0, 0, 1, 0, 3, 0, 2, 4, 0, 5, 0, 0, 2, 1]);
    expect(play(G, 0, 2)).toBeUndefined(); // one stone from pit 2 lands in empty pit 3, across from slot 9 (5 stones)
    expect(G.pits).toEqual([0, 0, 0, 0, 3, 0, 8, 4, 0, 0, 0, 0, 2, 1]);
    expect(G.turnP).toBe('1');
    expect(G.log[0]).toMatchObject({ t: 'sow', cap: 6, extra: false, last: 3 });
    expect(telemetry(G, 0).metrics).toMatchObject({ captures: 1, capturedStones: 6, moves: 1 });
  });

  it('captures nothing when the pit across is empty', () => {
    const G = position([0, 0, 1, 0, 3, 0, 2, 4, 0, 0, 5, 0, 2, 1]);
    play(G, 0, 2);
    expect(G.pits).toEqual([0, 0, 0, 1, 3, 0, 2, 4, 0, 0, 5, 0, 2, 1]);
    expect(G.log[0].cap).toBe(0);
  });

  it('captures nothing when the last stone lands on the opponent\'s side', () => {
    const G = position([1, 0, 0, 0, 0, 2, 0, 0, 3, 3, 3, 3, 3, 0]);
    play(G, 0, 5); // store, then the empty slot 7, which is not the sower's pit
    expect(G.pits).toEqual([1, 0, 0, 0, 0, 0, 1, 1, 3, 3, 3, 3, 3, 0]);
    expect(G.turnP).toBe('1');
    expect(G.log[0].cap).toBe(0);
  });

  it('a full lap that ends in the pit it started from captures', () => {
    const r = sow([0, 0, 0, 13, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0], 0, 3);
    // 13 stones: one in every slot but the opponent's store, the last back in pit 3.
    expect(r.last).toBe(3);
    expect(r.captured).toBe(3); // the lone stone plus the 2 now across from it
    expect(r.pits[3]).toBe(0);
    expect(r.pits[9]).toBe(0);
    expect(r.pits[6]).toBe(4);
  });
});

describe('mancala: end of the game', () => {
  it('when the mover empties their side the other player keeps what is on theirs', () => {
    const G = position([0, 0, 0, 0, 0, 1, 20, 2, 0, 3, 0, 0, 1, 21]);
    play(G, 0, 5);
    expect(G.pits).toEqual([0, 0, 0, 0, 0, 0, 21, 0, 0, 0, 0, 0, 0, 27]);
    expect(G.over).toMatchObject({ placements: [2, 1], reason: 'win', scores: [21, 27] });
    expect(G.log.map((e) => e.t)).toEqual(['sow', 'sweep', 'over']);
    expect(G.log[1]).toMatchObject({ p: 1, stones: 6 });
    expect(G.turnP, 'the turn is not handed over after the end').toBe('0');
  });

  it('when the move empties the opponent\'s side (by capture) the mover keeps their own stones', () => {
    const G = position([1, 0, 4, 0, 0, 0, 20, 0, 0, 0, 0, 2, 0, 21]);
    play(G, 0, 0); // lands in empty pit 1, across from slot 11
    expect(G.pits).toEqual([0, 0, 0, 0, 0, 0, 27, 0, 0, 0, 0, 0, 0, 21]);
    expect(G.over).toMatchObject({ placements: [1, 2], scores: [27, 21] });
  });

  it('equal stores is a draw', () => {
    const G = position([0, 0, 0, 0, 0, 1, 23, 1, 0, 0, 0, 0, 0, 23]);
    play(G, 0, 5);
    expect(G.over).toMatchObject({ placements: [1, 1], reason: 'draw', scores: [24, 24] });
  });

  it('settle() sends each side home', () => {
    expect(settle([1, 2, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 9])).toEqual({ pits: [0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 9], swept: [3, 0] });
  });

  it('the mercy limit ends the game on the stores as they stand', () => {
    const G = position([4, 4, 4, 4, 4, 4, 3, 4, 4, 4, 4, 4, 4, 1], '0', { moveN: MERCY_MOVES - 1 });
    play(G, 0, 0);
    expect(G.over).toMatchObject({ placements: [1, 2], reason: 'mercy', scores: [3, 1] });
  });

  it('records who led at the midpoint', () => {
    const G = position([0, 0, 1, 0, 3, 0, 14, 4, 0, 5, 0, 0, 2, 9]);
    play(G, 0, 2);
    expect(G.mid).toEqual([20, 9]);
    expect(telemetry(G, 0).midRank).toBe(1);
    expect(telemetry(G, 1).midRank).toBe(2);
  });
});

describe('mancala: refusals', () => {
  it('refuses out-of-turn, empty-pit, out-of-range and malformed moves', () => {
    const m = createMatch(mancala, 2);
    expect(m.move(1, 'sow', 0), 'not your turn').toBe(false);
    expect(m.move(0, 'sow', 6), 'no such pit').toBe(false);
    expect(m.move(0, 'sow', -1)).toBe(false);
    expect(m.move(0, 'sow', '2'), 'a string is not a pit').toBe(false);
    expect(m.move(0, 'sow', 1.5)).toBe(false);
    expect(m.move(0, 'sow')).toBe(false);
    expect(m.G.moveN).toBe(0);
    expect(m.move(0, 'sow', 2)).toBe(true); // extra turn, pit 2 is now empty
    expect(m.move(0, 'sow', 2), 'an empty pit').toBe(false);
  });

  it('resign ends the game for the other seat, and nothing moves afterwards', () => {
    const m = createMatch(mancala, 2);
    m.move(0, 'sow', 0);
    expect(m.move(0, 'resign'), 'resign is allowed out of turn').toBe(true);
    expect(m.G.over).toMatchObject({ placements: [2, 1], reason: 'resign' });
    expect(m.move(1, 'sow', 0)).toBe(false);
    expect(legalMoves(m.G)).toEqual([]);
  });

  it('G stays plain JSON', () => {
    const m = playout({ game: mancala, bot, numSeats: 2 });
    expect(JSON.parse(JSON.stringify(m.G))).toEqual(m.G);
  });
});

describe('mancala: bot and metadata', () => {
  it('bots reach a result, at every level, with valid placements', () => {
    for (let round = 0; round < 6; round++) {
      const levels = [[2, 2], [1, 3], [3, 1], [3, 3], [1, 1], [2, 3]][round];
      const m = playout({ game: mancala, bot: (a) => bot({ ...a, level: levels[a.seat] }), numSeats: 2 });
      const over = m.G.over;
      expect(over, 'game ended').toBeTruthy();
      expect(over.placements).toHaveLength(2);
      expect(Math.min(...over.placements)).toBe(1);
      for (const p of over.placements) expect([1, 2]).toContain(p);
      expect(over.scores[0] + over.scores[1]).toBe(TOTAL);
      expect(over.placements[0] === 1).toBe(over.scores[0] >= over.scores[1]);
      expect(m.G.moveN).toBeLessThan(MERCY_MOVES);
      expect(m.G.log.length).toBeLessThanOrEqual(80);
      for (let s = 0; s < 2; s++) {
        const t = telemetry(m.G, s);
        expect(t.skillTags.length).toBeGreaterThanOrEqual(2);
        expect(t.metrics.store).toBe(m.G.pits[storeOf(s)]);
        expect([1, 2, undefined], "midRank is absent when a side ran dry before half the stones were home").toContain(t.midRank);
      }
    }
  });

  it('the bot only acts on its own turn and only from legal pits', () => {
    const m = createMatch(mancala, 2);
    expect(bot({ G: m.view(1), seat: 1 })).toBeNull();
    for (let level = 1; level <= 3; level++) {
      for (let i = 0; i < 20; i++) {
        const act = bot({ G: m.view(0), seat: 0, level });
        expect(act.move).toBe('sow');
        expect(legalMoves(m.G, 0)).toContain(act.args[0]);
      }
    }
    const lone = position([0, 0, 0, 0, 3, 0, 0, 1, 1, 1, 1, 1, 1, 0]);
    expect(bot({ G: lone, seat: 0, level: 3 })).toEqual({ move: 'sow', args: [4] });
    expect(pitIndex(1, 0)).toBe(7);
  });

  it('a sharp bot beats an easy one most of the time', () => {
    let wins = 0;
    for (let round = 0; round < 6; round++) {
      const sharp = round % 2;
      const m = playout({ game: mancala, bot: (a) => bot({ ...a, level: a.seat === sharp ? 3 : 1 }), numSeats: 2 });
      if (m.G.over.placements[sharp] === 1 && m.G.over.placements[1 - sharp] === 2) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(4); // measured: 60 of 60
  });

  it('metadata has everything the lobby, the how-to panel and the SEO page read', () => {
    expect(meta).toMatchObject({ id: 'mancala', name: 'Mancala', family: 'classic', seats: { min: 2, max: 2 } });
    expect(meta.skills).toHaveLength(3);
    expect(meta.howTo.length).toBeGreaterThanOrEqual(3);
    expect(meta.howTo.length).toBeLessThanOrEqual(6);
    expect(meta.reflection).toHaveLength(3);
    expect(typeof meta.paceSec).toBe('number');
    expect(meta.seo.strategy.length).toBeGreaterThanOrEqual(3);
    expect([...meta.icon]).toHaveLength(1);
    expect(JSON.stringify(meta)).not.toMatch(/—/); // no em dashes in the copy
  });
});
