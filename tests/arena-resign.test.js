// The Resign button: concede (the game ends now), or hand the seat to a bot
// (the game goes on). Deliberate, confirmed in the browser, and recorded.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member, tick, playToEnd } from './helpers.js';

const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
async function twoAt(A, a, b, gameId = 'fourinarow') {
  const { table } = await A.call('createTable', a, { gameId });
  await A.call('joinTable', b, { code: table.inviteCode });
  await A.call('startTable', a, { id: table.id });
  return table.id;
}

describe('resigning', () => {
  it('conceding ends a two-player game at once: the other player wins, and it is not an abandoned game', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await twoAt(A, a, b);
    expect((await A.call('table', b, { id })).table.resign).toEqual({ concede: true, bot: true, others: 1 });
    const rep = A.user(b.id).reputation.score;
    expect(await A.call('resignTable', b, { id, how: 'concede' })).toEqual({ ok: true, how: 'concede' });
    await tick(10);
    const t = A.c.tables.get(id);
    expect(t.status).toBe('finished');
    expect(t.result.reason).toBe('resign');
    expect(t.seats[1].takeover).toBeFalsy();
    expect(A.c.results.get(`${id}:${a.id}`)).toMatchObject({ placement: 1, won: true });
    expect(A.c.results.get(`${id}:${b.id}`)).toMatchObject({ placement: 2, won: false, takeover: null });
    expect(A.user(b.id).reputation.abandons).toBe(0);
    expect(A.user(b.id).reputation.score).toBeGreaterThanOrEqual(rep);
    const said = A.c.messages.filter((m) => m.tableId === id && m.system).map((m) => m.body);
    expect(said).toContain('Bob conceded the game.');
    // Nothing left to resign from.
    expect((await A.call('table', b, { id })).table.resign).toBeNull();
    expect((await err(A.call('resignTable', b, { id, how: 'concede' }))).status).toBe(403);
  });

  it('handing the seat to a bot keeps a two-player game going for the person across the table', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await twoAt(A, a, b);
    expect(await A.call('resignTable', b, { id, how: 'bot' })).toEqual({ ok: true, how: 'bot' });
    await tick(10);
    let t = A.c.tables.get(id);
    expect(t.status).toBe('playing'); // not over: the bot plays Bob's seat
    expect(t.seats[1].takeover).toBe('resigned');
    expect(A.user(b.id).reputation).toMatchObject({ abandons: 1 });
    // Bob's browser no longer holds the seat, and he may stay and watch.
    expect((await A.call('seatAccess', b, { id })).playerID).toBeNull();
    expect(t.players).toContain(b.id);
    t = await playToEnd(A, id);
    await tick(10);
    expect(A.c.tables.get(id).status).toBe('finished');
    expect(A.c.results.get(`${id}:${b.id}`).takeover).toBe('resigned');
  });

  it('against a bot alone, conceding is the only choice; a game with more than two seats cannot be conceded', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    const solo = (await A.call('playBots', a, { gameId: 'chess' })).table;
    expect(solo.resign).toEqual({ concede: true, bot: false, others: 0 });
    expect((await err(A.call('resignTable', a, { id: solo.id, how: 'bot' }))).message).toMatch(/Concede instead/);
    await A.call('resignTable', a, { id: solo.id, how: 'concede' });
    await tick(10);
    expect(A.c.tables.get(solo.id).status).toBe('finished');

    const boom = (await A.call('playBots', a, { gameId: 'ventureboom' })).table;
    expect(boom.resign).toMatchObject({ concede: false, bot: true });
    expect((await err(A.call('resignTable', a, { id: boom.id, how: 'concede' }))).message).toMatch(/cannot be conceded/);
    await A.call('resignTable', a, { id: boom.id, how: 'bot' });
    // Only bots are left, so the game is played out at once and recorded.
    for (let i = 0; i < 400 && A.c.tables.get(boom.id).status === 'playing'; i++) await tick(10);
    expect(A.c.tables.get(boom.id).status).toBe('finished');
    expect(A.c.results.get(`${boom.id}:${a.id}`).takeover).toBe('resigned');
  });

  it('only a seated player can resign, and only their own seat', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const w = await guest(A, 'Watcher'); const x = await member(A, 'Xan');
    const { table } = await A.call('createTable', a, { gameId: 'fourinarow' });
    await A.call('joinTable', b, { code: table.inviteCode });
    await A.call('joinTable', w, { code: table.inviteCode, role: 'observer' });
    expect((await err(A.call('resignTable', a, { id: table.id, how: 'concede' }))).status).toBe(403); // not started
    await A.call('startTable', a, { id: table.id });
    expect((await A.call('table', w, { id: table.id })).table.resign).toBeNull();
    for (const who of [w, x]) expect((await err(A.call('resignTable', who, { id: table.id, how: 'concede' }))).status).toBe(403);
    expect((await err(A.call('resignTable', a, { id: table.id, how: 'flip the table' }))).status).toBe(400);
    expect(A.c.tables.get(table.id).status).toBe('playing');
  });

  it('VentureFlow: resigning hands the seat to the game\'s own robot', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    const t = (await A.call('playBots', a, { gameId: 'ventureflow' })).table;
    expect(t.resign).toMatchObject({ concede: false, bot: true });
    await A.call('resignTable', a, { id: t.id, how: 'bot' });
    await tick(20);
    expect(A.c.tables.get(t.id).seats.find((s) => s.userId === a.id).takeover).toBe('resigned');
  });
});
