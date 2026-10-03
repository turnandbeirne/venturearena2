// Game history: the games a member finished, and each game's record with the
// table chat, readable by the people who were at that table and nobody else.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member, tick } from './helpers.js';

const GAME = 'fourinarow';
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
/** Seat 0 wins a Four in a Row game in seven moves. Returns the table id. */
async function playOut(A, a, b, { chat = [], watcher = null, visibility = undefined } = {}) {
  const { table } = await A.call('createTable', a, { gameId: GAME });
  if (visibility) await A.call('setTableSettings', a, { id: table.id, visibility });
  await A.call('joinTable', b, { code: table.inviteCode });
  if (watcher) await A.call('joinTable', watcher, { code: table.inviteCode, role: 'observer' });
  await A.call('startTable', a, { id: table.id });
  for (const [who, body] of chat) { await A.call('sendChat', who, { id: table.id, body }); A.advance(1000); }
  for (const [seat, col] of [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]]) await A.bgio.submit(table.id, GAME, seat, 'drop', [col]);
  await tick(5);
  return table.id;
}

describe('game history', () => {
  it('lists the games you finished, newest first, with who was there and how much was said', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Cyd');
    const first = await playOut(A, a, b, { chat: [[a, 'glhf'], [b, 'you too']] });
    A.advance(60000);
    const second = await playOut(A, c, a);
    const mine = await A.call('myGames', a, {});
    expect(mine.total).toBe(2);
    expect(mine.wins).toBe(1);
    expect(mine.rows.map((r) => r.tableId)).toEqual([second, first]);
    expect(mine.rows[1]).toMatchObject({ gameId: GAME, gameName: 'Four in a Row', placement: 1, players: 2, won: true, chatCount: 2 });
    expect(mine.rows[1].others).toEqual([{ name: 'Bob', avatar: A.user(b.id).avatar, bot: false, placement: 2 }]);
    expect(mine.rows[0]).toMatchObject({ placement: 2, won: false, chatCount: 0 });
    expect(mine.rows[0].delta).toBeLessThan(0);
    expect(mine.games).toEqual([{ gameId: GAME, gameName: 'Four in a Row', icon: expect.any(String), played: 2, won: 1, ms: expect.any(Number) }]);
    // Someone who has not played has an empty history, not an error.
    expect(await A.call('myGames', await guest(A, 'New'), {})).toMatchObject({ total: 0, rows: [], more: false });
  });

  it('pages: thirty at a time, "before" continues from the last row', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    // Results written directly: thirty-five real games would only test the game.
    for (let i = 0; i < 35; i++) A.c.results.put({ id: `t${i}:${a.id}`, tableId: `t${i}`, userId: a.id, gameId: GAME, seat: 0, placement: 1, players: 2, humans: 1, score: null, ratingBefore: 1200, ratingAfter: 1210, won: true, at: 1000 + i });
    const p1 = await A.call('myGames', a, {});
    expect(p1.rows).toHaveLength(30); expect(p1.more).toBe(true); expect(p1.total).toBe(35);
    expect(p1.rows[0].tableId).toBe('t34');
    const p2 = await A.call('myGames', a, { before: p1.rows[29].at });
    expect(p2.rows.map((r) => r.tableId)).toEqual(['t4', 't3', 't2', 't1', 't0']);
    expect(p2.more).toBe(false);
    // An unknown game in the filter is ignored rather than returning nothing.
    expect((await A.call('myGames', a, { gameId: 'no-such-game' })).rows).toHaveLength(30);
  });

  it('a game\'s record has the standings and the whole table chat, in order', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await playOut(A, a, b, { chat: [[a, 'glhf'], [b, 'you too'], [a, 'nice move']] });
    await A.call('answerDebrief', b, { id, answer: 'I chased the centre too long.' });
    const rec = await A.call('gameRecord', a, { id });
    expect(rec.table).toMatchObject({ id, gameId: GAME, gameName: 'Four in a Row', hasDebrief: true });
    expect(rec.standings.map((s) => [s.placement, s.name, s.you])).toEqual([[1, 'Alice', true], [2, 'Bob', false]]);
    expect(rec.standings[1].username).toBe(A.user(b.id).username);
    expect(rec.mine).toMatchObject({ placement: 1, won: true });
    expect(rec.watched).toBe(false);
    expect(rec.chat.filter((m) => !m.system).map((m) => [m.name, m.body])).toEqual([['Alice', 'glhf'], ['Bob', 'you too'], ['Alice', 'nice move']]);
    expect(rec.answers.map((x) => x.answer)).toEqual(['I chased the centre too long.']);
    // Direct messages never leak into a table's record.
    await A.call('connect', a, { userId: b.id }); await A.call('answerConnection', b, { userId: a.id, accept: true });
    await A.call('sendMessage', a, { toId: b.id, body: 'private' });
    expect(JSON.stringify(await A.call('gameRecord', b, { id }))).not.toMatch(/private/);
  });

  it('opens for the players and the watchers of that table, and for nobody else', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const w = await member(A, 'Wim'); const x = await member(A, 'Xan', { tier: 'ceo' });
    const id = await playOut(A, a, b, { chat: [[a, 'secret plan']], watcher: w });
    expect((await A.call('gameRecord', b, { id })).chat.some((m) => m.body === 'secret plan')).toBe(true);
    const watched = await A.call('gameRecord', w, { id });
    expect(watched.watched).toBe(true); expect(watched.mine).toBeNull();
    // A public table's DEBRIEF is open to others; its chat record is not, at any tier.
    const e = await err(A.call('gameRecord', x, { id }));
    expect(e.status).toBe(403);
    expect(e.message).not.toMatch(/secret plan/);
    expect((await err(A.call('gameRecord', a, { id: 'nope' }))).status).toBe(404);
    // A game still being played is not "history" yet.
    const { table } = await A.call('createTable', a, { gameId: GAME });
    await A.call('joinTable', b, { code: table.inviteCode }); await A.call('startTable', a, { id: table.id });
    expect((await err(A.call('gameRecord', a, { id: table.id }))).status).toBe(404);
  });
});
