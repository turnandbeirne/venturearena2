// Inviting a connection to a table inside the arena: no email, no text.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member } from './helpers.js';

const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
async function connect(A, a, b) {
  await A.call('connect', a, { userId: b.id });
  await A.call('answerConnection', b, { userId: a.id, accept: true });
}

describe('table invitations', () => {
  it('a connection is invited, sees it in their Inbox, and joining seats them at the table', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await connect(A, a, b);
    const { table } = await A.call('createTable', a, { gameId: 'chess' });
    const list = await A.call('tableInvitables', a, { id: table.id });
    expect(list.people).toHaveLength(1);
    expect(list.people[0]).toMatchObject({ here: false, invited: false });
    expect(list.people[0].card.displayName).toBe('Bob');

    A.events.length = 0;
    expect(await A.call('inviteToTable', a, { id: table.id, userId: b.id })).toEqual({ ok: true });
    const note = A.events.find((e) => e.event === 'inbox' && e.room === `u:${b.id}`);
    expect(note.payload).toMatchObject({ kind: 'tableInvite', tableId: table.id, from: 'Alice', gameName: 'Chess' });
    expect((await A.call('tableInvitables', a, { id: table.id })).people[0].invited).toBe(true);

    const box = await A.call('inbox', b, {});
    expect(box.tableInvites).toHaveLength(1);
    expect(box.tableInvites[0]).toMatchObject({ tableId: table.id, gameName: 'Chess', started: false, seatFree: true });
    expect(box.tableInvites[0].from.displayName).toBe('Alice');

    const joined = await A.call('answerTableInvite', b, { tableId: table.id, accept: true });
    expect(joined.seated).toBe(true);
    expect(A.c.tables.get(table.id).players).toEqual([a.id, b.id]);
    expect((await A.call('inbox', b, {})).tableInvites).toEqual([]);
    expect((await A.call('tableInvitables', a, { id: table.id })).people[0]).toMatchObject({ here: true, invited: false });
  });

  it('gets a connection into a PRIVATE table without the link', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice', { tier: 'member' }); const b = await member(A, 'Bob');
    await connect(A, a, b);
    const { table } = await A.call('createTable', a, { gameId: 'chess', visibility: 'private' });
    expect(A.c.tables.get(table.id).visibility).toBe('private');
    expect((await err(A.call('joinTable', b, { id: table.id }))).status).toBe(403); // not without an invitation
    await A.call('inviteToTable', a, { id: table.id, userId: b.id });
    await A.call('answerTableInvite', b, { tableId: table.id, accept: true });
    expect(A.c.tables.get(table.id).players).toContain(b.id);
  });

  it('only reaches people you are connected to, and never a stranger, a blocked member or yourself', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Cyd'); const g = await guest(A, 'Guest');
    const { table } = await A.call('createTable', a, { gameId: 'chess' });
    expect((await err(A.call('inviteToTable', a, { id: table.id, userId: b.id }))).status).toBe(403); // not connected
    expect((await err(A.call('inviteToTable', a, { id: table.id, userId: a.id }))).message).toMatch(/already here/);
    await connect(A, a, b);
    // Someone who is not at the table cannot invite people to it, or see who could be invited.
    expect((await err(A.call('inviteToTable', c, { id: table.id, userId: b.id }))).status).toBe(403);
    expect(await A.call('tableInvitables', c, { id: table.id })).toEqual({ people: [], guest: false, gone: true }); // and learns nothing about who could be
    // A guest has no connections to invite.
    const gt = (await A.call('createTable', g, { gameId: 'chess' })).table;
    expect((await err(A.call('inviteToTable', g, { id: gt.id, userId: b.id }))).status).toBe(403);
    // Blocked: the invitation is refused and nothing reaches them.
    await A.call('block', b, { userId: a.id });
    A.events.length = 0;
    expect((await err(A.call('inviteToTable', a, { id: table.id, userId: b.id }))).status).toBe(403);
    expect(A.events.filter((e) => e.room === `u:${b.id}`)).toEqual([]);
    expect((await A.call('tableInvitables', a, { id: table.id })).people).toEqual([]);
  });

  it('an adult and an under-18 who have not finished a game together cannot be invited to each other\'s tables', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const t = await member(A, 'Teen');
    await connect(A, a, t);
    const teen = A.user(t.id); teen.adultAt = A.now() + 2 * 365 * 86400000; A.c.users.put(teen);
    const { table } = await A.call('createTable', a, { gameId: 'chess' });
    expect((await A.call('tableInvitables', a, { id: table.id })).people).toEqual([]);
    expect((await err(A.call('inviteToTable', a, { id: table.id, userId: t.id }))).status).toBe(403);
  });

  it('asking twice does not notify twice; a pass is final for that table; a closed table drops out of the Inbox', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Cyd');
    await connect(A, a, b); await connect(A, a, c);
    const { table } = await A.call('createTable', a, { gameId: 'chess' });
    await A.call('inviteToTable', a, { id: table.id, userId: b.id });
    A.events.length = 0;
    expect(await A.call('inviteToTable', a, { id: table.id, userId: b.id })).toEqual({ ok: true, already: true });
    expect(A.events.filter((e) => e.room === `u:${b.id}`)).toEqual([]);

    expect(await A.call('answerTableInvite', b, { tableId: table.id, accept: false })).toEqual({ ok: true });
    expect((await A.call('inbox', b, {})).tableInvites).toEqual([]);
    expect((await err(A.call('inviteToTable', a, { id: table.id, userId: b.id }))).message).toMatch(/passed on this table/);
    expect((await err(A.call('answerTableInvite', b, { tableId: table.id, accept: true }))).status).toBe(404);

    await A.call('inviteToTable', a, { id: table.id, userId: c.id });
    expect((await A.call('inbox', c, {})).tableInvites).toHaveLength(1);
    await A.call('leaveTable', a, { id: table.id }); // the host leaves an empty table: it closes
    expect((await A.call('inbox', c, {})).tableInvites).toEqual([]);
  });

  it('an invitation to a game already under way is a place to watch', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await connect(A, a, b);
    const { table } = await A.call('playBots', a, { gameId: 'chess' });
    expect(A.c.tables.get(table.id).status).toBe('playing');
    await A.call('inviteToTable', a, { id: table.id, userId: b.id });
    expect((await A.call('inbox', b, {})).tableInvites[0]).toMatchObject({ started: true, seatFree: false });
    const r = await A.call('answerTableInvite', b, { tableId: table.id, accept: true });
    expect(r.seated).toBe(false);
    expect(A.c.tables.get(table.id).observers).toContain(b.id);
  });
});

describe('table invitations: a table that has gone', () => {
  it('asking who could be invited to a closed table is an empty list, not an error', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    expect(await A.call('tableInvitables', a, { id: 'no-such-table' })).toEqual({ people: [], guest: false, gone: true });
  });
});
