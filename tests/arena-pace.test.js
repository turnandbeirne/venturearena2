// Pace of play: the pauses that let a person follow the game. The rules never
// change with it; only how long robots wait and how long a pause lasts.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member } from './helpers.js';
import { botDelay } from '../src/server/bots/runner.js';
import { GAMES, GAME_ORDER } from '../src/games/registry.js';
import { createMatch, playout } from '../src/games/sim.js';
import { pauseAfter, HOLD_MS, REACT_MS, CARD } from '../src/games/ventureboom/rules.js';
import { PACES, paceFactor, paceOf } from '../src/shared/pace.js';

const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
const INFO = Object.fromEntries(await Promise.all(GAME_ORDER.map(async (id) => [id, await import(`../src/games/${id}/info.js`)])));

describe('pace: how long a bot waits', () => {
  const base = { watched: true, lo: 500, hi: 1100, rand: () => 0.5 };
  it('holds for what just happened, and the table\'s pace stretches it', () => {
    expect(botDelay({ ...base, reacting: false, hold: 0, pace: 'steady' })).toBe(800);
    expect(botDelay({ ...base, reacting: false, hold: 1900, pace: 'steady' })).toBe(1900);
    expect(botDelay({ ...base, reacting: false, hold: 1900, pace: 'slow' })).toBeCloseTo(1900 * PACES.slow.factor);
    expect(botDelay({ ...base, reacting: false, hold: 1900, pace: 'quick' })).toBeCloseTo(1900 * PACES.quick.factor);
    expect(PACES.slow.factor).toBeGreaterThan(1);
    expect(PACES.quick.factor).toBeLessThan(1);
  });
  it('a bot only saying "no objection" answers at once, at any pace, unless the play has not been seen yet', () => {
    // (Bug this guards: five bots each taking a full pause to say "no objection".)
    expect(botDelay({ ...base, reacting: true, hold: 0, pace: 'slow' })).toBeLessThan(300);
    expect(botDelay({ ...base, reacting: true, hold: HOLD_MS.announce, pace: 'slow' })).toBeCloseTo(HOLD_MS.announce * PACES.slow.factor);
  });
  it('with nobody watching there is no pause at all', () => {
    expect(botDelay({ ...base, watched: false, reacting: false, hold: 2600, pace: 'slow' })).toBe(0);
  });
  it('an unknown pace is Steady', () => {
    expect(paceOf('warp')).toBe('steady');
    expect(paceFactor(undefined)).toBe(1);
    expect(paceFactor('__proto__')).toBe(1);
  });
});

describe('pace: what VentureBoom holds for', () => {
  const g = GAMES.ventureboom;
  it('a card just played is held until the first answer, and not again for each answer after it', () => {
    const m = createMatch(g.rules, 4);
    // Deals are random: try a few until the first player holds a simple action card.
    let card = null; let m2 = m;
    for (let i = 0; i < 40 && !card; i++) {
      m2 = createMatch(g.rules, 4);
      const s0 = Number(m2.G.turnP);
      card = m2.G.players[String(s0)].hand.find((id) => ['ooo', 'research', 'reorg'].includes(CARD[id].type)) || null;
    }
    expect(card, 'a deal with an action card in the first hand').toBeTruthy();
    return check(m2, card);
  });
  function check(m, card) {
    const seat = Number(m.G.turnP);
    expect(m.move(seat, 'play', card)).toBe(true);
    expect(m.G.pending.stage).toBe('react');
    expect(pauseAfter(m.G)).toBe(HOLD_MS.announce);
    const first = m.G.waiting[0];
    expect(m.move(first, 'react', false, m.G.pending.id, m.G.pending.passes)).toBe(true);
    if (m.G.pending) expect(pauseAfter(m.G)).toBe(0);
    else expect(pauseAfter(m.G)).toBeGreaterThan(0); // resolved: the result is held instead
  }
  it('every pause is long enough to read and shorter than the window it sits in', () => {
    for (const [k, ms] of Object.entries(HOLD_MS)) { expect(ms, k).toBeGreaterThanOrEqual(800); expect(ms * PACES.slow.factor, k).toBeLessThan(REACT_MS); }
    expect(pauseAfter(null)).toBe(0);
    const done = playout({ game: g.rules, bot: g.bot, housekeeping: g.housekeeping, numSeats: 3 });
    expect(pauseAfter(done.G)).toBe(0); // a finished game holds nothing back
  });
  it('the board announces each entry for exactly as long as the server holds the robots after it', () => {
    // If these two drift apart the table gets ahead of the words on it again.
    for (const [t, ms] of Object.entries(HOLD_MS)) if (t !== 'announce') expect(INFO.ventureboom.holdOf({ t }), t).toBe(ms);
    expect(INFO.ventureboom.holdOf({ t: 'something new' })).toBeGreaterThanOrEqual(1200);
    // What the waiting panel already shows is not announced a second time.
    expect(INFO.ventureboom.SHOWN_BY_PANEL).toEqual(expect.arrayContaining(['play', 'combo', 'offer']));
    for (const t of INFO.ventureboom.SHOWN_BY_PANEL) expect(HOLD_MS[t], `${t} is held by the panel, not by a pause of its own`).toBeUndefined();
  });
  it('is registered, so the bot runner can ask for it', () => {
    expect(typeof g.pauseAfter).toBe('function');
    expect(GAMES.chess.pauseAfter).toBeUndefined();
  });
});

describe('what happened: every move a game logs can be put in words', () => {
  for (const id of GAME_ORDER) {
    const info = INFO[id];
    if (!info.describe) continue;
    it(`${id}: no log entry is left without a sentence`, () => {
      const g = GAMES[id];
      const seen = {};
      for (const n of [g.meta.seats.min, g.meta.seats.max]) {
        for (let round = 0; round < 3; round++) {
          const m = createMatch(g.rules, n, g.testSetup ? g.testSetup(n) : undefined);
          const done = playout({ game: g.rules, bot: g.bot, housekeeping: g.housekeeping, numSeats: n, setupData: g.testSetup ? g.testSetup(n) : undefined });
          for (const e of [...m.G.log, ...done.G.log]) (seen[e.t] = seen[e.t] || []).push(e);
        }
      }
      const nm = (s) => `P${Number(s) + 1}`;
      const silent = new Set(['takeover', 'over']); // the arena announces a takeover itself; the list words the end of the game for every game
      for (const [t, list] of Object.entries(seen)) {
        if (silent.has(t)) continue;
        for (const e of list.slice(0, 40)) {
          const text = info.describe(e, nm);
          expect(text, `${id}: "${t}" has no sentence`).toEqual(expect.any(String));
          expect(text, `${id}: ${t}`).not.toMatch(/undefined|NaN|null|\[object/);
          const why = info.explain ? info.explain(e) : null;
          if (why !== null) expect(why, `${id}: ${t} explanation`).not.toMatch(/undefined|NaN|\[object/);
        }
      }
      expect(Object.keys(seen).length).toBeGreaterThan(0);
    });
  }
});

describe('pace: who may set it', () => {
  it('the host sets it before the game; a lone player among bots sets it during one', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const w = await guest(A, 'Watcher');
    const { table } = await A.call('createTable', a, { gameId: 'ventureboom' });
    expect(table).toMatchObject({ pace: 'steady', canPace: true, idleLimitMs: 180000 });
    await A.call('joinTable', b, { code: table.inviteCode });
    await A.call('joinTable', w, { code: table.inviteCode, role: 'observer' });
    expect((await A.call('table', b, { id: table.id })).table.canPace).toBe(false);
    expect((await err(A.call('setPace', b, { id: table.id, pace: 'slow' }))).status).toBe(403);
    expect((await err(A.call('setPace', w, { id: table.id, pace: 'slow' }))).status).toBe(403);
    expect((await err(A.call('setPace', a, { id: table.id, pace: 'ludicrous' }))).status).toBe(400);
    expect((await A.call('setPace', a, { id: table.id, pace: 'slow' })).table.pace).toBe('slow');
    expect(A.c.tables.get(table.id).pace).toBe('slow');
    // The pace is not a game setting: the rules never see it.
    expect(A.c.tables.get(table.id).settings.pace).toBeUndefined();

    const solo = (await A.call('playBots', b, { gameId: 'ventureboom' })).table;
    expect(solo.canPace).toBe(true);
    expect((await A.call('setPace', b, { id: solo.id, pace: 'quick' })).table.pace).toBe('quick');
    expect((await err(A.call('setPace', a, { id: solo.id, pace: 'slow' }))).status).toBe(403);
  });
});
