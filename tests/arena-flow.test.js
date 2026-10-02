// The core loop end to end, in memory: a guest plays a bot, the result is
// recorded once, ratings and points move, and the debrief opens.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member, playToEnd, tick } from './helpers.js';

describe('arena: guest plays a bot', () => {
  it('goes from one click to a recorded result and a debrief', async () => {
    const A = makeArena();
    const me = await guest(A, 'Ada');
    const { table } = await A.call('playBots', me, { gameId: 'fourinarow' });
    expect(table.status).toBe('playing');
    expect(table.seats).toHaveLength(2);
    expect(table.seats[1].kind).toBe('bot');
    const access = await A.call('seatAccess', me, { id: table.id });
    expect(access.playerID).toBe('0');
    expect(access.credentials).toBeTruthy();

    const t = await playToEnd(A, table.id);
    await tick(20);
    expect(t.status).toBe('finished');
    const d = await A.call('debrief', me, { id: table.id });
    expect(d.standings).toHaveLength(2);
    expect(d.mine).toBeTruthy();
    expect(d.mine.ratingAfter).not.toBeUndefined();
    expect(A.c.results.count((r) => r.tableId === table.id)).toBe(1); // bots get no result row
    expect(me.points).toBeGreaterThanOrEqual(10);
    expect(me.stats.games).toBe(1);
    // Recording twice must be impossible.
    await A.hooks.matchOver(A.c.tables.get(table.id), A.bgio.state(table.id));
    expect(A.c.results.count((r) => r.tableId === table.id)).toBe(1);
  });

  it('two people at one table: host starts, both get results, observers do not', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await guest(A, 'Carol');
    const { table } = await A.call('createTable', a, { gameId: 'fourinarow' });
    await A.call('joinTable', b, { code: table.inviteCode });
    const watch = await A.call('joinTable', c, { id: table.id, role: 'player' });
    expect(watch.table.me.role).toBe('observer'); // seats were full, so Carol watches
    await expect(A.call('startTable', b, { id: table.id })).rejects.toThrow(/host/);
    await A.call('startTable', a, { id: table.id });
    expect((await A.call('seatAccess', c, { id: table.id })).playerID).toBe(null);
    await playToEnd(A, table.id);
    await tick(20);
    expect(A.c.results.count((r) => r.tableId === table.id)).toBe(2);
    const d = await A.call('debrief', c, { id: table.id });
    expect(d.watched).toBe(true);
    expect(d.mine).toBe(null);
  });
});
