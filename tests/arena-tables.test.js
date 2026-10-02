// Tables: the lobby, seats and observers, quick match, starting, leaving,
// takeovers, chat and the sweep. In memory, instant bots, injected clock.
import { describe, it, expect, vi } from 'vitest';
import { makeArena, guest, member, playToEnd, tick } from './helpers.js';
import { assignSeatColors, COLORS, TABLE_QUESTIONS, colorHex } from '../src/shared/profile.js';
import { TABLE_CAPACITY } from '../src/server/arena/tables.js';

const GAME = 'fourinarow';
const HOUR = 3600000;
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
const drop = (A, id, seat, col) => A.bgio.submit(id, GAME, seat, 'drop', [col]);
/** Play a 2-seat Four in a Row so that `winner` (0 or 1) lines up four in column 0. */
async function winFor(A, id, winner) {
  const moves = winner === 0 ? [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]] : [[0, 1], [1, 0], [0, 1], [1, 0], [0, 2], [1, 0], [0, 2], [1, 0]];
  for (const [seat, col] of moves) expect(await drop(A, id, seat, col), `seat ${seat} col ${col}`).toBe(true);
  await tick(5);
}
async function two(A, opts = {}) {
  const a = await member(A, 'Alice', opts.a); const b = await member(A, 'Bob', opts.b);
  const { table } = await A.call('createTable', a, { gameId: GAME });
  await A.call('joinTable', b, { code: table.inviteCode });
  return { a, b, id: table.id };
}
const setRating = (A, u, rating) => A.c.ratings.put({ id: `${u.id}:${GAME}`, userId: u.id, gameId: GAME, rating, games: 5, wins: 2 });

describe('creating and joining', () => {
  it('a new table: host seated, open, public, normalised settings, an invite code', async () => {
    const A = makeArena();
    const a = await guest(A, 'Ada'); // guests may host one table
    const { table } = await A.call('createTable', a, { gameId: GAME });
    expect(table).toMatchObject({ gameId: GAME, gameName: 'Four in a Row', hostId: a.id, status: 'open', visibility: 'public', mode: 'realtime', people: 1, capacity: 7, maxSeats: 2, minSeats: 2, auto: false });
    expect(TABLE_CAPACITY).toBe(7);
    expect(table.inviteCode).toMatch(/^[0-9a-f]{8}$/);
    expect(table.settings).toEqual({ size: 2, fillBots: true, botLevel: 2 });
    expect(TABLE_QUESTIONS).toContain(table.question);
    expect(table.me).toEqual({ role: 'host', seat: -1 });
    // People outrank robots: while the table is open there is no robot seat, only open ones.
    expect(table.seats.map((s) => s.kind)).toEqual(['human', 'open']);
    expect(table.seats[1].botIfEmpty).toBe(true);
    expect(A.events.some((e) => e.room === 'lobby')).toBe(true);
    expect((await err(A.call('createTable', a, { gameId: 'nope' }))).status).toBe(404);
    expect((await err(A.call('createTable', a, { gameId: '__proto__' }))).status).toBe(404);
    expect((await err(A.call('createTable', a, {}))).status).toBe(404);
  });

  it('join by code or id; joining twice is a no-op; full seats mean you watch', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await guest(A, 'Bob'); const c = await member(A, 'Carol'); const d = await member(A, 'Dan');
    const { table } = await A.call('createTable', a, { gameId: GAME });
    const jb = await A.call('joinTable', b, { code: table.inviteCode.toUpperCase() });
    expect(jb.table.me.role).toBe('player');
    expect(jb.table.people).toBe(2);
    const again = await A.call('joinTable', b, { id: table.id, role: 'observer' });
    expect(again.table.me.role).toBe('player');
    expect(again.table.people).toBe(2);
    const jc = await A.call('joinTable', c, { id: table.id, role: 'player' });
    expect(jc.table.me.role).toBe('observer'); // both seats taken
    const jd = await A.call('joinTable', d, { id: table.id, role: 'observer' });
    expect(jd.table.me.role).toBe('observer');
    expect(jd.table.observers.map((o) => o.id)).toEqual([c.id, d.id]);
    expect(jd.table.seats.map((s) => s.kind)).toEqual(['human', 'human']);
    for (const bad of [{ code: 'deadbeef' }, { id: 'nope' }, {}, { code: {} }, { code: 12345678 }]) expect((await err(A.call('joinTable', d, bad))).status, JSON.stringify(bad)).toBe(404);
  });

  it('choosing to watch leaves the seat for someone else', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol');
    const { table } = await A.call('createTable', a, { gameId: GAME });
    expect((await A.call('joinTable', b, { id: table.id, role: 'observer' })).table.me.role).toBe('observer');
    expect((await A.call('joinTable', c, { id: table.id })).table.me.role).toBe('player');
  });

  it('seven people at a table, players and observers together; the eighth is refused', async () => {
    const A = makeArena();
    const host = await member(A, 'Host');
    const { table } = await A.call('createTable', host, { gameId: GAME });
    for (let i = 0; i < 6; i++) await A.call('joinTable', await guest(A, `G${i}`), { id: table.id });
    const t = A.c.tables.get(table.id);
    expect(t.players).toHaveLength(2);
    expect(t.observers).toHaveLength(5);
    const late = await guest(A, 'Late');
    expect((await err(A.call('joinTable', late, { id: table.id, role: 'observer' }))).message).toMatch(/full \(7 people max\)/);
    expect((await A.call('table', late, { id: table.id })).table.people).toBe(7);
    // Someone leaving makes room again.
    await A.call('leaveTable', A.user(t.observers[0]), { id: table.id });
    expect((await A.call('joinTable', late, { id: table.id })).table.me.role).toBe('observer');
  });

  it('a game in progress can be watched but not joined as a player; a finished one cannot be joined', async () => {
    const A = makeArena();
    const { a, id } = await two(A);
    await A.call('startTable', a, { id });
    const c = await member(A, 'Carol');
    expect((await A.call('joinTable', c, { id, role: 'player' })).table.me.role).toBe('observer');
    await winFor(A, id, 0);
    expect(A.c.tables.get(id).status).toBe('finished');
    expect((await err(A.call('joinTable', await member(A, 'Dan'), { id }))).message).toMatch(/already ended/);
  });
});

describe('roles', () => {
  it('an observer can take a free seat and a player can step back, until the game starts', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol');
    const { table } = await A.call('createTable', a, { gameId: GAME });
    const id = table.id;
    await A.call('joinTable', b, { id }); await A.call('joinTable', c, { id });
    expect((await err(A.call('setRole', c, { id, role: 'player' }))).message).toMatch(/seats are taken/);
    expect((await A.call('setRole', b, { id, role: 'observer' })).table.me.role).toBe('observer');
    expect((await A.call('setRole', c, { id, role: 'player' })).table.me.role).toBe('player');
    const t = A.c.tables.get(id);
    expect(t.players).toEqual([a.id, c.id]);
    expect(t.observers).toEqual([b.id]);
    // Nobody is ever in both lists, and asking for the role you have changes nothing.
    await A.call('setRole', c, { id, role: 'player' }); await A.call('setRole', b, { id, role: 'observer' });
    expect(t.players).toEqual([a.id, c.id]);
    expect(t.observers).toEqual([b.id]);
    expect((await err(A.call('setRole', a, { id, role: 'observer' }))).message).toMatch(/host plays/);
    expect((await err(A.call('setRole', await member(A, 'Dan'), { id, role: 'player' }))).message).toMatch(/not at this table/);
    await A.call('startTable', a, { id });
    expect((await err(A.call('setRole', b, { id, role: 'player' }))).message).toMatch(/locked/);
    expect((await err(A.call('setRole', a, { id: 'nope', role: 'player' }))).status).toBe(404);
  });
});

describe('leaving an open table', () => {
  it('the host leaving passes hosting on; the last person leaving closes the table', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol');
    const { table } = await A.call('createTable', a, { gameId: GAME });
    const id = table.id;
    await A.call('joinTable', b, { id }); await A.call('joinTable', c, { id });
    await A.call('leaveTable', c, { id }); // an observer leaving changes nothing else
    expect(A.c.tables.get(id)).toMatchObject({ hostId: a.id, players: [a.id, b.id], observers: [] });
    await A.call('leaveTable', a, { id });
    expect(A.c.tables.get(id)).toMatchObject({ hostId: b.id, players: [b.id] });
    expect((await A.call('table', b, { id })).table.me.role).toBe('host');
    expect((await err(A.call('startTable', a, { id }))).message).toMatch(/Only the host/);
    A.events.length = 0;
    await A.call('leaveTable', b, { id });
    expect(A.c.tables.get(id)).toBeUndefined();
    expect(A.events).toContainEqual({ room: `t:${id}`, event: 'table', payload: { id, status: 'closed' } });
    // Leaving a table that is gone, or one you are not at, is harmless.
    expect(await A.call('leaveTable', b, { id })).toEqual({ ok: true });
    const other = (await A.call('createTable', a, { gameId: GAME })).table;
    await A.call('leaveTable', c, { id: other.id });
    expect(A.c.tables.get(other.id).players).toEqual([a.id]);
  });

  it('closeMyTables closes what I host and leaves what I joined', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const mine = (await A.call('createTable', a, { gameId: GAME })).table;
    const theirs = (await A.call('createTable', b, { gameId: GAME })).table;
    await A.call('joinTable', a, { id: theirs.id });
    expect((await A.call('closeMyTables', a, { staleOnly: true })).closed).toBe(0); // nothing is two hours old yet
    expect((await A.call('closeMyTables', a, {})).closed).toBe(2);
    expect(A.c.tables.get(mine.id)).toBeUndefined();
    expect(A.c.tables.get(theirs.id).players).toEqual([b.id]);
  });
});

describe('host limits and private tables', () => {
  it('open tables at once: guest 1, Registered 1, Subscriber 3, VIP 10, CEO effectively unlimited', async () => {
    const A = makeArena();
    const limits = [[await guest(A, 'G'), 1], [await member(A, 'Free'), 1], [await member(A, 'Sub', { tier: 'member' }), 3], [await member(A, 'Vip', { tier: 'vip' }), 10], [await member(A, 'Ceo', { tier: 'ceo' }), 25]];
    for (const [u, n] of limits) {
      for (let i = 0; i < n; i++) await A.call('createTable', u, { gameId: GAME });
      if (A.tier(u) === 'ceo') continue;
      const e = await err(A.call('createTable', u, { gameId: GAME }));
      expect(e.status, A.tier(u)).toBe(403);
      expect(e.message).toMatch(new RegExp(`already have ${n} open table`));
      expect((await A.call('lobby', u, {})).hostLimit).toBe(n);
    }
    expect(A.c.tables.size).toBe(1 + 1 + 3 + 10 + 25);
  });

  it('only OPEN tables count: once a game starts the host can open another', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    const { table } = await A.call('createTable', a, { gameId: GAME });
    await A.call('startTable', a, { id: table.id });
    expect((await A.call('createTable', a, { gameId: GAME })).table.status).toBe('open');
  });

  it('a one-click bot game and an accepted challenge do not use up the one open table', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await A.call('playBots', a, { gameId: GAME });
    const { challenge } = await A.call('challenge', a, { userId: b.id, gameId: GAME });
    const { tableId } = await A.call('answerChallenge', b, { id: challenge.id, accept: true });
    expect(A.c.tables.get(tableId)).toMatchObject({ hostId: a.id, status: 'open' });
    // Alice can still host her own table and quick match: basic play is never blocked by a pending challenge.
    expect((await A.call('createTable', a, { gameId: GAME })).table.status).toBe('open');
    expect((await err(A.call('createTable', a, { gameId: GAME }))).status).toBe(403);
  });

  it('private tables are a Subscriber feature, at creation and when switching', async () => {
    const A = makeArena();
    const free = await member(A, 'Free'); const sub = await member(A, 'Sub', { tier: 'member' });
    const e = await err(A.call('createTable', free, { gameId: GAME, visibility: 'private' }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/Subscriber/);
    expect(A.c.tables.size).toBe(0);
    const { table } = await A.call('createTable', free, { gameId: GAME });
    expect((await err(A.call('setTableSettings', free, { id: table.id, settings: {}, visibility: 'private' }))).status).toBe(403);
    expect(A.c.tables.get(table.id).visibility).toBe('public');
    const p = await A.call('createTable', sub, { gameId: GAME, visibility: 'private' });
    expect(p.table.visibility).toBe('private');
    const q = await A.call('createTable', sub, { gameId: GAME });
    expect((await A.call('setTableSettings', sub, { id: q.table.id, settings: {}, visibility: 'private' })).table.visibility).toBe('private');
    expect((await A.call('setTableSettings', sub, { id: q.table.id, settings: {}, visibility: 'public' })).table.visibility).toBe('public');
  });

  it('anything that is not exactly "private" is a public table, not a paywall', async () => {
    const A = makeArena();
    for (const visibility of [null, '', 'PUBLIC', 'secret', 0, {}]) {
      const u = await member(A, `U${Math.random().toString(36).slice(2, 8)}`);
      const r = await A.call('createTable', u, { gameId: GAME, visibility });
      expect(r.table.visibility, JSON.stringify(visibility)).toBe('public');
    }
  });

  it('a private table: outsiders cannot view it, list it, join it by id, or read its chat; the invite code lets them in', async () => {
    const A = makeArena();
    const sub = await member(A, 'Sub', { tier: 'member' }); const out = await member(A, 'Out', { tier: 'ceo' });
    const { table } = await A.call('createTable', sub, { gameId: GAME, visibility: 'private' });
    const id = table.id;
    await A.call('sendChat', sub, { id, body: 'the secret plan' });
    const e = await err(A.call('table', out, { id }));
    expect(e.status).toBe(403);
    expect(e.message).not.toContain(table.inviteCode);
    const lobby = await A.call('lobby', out, {});
    expect(JSON.stringify(lobby)).not.toContain(id);
    expect((await err(A.call('joinTable', out, { id }))).status).toBe(403);
    expect((await err(A.call('joinTable', out, { id, role: 'observer' }))).status).toBe(403);
    expect((await err(A.call('sendChat', out, { id, body: 'hi' }))).status).toBe(403);
    expect(A.c.tables.get(id).observers).toEqual([]);
    const j = await A.call('joinTable', out, { code: table.inviteCode });
    expect(j.table.me.role).toBe('player');
    expect((await A.call('table', out, { id })).chat.map((m) => m.body)).toEqual(['the secret plan']);
    // Once in, the id works (a reload of the table page).
    expect((await A.call('joinTable', out, { id })).table.me.role).toBe('player');
    // Started: still closed to outsiders, including seat access and the debrief.
    await A.call('startTable', sub, { id });
    const third = await member(A, 'Third');
    expect((await err(A.call('seatAccess', third, { id }))).status).toBe(403);
    expect((await err(A.call('table', third, { id }))).status).toBe(403);
    await winFor(A, id, 0);
    expect((await err(A.call('debrief', third, { id }))).status).toBe(403);
    expect((await A.call('debrief', out, { id })).mine.placement).toBe(2);
  });
});

describe('settings', () => {
  it('are normalised: size within the game, bot level 1-3, nothing unknown kept', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    const { table } = await A.call('createTable', a, { gameId: GAME, settings: { size: 99, botLevel: 7, fillBots: false, evil: 'x'.repeat(50), __proto__: { polluted: 1 } } });
    expect(table.settings).toEqual({ size: 2, fillBots: false, botLevel: 2 });
    const id = table.id;
    const set = async (settings) => (await A.call('setTableSettings', a, { id, settings })).table.settings;
    expect(await set({ botLevel: '3' })).toEqual({ size: 2, fillBots: false, botLevel: 3 }); // unsent fields keep their value
    expect(await set({ fillBots: true, size: -4 })).toEqual({ size: 2, fillBots: true, botLevel: 3 });
    expect(await set({ size: 'many', botLevel: 0, fillBots: 'no' })).toEqual({ size: 2, fillBots: true, botLevel: 2 });
    expect(await set(null)).toEqual({ size: 2, fillBots: true, botLevel: 2 });
    expect(await set('junk')).toEqual({ size: 2, fillBots: true, botLevel: 2 });
    expect(await set({ junk: { deep: ['x'] }, constructor: 'c' })).toEqual({ size: 2, fillBots: true, botLevel: 2 });
    expect(({}).polluted).toBeUndefined();
    const big = await err(A.call('setTableSettings', a, { id, settings: { blob: 'x'.repeat(5000) } }));
    expect(big.message).toMatch(/too large/);
    expect(JSON.stringify(A.c.tables.get(id)).length).toBeLessThan(2000);
  });

  it('only the host changes them, and only while the table is open', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    expect((await err(A.call('setTableSettings', b, { id, settings: { botLevel: 1 } }))).status).toBe(403);
    await A.call('startTable', a, { id });
    expect((await err(A.call('setTableSettings', a, { id, settings: { botLevel: 1 } }))).message).toMatch(/locked/);
  });
});

describe('quick match', () => {
  it('brings you back to your own open table for that game', async () => {
    const A = makeArena({ quickMatchBotAfterMs: 20000 });
    const a = await member(A, 'Alice');
    const first = await A.call('quickMatch', a, { gameId: GAME });
    expect(first.table).toMatchObject({ auto: true, status: 'open', hostId: a.id, visibility: 'public' });
    expect(first.table.autoStartAt).toBe(A.now() + 20000);
    const second = await A.call('quickMatch', a, { gameId: GAME });
    expect(second.table.id).toBe(first.table.id);
    expect(A.c.tables.size).toBe(1);
    expect((await err(A.call('quickMatch', a, { gameId: 'nope' }))).status).toBe(404);
  });

  it('seats you at an open public table within 400 rating points, oldest first', async () => {
    const A = makeArena({ quickMatchBotAfterMs: 20000 });
    const far = await member(A, 'Far'); const near = await member(A, 'Near'); const newer = await member(A, 'Newer'); const me = await member(A, 'Me');
    setRating(A, far, 1650); setRating(A, near, 1580); setRating(A, me, 1200);
    const tFar = (await A.call('createTable', far, { gameId: GAME })).table; A.advance(1000);
    const tNear = (await A.call('createTable', near, { gameId: GAME })).table; A.advance(1000);
    await A.call('createTable', newer, { gameId: GAME });
    const r = await A.call('quickMatch', me, { gameId: GAME });
    expect(r.table.id).toBe(tNear.id); // 380 away; the 450-away table is skipped though it is older
    expect(r.table.id).not.toBe(tFar.id);
    expect(r.table.me.role).toBe('player');
    expect(A.c.tables.get(tNear.id).players).toEqual([near.id, me.id]);
    expect(A.c.tables.get(tNear.id).status).toBe('open'); // a hand-made table waits for its host
  });

  it('never seats you at a full, private, started or blocked table', async () => {
    const A = makeArena({ quickMatchBotAfterMs: 20000 });
    const sub = await member(A, 'Sub', { tier: 'member' }); const b = await member(A, 'Bob'); const c = await member(A, 'Carol'); const d = await member(A, 'Dan'); const me = await member(A, 'Me');
    const priv = (await A.call('createTable', sub, { gameId: GAME, visibility: 'private' })).table;
    const full = (await A.call('createTable', b, { gameId: GAME })).table; await A.call('joinTable', c, { id: full.id });
    const blocked = (await A.call('createTable', d, { gameId: GAME })).table;
    await A.call('block', d, { userId: me.id });
    const r = await A.call('quickMatch', me, { gameId: GAME });
    expect([priv.id, full.id, blocked.id]).not.toContain(r.table.id);
    expect(r.table.hostId).toBe(me.id);
  });

  it('two quick matchers meet: the second fills the table and it starts on its own', async () => {
    const A = makeArena({ quickMatchBotAfterMs: 20000 });
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const first = await A.call('quickMatch', a, { gameId: GAME });
    const second = await A.call('quickMatch', b, { gameId: GAME });
    expect(second.table.id).toBe(first.table.id);
    await tick(10);
    const t = A.c.tables.get(first.table.id);
    expect(t.status).toBe('playing');
    expect(t.seats.map((s) => s.userId)).toEqual([a.id, b.id]);
    expect(t.seats.every((s) => !s.bot)).toBe(true);
  });

  it('nobody shows up: after the delay the sweep starts the table with a bot', async () => {
    const A = makeArena({ quickMatchBotAfterMs: 20000 });
    const a = await member(A, 'Alice');
    const { table } = await A.call('quickMatch', a, { gameId: GAME });
    A.advance(19000); await A.sweepTables();
    expect(A.c.tables.get(table.id).status).toBe('open');
    A.advance(1000); await A.sweepTables();
    const t = A.c.tables.get(table.id);
    expect(t.status).toBe('playing');
    expect(t.seats.map((s) => !!s.bot)).toEqual([false, true]);
  });
});

describe('starting', () => {
  it('only the host starts; robots fill only the seats still empty', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    expect((await err(A.call('startTable', b, { id }))).status).toBe(403);
    const c = await member(A, 'Carol'); await A.call('joinTable', c, { id }); // watching
    expect((await err(A.call('startTable', c, { id }))).status).toBe(403);
    const { table } = await A.call('startTable', a, { id });
    expect(table.status).toBe('playing');
    expect(table.seats.map((s) => s.kind)).toEqual(['human', 'human']); // fillBots is on, and no bot took a person's seat
    expect(table.seats.map((s) => s.card.id)).toEqual([a.id, b.id]);
    expect(table.observers.map((o) => o.id)).toEqual([c.id]);
    expect(table.startedAt).toBe(A.now());

    const solo = await member(A, 'Solo');
    const s = (await A.call('createTable', solo, { gameId: GAME })).table;
    const started = (await A.call('startTable', solo, { id: s.id })).table;
    expect(started.seats.map((x) => x.kind)).toEqual(['human', 'bot']);
    expect(started.seats[1]).toMatchObject({ name: 'Robo-Trader', card: null, bot: { level: 2 } });
  });

  it('with bots switched off, a table short of players does not start and stays open', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    const { table } = await A.call('createTable', a, { gameId: GAME, settings: { fillBots: false } });
    const e = await err(A.call('startTable', a, { id: table.id }));
    expect(e.message).toMatch(/needs at least 2 players/);
    expect(A.c.tables.get(table.id).status).toBe('open');
    expect(A.c.tables.get(table.id).seats).toBe(null);
  });

  it('two starts in the same tick create exactly one match', async () => {
    const A = makeArena();
    const { a, id } = await two(A);
    const spy = vi.spyOn(A.bgio, 'createMatch');
    const [r1, r2] = await Promise.all([A.call('startTable', a, { id }), A.call('startTable', a, { id })]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect([r1.table.status, r2.table.status].sort()).toEqual(['playing', 'starting']);
    await A.call('startTable', a, { id }); // and a third, later, is a no-op
    expect(spy).toHaveBeenCalledTimes(1);
    const t = A.c.tables.get(id);
    expect(t.status).toBe('playing');
    expect(t.creds).toHaveLength(2);
    expect(A.store.col('bgio_meta').size).toBe(1);
    expect(A.bgio.state(id)._stateID).toBe(0);
  });

  it('a start that fails puts the table back to open', async () => {
    const A = makeArena();
    const { a, id } = await two(A);
    const spy = vi.spyOn(A.bgio, 'createMatch').mockRejectedValueOnce(new Error('storage down'));
    await expect(A.call('startTable', a, { id })).rejects.toThrow('storage down');
    expect(A.c.tables.get(id).status).toBe('open');
    spy.mockRestore();
    expect((await A.call('startTable', a, { id })).table.status).toBe('playing');
  });

  it('seat colours: first free ranked choice in seat order, then the next palette colour', async () => {
    const A = makeArena();
    const { a, id } = await two(A, { a: { colorRanks: ['teal', 'gold'] }, b: { colorRanks: ['teal', 'plum', 'gold'] } });
    const { table } = await A.call('startTable', a, { id });
    expect(table.seats.map((s) => s.color)).toEqual(['teal', 'plum']);
    expect(table.seats.map((s) => s.hex)).toEqual([colorHex('teal'), colorHex('plum')]);
    // A person with no ranks gets the first palette colour; a bot takes what is left.
    const solo = await member(A, 'Solo', { colorRanks: ['gold'] });
    const s = (await A.call('playBots', solo, { gameId: GAME })).table;
    expect(s.seats.map((x) => x.color)).toEqual(['gold', 'felt']);
    // The ranks themselves are not copied into the table.
    expect(A.c.tables.get(id).seats[0]).not.toHaveProperty('colorRanks');
  });

  it('assignSeatColors: ranked choice by seat order, never a duplicate, junk ignored', () => {
    const pal = COLORS.map((c) => c.id);
    expect(assignSeatColors([{ colorRanks: ['teal'] }, { colorRanks: ['teal'] }, { colorRanks: [] }, {}])).toEqual(['teal', 'gold', 'felt', 'plum']);
    expect(assignSeatColors([{ colorRanks: ['rose', 'ink'] }, { colorRanks: ['rose', 'ink', 'sky'] }, { colorRanks: ['rose', 'ink', 'sky'] }, { colorRanks: ['rose', 'ink', 'sky'] }])).toEqual(['rose', 'ink', 'sky', 'gold']);
    expect(assignSeatColors([{ colorRanks: ['mauve', 'gold'] }, { colorRanks: 'gold' }, { colorRanks: ['gold'] }])).toEqual(['gold', 'felt', 'teal']);
    const seven = assignSeatColors(Array.from({ length: 7 }, () => ({ colorRanks: ['sky', 'gold', 'felt'] })));
    expect(new Set(seven).size).toBe(7);
    for (const c of seven) expect(pal).toContain(c);
  });

  it('one click against a bot: a private solo table that starts at once', async () => {
    const A = makeArena();
    const g = await guest(A, 'Ada');
    const first = (await A.call('playBots', g, { gameId: GAME, level: 3 })).table;
    expect(first).toMatchObject({ status: 'playing', visibility: 'private' });
    expect(first.seats[1].bot.level).toBe(3);
    // A guest may play more than one game.
    const second = (await A.call('playBots', g, { gameId: GAME, level: 9 })).table;
    expect(second.status).toBe('playing');
    expect(second.seats[1].bot.level).toBe(2);
    expect(JSON.stringify(await A.call('lobby', await guest(A), {}))).not.toContain(first.id);
  });

  it('"play a bot" never deletes an accepted challenge that is waiting to start', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const { challenge } = await A.call('challenge', a, { userId: b.id, gameId: GAME });
    const { tableId } = await A.call('answerChallenge', b, { id: challenge.id, accept: true });
    await A.call('playBots', a, { gameId: GAME });
    expect(A.c.tables.get(tableId)).toMatchObject({ status: 'open', players: [a.id, b.id] });
  });
});

describe('leaving a game in progress', () => {
  it('forfeit in a 2-seat game ends it: a loss and a reputation hit for the leaver, a win for the other', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    await A.call('startTable', a, { id });
    await drop(A, id, 0, 3);
    await A.call('leaveTable', b, { id });
    await tick(10);
    const t = A.c.tables.get(id);
    expect(t.status).toBe('finished');
    expect(t.result.reason).toBe('resign');
    expect(t.result.placements).toEqual([1, 2]);
    expect(t.seats[1].takeover).toBe('resigned');
    const rb = A.c.results.get(`${id}:${b.id}`); const ra = A.c.results.get(`${id}:${a.id}`);
    expect(rb).toMatchObject({ placement: 2, won: false, takeover: 'resigned' });
    expect(ra).toMatchObject({ placement: 1, won: true, takeover: null });
    expect(b.reputation).toMatchObject({ score: 90, abandons: 1 }); // -10, and no +2 for finishing
    expect(a.reputation).toMatchObject({ score: 102, abandons: 0 });
    expect(rb.ratingAfter).toBeLessThan(1200);
    expect(ra.ratingAfter).toBeGreaterThan(1200);
    expect(b.stats).toMatchObject({ games: 1, wins: 0 });
    // Leaving twice does not cost twice.
    await A.call('leaveTable', b, { id });
    expect(b.reputation.score).toBe(90);
    expect(A.c.results.count((r) => r.tableId === id)).toBe(2);
  });

  it('an observer leaving a live game costs nothing and changes nothing', async () => {
    const A = makeArena();
    const { a, id } = await two(A);
    const c = await member(A, 'Carol'); await A.call('joinTable', c, { id });
    await A.call('startTable', a, { id });
    await A.call('leaveTable', c, { id });
    expect(c.reputation.score).toBe(100);
    expect(A.c.tables.get(id).status).toBe('playing');
    expect(A.c.tables.get(id).observers).toEqual([]);
  });

  it('idle takeover: after three minutes the sweep hands the stalling seat to a bot', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    await A.call('startTable', a, { id });
    await drop(A, id, 0, 3); // now it is Bob's turn
    A.advance(179000); await A.sweepTables();
    expect(A.c.tables.get(id).status).toBe('playing');
    expect(A.c.tables.get(id).seats[1].takeover).toBeFalsy();
    A.advance(2000); await A.sweepTables(); await tick(10);
    const t = A.c.tables.get(id);
    expect(t.seats[1].takeover).toBe('away');
    expect(t.seats[0].takeover).toBeFalsy(); // Alice was not the one stalling
    expect(b.reputation).toMatchObject({ score: 90, abandons: 1 });
    expect(a.reputation.abandons).toBe(0);
    expect(t.status).toBe('finished');
    const chat = (await A.call('table', a, { id })).chat;
    expect(chat[chat.length - 1]).toMatchObject({ system: true, fromId: 'arena' });
    expect(chat[chat.length - 1].body).toMatch(/Bob has been away/);
  });

  it('a move resets the idle clock; a turn-based table gets a day', async () => {
    const A = makeArena();
    const { a, id } = await two(A);
    await A.call('startTable', a, { id });
    A.advance(170000); await drop(A, id, 0, 3);
    A.advance(170000); await A.sweepTables();
    expect(A.c.tables.get(id).seats[1].takeover).toBeFalsy();

    const c = await member(A, 'Carol'); const d = await member(A, 'Dan');
    const tb = (await A.call('createTable', c, { gameId: GAME, mode: 'turn_based' })).table;
    expect(tb.mode).toBe('turn_based');
    await A.call('joinTable', d, { id: tb.id }); await A.call('startTable', c, { id: tb.id });
    A.advance(23 * HOUR); await A.sweepTables();
    expect(A.c.tables.get(tb.id).seats[0].takeover).toBeFalsy();
    A.advance(HOUR + 1000); await A.sweepTables(); await tick(10);
    expect(A.c.tables.get(tb.id).seats[0].takeover).toBe('away');
  });

  it('a seat a bot took over cannot be driven by the browser that left: its credentials are replaced', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    await A.call('startTable', a, { id });
    const mine = (await A.call('seatAccess', b, { id })).credentials;
    const stored = () => A.store.col('bgio_meta').get(id).metadata.players[1].credentials;
    expect(stored()).toBe(mine);
    await A.call('leaveTable', b, { id });
    expect(stored()).not.toBe(mine);
    expect(A.store.col('bgio_meta').get(id).metadata.players[0].credentials).toBe((await A.call('seatAccess', a, { id })).credentials);
    expect(await A.call('seatAccess', b, { id })).toMatchObject({ playerID: null, credentials: null });
  });
});

describe('seat access', () => {
  it('gives each player their own credentials and observers and strangers none', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    const c = await member(A, 'Carol'); await A.call('joinTable', c, { id });
    const stranger = await guest(A);
    expect((await err(A.call('seatAccess', a, { id }))).message).toMatch(/not started/);
    await A.call('startTable', a, { id });
    const t = A.c.tables.get(id);
    const sa = await A.call('seatAccess', a, { id }); const sb = await A.call('seatAccess', b, { id });
    expect(sa).toEqual({ matchID: id, gameId: GAME, playerID: '0', credentials: t.creds[0] });
    expect(sb).toEqual({ matchID: id, gameId: GAME, playerID: '1', credentials: t.creds[1] });
    expect(sa.credentials).not.toBe(sb.credentials);
    for (const u of [c, stranger]) expect(await A.call('seatAccess', u, { id })).toEqual({ matchID: id, gameId: GAME, playerID: null, credentials: null });
    // Nobody can ask for a seat by number or by someone else's id.
    expect(await A.call('seatAccess', c, { id, seat: 0, playerID: '0', userId: a.id })).toMatchObject({ playerID: null, credentials: null });
    expect((await err(A.call('seatAccess', a, { id: 'nope' }))).status).toBe(404);
  });

  it('no view of a table ever contains a credential', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    const c = await member(A, 'Carol'); await A.call('joinTable', c, { id });
    await A.call('startTable', a, { id });
    const t = A.c.tables.get(id);
    const meta = A.store.col('bgio_meta').get(id).metadata;
    const secrets = [...t.creds, ...Object.values(meta.players).map((p) => p.credentials)];
    const views = [await A.call('table', a, { id }), await A.call('table', c, { id }), await A.call('lobby', b, {}), await A.call('lobby', c, {}), await A.call('joinTable', b, { id })];
    await winFor(A, id, 1);
    views.push(await A.call('debrief', c, { id }), await A.call('table', b, { id }));
    for (const v of views) {
      const text = JSON.stringify(v);
      for (const s of secrets) expect(text).not.toContain(s);
      expect(text).not.toContain('"creds"');
    }
    // A bot seat's credentials are never handed out either.
    const solo = await member(A, 'Solo');
    const s = (await A.call('playBots', solo, { gameId: GAME })).table;
    const st = A.c.tables.get(s.id);
    expect(st.creds).toHaveLength(2);
    expect((await A.call('seatAccess', solo, { id: s.id })).credentials).toBe(st.creds[0]);
    expect(JSON.stringify(s)).not.toContain(st.creds[1]);
  });
});

describe('table chat', () => {
  it('people at the table talk; everyone else is refused', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    const c = await guest(A, 'Carol'); await A.call('joinTable', c, { id }); // watching guests chat too
    const out = await member(A, 'Out');
    A.events.length = 0;
    const m = await A.call('sendChat', a, { id, body: `  hello\u0000 ${'x'.repeat(600)}` });
    expect(m.message).toMatchObject({ fromId: a.id, name: 'Alice', system: false });
    expect(m.message.body).toHaveLength(500);
    expect(m.message.body.startsWith('hello x')).toBe(true);
    expect(A.events.find((e) => e.event === 'chat')).toMatchObject({ room: `t:${id}` });
    await A.call('sendChat', c, { id, body: 'watching' });
    expect(await A.call('sendChat', b, { id, body: '   ' })).toEqual({ ok: false });
    expect((await err(A.call('sendChat', out, { id, body: 'let me in' }))).status).toBe(403);
    expect((await err(A.call('sendChat', a, { id: 'nope', body: 'x' }))).status).toBe(404);
    // The speaker is the session's member, never a field of the request.
    const forged = await A.call('sendChat', b, { id, body: 'as alice?', fromId: a.id, userId: a.id, system: true });
    expect(forged.message).toMatchObject({ fromId: b.id, name: 'Bob', system: false });
    const chat = (await A.call('table', out, { id })).chat; // a public table's chat can be read by anyone who can see the table
    expect(chat.map((x) => x.body.slice(0, 8))).toEqual(['hello xx', 'watching', 'as alice']);
    // After leaving, no more talking.
    await A.call('leaveTable', c, { id });
    expect((await err(A.call('sendChat', c, { id, body: 'still here?' }))).status).toBe(403);
  });

  it('is rate limited to 30 lines a minute per person', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    for (let i = 0; i < 30; i++) await A.call('sendChat', a, { id, body: `line ${i}` });
    expect((await err(A.call('sendChat', a, { id, body: 'one more' }))).status).toBe(429);
    expect((await A.call('sendChat', b, { id, body: 'me too' })).message.body).toBe('me too');
    A.advance(60001);
    expect((await A.call('sendChat', a, { id, body: 'back' })).message.body).toBe('back');
    expect((await A.call('table', a, { id })).chat).toHaveLength(32);
  });

  it('the table view returns the last 100 lines, oldest first', async () => {
    const A = makeArena();
    const { a, id } = await two(A);
    const t = A.c.tables.get(id);
    for (let i = 0; i < 120; i++) { A.advance(10); A.tableSay(t, a.id, `n${i}`); }
    const chat = (await A.call('table', a, { id })).chat;
    expect(chat).toHaveLength(100);
    expect(chat[0].body).toBe('n20');
    expect(chat[99].body).toBe('n119');
  });
});

describe('the sweep', () => {
  it('closes open tables older than two hours', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    const { table } = await A.call('createTable', a, { gameId: GAME });
    A.advance(2 * HOUR - 1000); await A.sweepTables();
    expect(A.c.tables.get(table.id)).toBeTruthy();
    A.events.length = 0;
    A.advance(2000); await A.sweepTables();
    expect(A.c.tables.get(table.id)).toBeUndefined();
    expect(A.events).toContainEqual({ room: `t:${table.id}`, event: 'table', payload: { id: table.id, status: 'closed' } });
    expect((await A.call('createTable', a, { gameId: GAME })).table.status).toBe('open'); // and the host can open another
  });

  it('marks a game nobody has touched for two days as abandoned, without results', async () => {
    const A = makeArena();
    const { a, id } = await two(A);
    await A.call('startTable', a, { id });
    A.advance(48 * HOUR + 1000); await A.sweepTables();
    const t = A.c.tables.get(id);
    expect(t.status).toBe('abandoned');
    expect(t.endedAt).toBe(A.now());
    expect(A.c.results.count((r) => r.tableId === id)).toBe(0);
    expect(a.reputation.score).toBe(100);
  });

  it('a live table whose match state is gone is closed as abandoned rather than left hanging', async () => {
    const A = makeArena();
    const { a, id } = await two(A);
    await A.call('startTable', a, { id });
    await A.bgio.wipe(id);
    A.advance(200000); await A.sweepTables();
    expect(A.c.tables.get(id).status).toBe('abandoned');
  });

  it('one broken table does not stop the sweep for the others', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice', { tier: 'member' }); const b = await member(A, 'Bob');
    const broken = (await A.call('createTable', a, { gameId: GAME, visibility: 'private', settings: { fillBots: false } })).table;
    A.c.tables.get(broken.id).auto = true; A.c.tables.get(broken.id).autoStartAt = A.now();
    const fine = (await A.call('quickMatch', b, { gameId: GAME })).table;
    expect(fine.id).not.toBe(broken.id);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await A.sweepTables();
    spy.mockRestore();
    expect(A.c.tables.get(broken.id).status).toBe('open');
    expect(A.c.tables.get(fine.id).status).toBe('playing');
  });
});

describe('the lobby', () => {
  it('lists open public tables, live ones you can watch, and your own', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol', { tier: 'member' }); const viewer = await guest(A);
    const open = (await A.call('createTable', a, { gameId: GAME })).table;
    const live = (await A.call('createTable', b, { gameId: GAME })).table; await A.call('startTable', b, { id: live.id });
    const priv = (await A.call('createTable', c, { gameId: GAME, visibility: 'private' })).table;
    const l = await A.call('lobby', viewer, {});
    expect(l.open.map((t) => t.id)).toEqual([open.id]);
    expect(l.live.map((t) => t.id)).toEqual([live.id]);
    expect(l.mine).toEqual([]);
    expect(JSON.stringify(l)).not.toContain(priv.id);
    expect(l.open[0]).toMatchObject({ gameName: 'Four in a Row', role: null, people: 1, watching: 0, maxSeats: 2, myTurn: false });
    expect(l.open[0].players).toEqual([{ id: a.id, name: 'Alice', avatar: a.avatar, archetype: null }]);
    expect(l.online).toBe(4);
    expect(l.onlineSample.map((x) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
    const mine = await A.call('lobby', c, {});
    expect(mine.mine.map((t) => t.id)).toEqual([priv.id]);
    expect(mine.mine[0].role).toBe('host');
    expect((await A.call('lobby', b, {})).mine[0].myTurn).toBe(true);
  });

  it('the catalog needs no session and lists every registered game', async () => {
    const A = makeArena();
    const r = await A.call('games', null, {});
    expect(r.games.map((g) => g.id)).toContain(GAME);
    for (const g of r.games) expect(g).toMatchObject({ status: 'live' });
    expect(r.extras.length).toBeGreaterThan(0);
  });
});

describe('a whole game through the table', () => {
  it('think time is measured per human seat and the turn events reach the right people', async () => {
    const A = makeArena();
    const { a, b, id } = await two(A);
    await A.call('startTable', a, { id });
    A.events.length = 0;
    A.advance(4000); await drop(A, id, 0, 3);
    expect(A.events).toContainEqual({ room: `u:${b.id}`, event: 'yourTurn', payload: { tableId: id, gameId: GAME } });
    expect(A.events.some((e) => e.room === `u:${a.id}` && e.event === 'yourTurn')).toBe(false);
    A.advance(9000); await drop(A, id, 1, 3);
    const t = A.c.tables.get(id);
    expect(t.think[0]).toMatchObject({ n: 1, ms: 4000 });
    expect(t.think[1]).toMatchObject({ n: 1, ms: 9000 });
    // A move out of turn is refused and changes nothing.
    expect(await drop(A, id, 1, 3)).toBe(false);
    expect(t.think[1].n).toBe(1);
  });

  it('a bot table plays itself out when the human keeps moving', async () => {
    const A = makeArena();
    const me = await guest(A, 'Ada');
    const { table } = await A.call('playBots', me, { gameId: GAME, level: 1 });
    const t = await playToEnd(A, table.id); await tick(20);
    expect(t.status).toBe('finished');
    expect(t.result.summary).toHaveLength(2);
    expect(t.result.summary[1].bot).toBe(true);
  });
});
