// Time invested: games are timed by the table, other work by "still here"
// beats credited on the server's clock. Nothing a browser says can add time
// to a game, and an idle tab earns nothing.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member, tick } from './helpers.js';
import { BEAT_MAX_MS } from '../src/server/arena/time.js';

const GAME = 'fourinarow';
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
const WIN = [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]];

/** Seat 0 wins in seven moves, `gap` ms apart. Returns the table id. */
async function play(A, a, b, { gap = 10_000, mode = undefined } = {}) {
  const { table } = await A.call('createTable', a, { gameId: GAME, mode });
  await A.call('joinTable', b, { code: table.inviteCode });
  await A.call('startTable', a, { id: table.id });
  for (const [seat, col] of WIN) { A.advance(gap); await A.bgio.submit(table.id, GAME, seat, 'drop', [col]); await tick(2); }
  await tick(5);
  return table.id;
}

describe('time invested: games', () => {
  it('a finished game counts from the first move to the last, for everyone at the table', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await play(A, a, b, { gap: 10_000 });
    for (const u of [a, b]) expect(A.c.results.get(`${id}:${u.id}`).ms).toBe(70_000);
    const mine = await A.call('myGames', a, {});
    expect(mine.ms).toBe(70_000);
    expect(mine.rows[0].ms).toBe(70_000);
    expect(mine.games[0]).toMatchObject({ gameId: GAME, played: 1, ms: 70_000 });
    expect((await A.call('gameRecord', a, { id })).mine.ms).toBe(70_000);
  });

  it('adds up across games and says how much went into each', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await play(A, a, b, { gap: 10_000 });
    await play(A, b, a, { gap: 20_000 });
    const t = await A.call('timeInvested', a, {});
    expect(t).toMatchObject({ total: 210_000, gameMs: 210_000, workMs: 0, work: [] });
    expect(t.games).toEqual([{ gameId: GAME, gameName: 'Four in a Row', icon: expect.any(String), ms: 210_000, played: 2 }]);
    expect((await A.call('timeInvested', await guest(A, 'New'), {})).total).toBe(0);
  });

  it('a turn-based game counts only your own moves, each capped at five minutes', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    // A day between moves: nobody sat at the table for a week.
    const id = await play(A, a, b, { gap: 86_400_000, mode: 'turn_based' });
    expect(A.c.results.get(`${id}:${a.id}`).ms).toBe(4 * 300_000); // seat 0 made four moves
    expect(A.c.results.get(`${id}:${b.id}`).ms).toBe(3 * 300_000);
  });

  it('a result recorded before time was kept is worked out from its table', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await play(A, a, b, { gap: 10_000 });
    const r = A.c.results.get(`${id}:${a.id}`); delete r.ms; A.c.results.put(r);
    expect((await A.call('myGames', a, {})).rows[0].ms).toBe(70_000);
    expect((await A.call('timeInvested', a, {})).total).toBe(70_000);
  });

  it('a table sends the server\'s clock with it, so the table clock does not depend on the device', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    const { table } = await A.call('createTable', a, { gameId: GAME });
    A.advance(5000);
    const again = (await A.call('table', a, { id: table.id })).table;
    expect(again.now - table.now).toBe(5000);
  });
});

describe('time invested: work that is not a game', () => {
  it('credits the gap between beats, on the server\'s clock', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    expect(await A.call('timeBeat', a, { kind: 'guide', ref: 'coach' })).toEqual({ ms: 0, sessions: 1 }); // the first beat starts the clock
    A.advance(30_000);
    expect(await A.call('timeBeat', a, { kind: 'guide', ref: 'coach' })).toEqual({ ms: 30_000, sessions: 1 });
    A.advance(30_000);
    await A.call('timeBeat', a, { kind: 'guide', ref: 'coach' });
    const t = await A.call('timeInvested', a, {});
    expect(t).toMatchObject({ total: 60_000, gameMs: 0, workMs: 60_000 });
    expect(t.work).toEqual([{ kind: 'guide', ref: 'coach', label: 'The Coach', ms: 60_000, sessions: 1, lastAt: expect.any(Number) }]);
  });

  it('a tab left open earns nothing: a late beat starts a new session and is not credited', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    await A.call('timeBeat', a, { kind: 'guide', ref: 'mentor' });
    A.advance(30_000);
    await A.call('timeBeat', a, { kind: 'guide', ref: 'mentor' });
    A.advance(8 * 3_600_000); // overnight
    expect(await A.call('timeBeat', a, { kind: 'guide', ref: 'mentor' })).toEqual({ ms: 30_000, sessions: 2 });
    A.advance(BEAT_MAX_MS + 1);
    expect((await A.call('timeBeat', a, { kind: 'guide', ref: 'mentor' })).ms).toBe(30_000);
    A.advance(BEAT_MAX_MS);
    expect((await A.call('timeBeat', a, { kind: 'guide', ref: 'mentor' })).ms).toBe(30_000 + BEAT_MAX_MS);
  });

  it('keeps each piece of work and each member apart', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    for (const [u, ref] of [[a, 'coach'], [a, 'historian'], [b, 'coach']]) await A.call('timeBeat', u, { kind: 'guide', ref });
    A.advance(20_000);
    await A.call('timeBeat', a, { kind: 'guide', ref: 'coach' });
    expect((await A.call('timeInvested', a, {})).work.map((w) => [w.ref, w.ms])).toEqual([['coach', 20_000]]);
    expect((await A.call('timeInvested', b, {})).total).toBe(0);
  });

  it('refuses what cannot be timed, and a browser cannot name its own number', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const g = await guest(A, 'Guest');
    for (const args of [{ kind: 'game', ref: GAME }, { kind: 'guide', ref: 'nobody' }, { kind: 'idea', ref: 'x' }, { kind: '__proto__', ref: 'coach' }, {}]) {
      expect((await err(A.call('timeBeat', a, args))).status).toBe(400);
    }
    expect((await err(A.call('timeBeat', g, { kind: 'guide', ref: 'coach' }))).status).toBe(400); // guides are for members
    await A.call('timeBeat', a, { kind: 'guide', ref: 'coach', ms: 9_999_999 });
    A.advance(1000);
    expect((await A.call('timeBeat', a, { kind: 'guide', ref: 'coach', ms: 9_999_999 })).ms).toBe(1000);
    // A script cannot run the clock up either: beats are rate limited.
    let refused = null;
    for (let i = 0; i < 20 && !refused; i++) { try { await A.call('timeBeat', a, { kind: 'guide', ref: 'coach' }); } catch (e) { refused = e; } }
    expect(refused && refused.status).toBe(429);
  });
});
