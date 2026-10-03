// People: connections, direct messages, introductions, challenges, invites,
// presence and tablemates.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member, tick } from './helpers.js';

const GAME = 'fourinarow';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const READY = { colorRanks: ['teal'], archetype: 'builder', headline: 'I build tools', stage: 'revenue', industry: 'SaaS', intent: ['peers'], goals: 'Reach 100 customers', currentProject: 'A billing tool', onboardedAt: 1 };
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
const drop = (A, id, seat, col) => A.bgio.submit(id, GAME, seat, 'drop', [col]);
async function playOut(A, a, b) {
  const { table } = await A.call('createTable', a, { gameId: GAME });
  await A.call('joinTable', b, { id: table.id }); await A.call('startTable', a, { id: table.id });
  for (const [seat, col] of [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]]) await drop(A, table.id, seat, col);
  await tick(5);
  return table.id;
}
/** Give `u` n accepted connections without creating n accounts. */
function fill(A, u, n) {
  for (let i = 0; i < n; i++) { const other = `filler-${u.id}-${i}`; A.c.connections.put({ id: [u.id, other].sort().join(':'), requesterId: other, addresseeId: u.id, status: 'accepted', at: A.now() }); }
}

describe('connections', () => {
  it('request, see it in the inbox, accept: both sides are connected', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    A.events.length = 0;
    expect(await A.call('connect', a, { userId: b.id, source: 'profile' })).toEqual({ state: 'requested' });
    expect(A.events).toContainEqual({ room: `u:${b.id}`, event: 'inbox', payload: { kind: 'connection' } });
    expect(A.connectionState(b, a)).toBe('incoming');
    expect(A.areConnected(a.id, b.id)).toBe(false);
    const inbox = await A.call('inbox', b);
    expect(inbox.requests).toHaveLength(1);
    expect(inbox.requests[0]).toMatchObject({ source: 'profile', from: { id: a.id } });
    expect((await A.call('inbox', a)).requests).toEqual([]); // the sender does not see their own request as incoming
    // Asking twice does not create a second request.
    await A.call('connect', a, { userId: b.id });
    expect(A.c.connections.size).toBe(1);
    await A.call('answerConnection', b, { userId: a.id, accept: true });
    expect(A.connectionState(a, b)).toBe('connected');
    expect(A.connectionState(b, a)).toBe('connected');
    expect((await A.call('inbox', a)).connections.map((c) => c.card.id)).toEqual([b.id]);
    expect((await A.call('inbox', b)).requests).toEqual([]);
    expect((await A.call('profile', a, { id: b.id })).connection).toBe('connected');
  });

  it('only the person who was asked can answer', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol');
    await A.call('connect', a, { userId: b.id });
    expect((await err(A.call('answerConnection', a, { userId: b.id, accept: true }))).message).toMatch(/No pending request/); // cannot accept your own request
    expect((await err(A.call('answerConnection', c, { userId: a.id, accept: true }))).message).toMatch(/No pending request/);
    expect((await err(A.call('answerConnection', c, { userId: b.id, accept: true }))).message).toMatch(/No pending request/);
    expect((await err(A.call('answerConnection', b, { userId: c.id, accept: true }))).message).toMatch(/No pending request/);
    expect((await err(A.call('answerConnection', b, {}))).message).toMatch(/No pending request/);
    expect(A.connectionState(a, b)).toBe('requested');
    await A.call('answerConnection', b, { userId: a.id, accept: true });
    expect((await err(A.call('answerConnection', b, { userId: a.id, accept: false }))).message).toMatch(/No pending request/); // already answered
    expect(A.connectionState(a, b)).toBe('connected');
  });

  it('declining deletes the request; it does NOT block the requester', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await A.call('connect', a, { userId: b.id });
    await A.call('answerConnection', b, { userId: a.id, accept: false });
    expect(A.c.connections.size).toBe(0);
    expect(A.connectionState(a, b)).toBe('none');
    expect(A.areBlocked(a.id, b.id)).toBe(false);
    // Life goes on: challenges and a new request still work.
    expect((await A.call('challenge', a, { userId: b.id, gameId: GAME })).challenge.status).toBe('pending');
    expect(await A.call('connect', a, { userId: b.id })).toEqual({ state: 'requested' });
  });

  it('asking someone who already asked you is a yes', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await A.call('connect', a, { userId: b.id });
    expect(await A.call('connect', b, { userId: a.id })).toEqual({ state: 'connected' });
    expect(A.c.connections.size).toBe(1);
    expect(A.areConnected(a.id, b.id)).toBe(true);
  });

  it('guests cannot connect; nobody connects with themselves, a bot or a stranger id', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const g = await guest(A, 'Gus');
    const e = await err(A.call('connect', g, { userId: a.id }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/free account/);
    expect((await err(A.call('connect', a, { userId: a.id }))).message).toMatch(/That is you/);
    expect((await err(A.call('connect', a, { userId: 'arena' }))).message).toMatch(/Bots/);
    expect((await err(A.call('connect', a, { userId: 'nope' }))).status).toBe(404);
    expect((await err(A.call('connect', a, {}))).status).toBe(404);
    expect(A.c.connections.size).toBe(0);
  });

  it('a guest can be asked, and answers once they have an account', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const g = await guest(A, 'Gus');
    await A.call('connect', a, { userId: g.id });
    const e = await err(A.call('answerConnection', g, { userId: a.id, accept: true }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/free account/);
    expect(A.areConnected(a.id, g.id)).toBe(false);
    await A.call('answerConnection', g, { userId: a.id, accept: false }); // a guest may still say no
    await A.call('connect', a, { userId: g.id });
    await A.call('register', g, { birthDate: '1990-01-01', email: 'gus@example.com', password: 'correct horse', displayName: 'Gus' }, { ip: 'x' });
    await A.call('answerConnection', g, { userId: a.id, accept: true });
    expect(A.areConnected(a.id, g.id)).toBe(true);
  });

  it('Registered members hold 25 connections; Subscribers have no limit', async () => {
    const A = makeArena();
    const free = await member(A, 'Free'); const sub = await member(A, 'Sub', { tier: 'member' }); const x = await member(A, 'Xavier'); const y = await member(A, 'Yara');
    fill(A, free, 24);
    expect(await A.call('connect', free, { userId: x.id })).toEqual({ state: 'requested' });
    await A.call('answerConnection', x, { userId: free.id, accept: true }); // 25
    const e = await err(A.call('connect', free, { userId: y.id }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/25 connections/);
    // The limit is on what you HOLD, so it also applies to accepting, either way round.
    await A.call('connect', y, { userId: free.id });
    expect((await err(A.call('answerConnection', free, { userId: y.id, accept: true }))).status).toBe(403);
    expect((await err(A.call('connect', free, { userId: y.id }))).status).toBe(403); // "asking back" is an accept too
    expect(A.areConnected(free.id, y.id)).toBe(false);
    expect(A.connectionState(free, y)).toBe('incoming'); // the request is still there for when there is room
    await A.call('answerConnection', free, { userId: y.id, accept: false }); // declining is always possible
    // Pending requests do not count against the limit.
    fill(A, sub, 40);
    expect(await A.call('connect', sub, { userId: y.id })).toEqual({ state: 'requested' });
    await A.call('connect', x, { userId: sub.id });
    await A.call('answerConnection', sub, { userId: x.id, accept: true });
    expect(A.areConnected(sub.id, x.id)).toBe(true);
  });

  it('blocking is deliberate, works both ways, and replaces a connection', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice', { tier: 'ceo' }); const b = await member(A, 'Bob', { tier: 'ceo' });
    await A.call('connect', a, { userId: b.id }); await A.call('answerConnection', b, { userId: a.id, accept: true });
    expect(await A.call('block', b, { userId: a.id })).toEqual({ ok: true });
    expect(A.areBlocked(a.id, b.id)).toBe(true);
    expect(A.areBlocked(b.id, a.id)).toBe(true);
    expect(A.areConnected(a.id, b.id)).toBe(false);
    expect(A.connectionState(a, b)).toBe('blocked');
    for (const [x, y] of [[a, b], [b, a]]) {
      expect((await err(A.call('connect', x, { userId: y.id }))).message).toMatch(/cannot connect/);
      expect((await err(A.call('sendMessage', x, { toId: y.id, body: 'hi' }))).status).toBe(403);
      expect((await err(A.call('challenge', x, { userId: y.id, gameId: GAME }))).message).toMatch(/cannot challenge/);
      expect((await err(A.call('requestIntro', x, { userId: y.id, kind: 'cofounder' }))).status).toBeGreaterThanOrEqual(400);
    }
    expect((await A.call('inbox', a)).connections).toEqual([]);
    expect((await err(A.call('block', a, { userId: 'nope' }))).status).toBe(404);
    expect((await err(A.call('block', a, { userId: a.id }))).message).toMatch(/That is you/);
    // Guests can protect themselves too.
    const g = await guest(A);
    await A.call('block', g, { userId: a.id });
    expect((await err(A.call('challenge', a, { userId: g.id, gameId: GAME }))).message).toMatch(/cannot challenge/);
  });
});

describe('direct messages', () => {
  it('connections can message each other; strangers cannot unless the sender is a Subscriber', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const sub = await member(A, 'Sub', { tier: 'member' });
    const e = await err(A.call('sendMessage', a, { toId: b.id, body: 'hello stranger' }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/Subscriber/);
    expect(A.canMessage(a, b)).toBe(false);
    await A.call('connect', a, { userId: b.id });
    expect(A.canMessage(a, b)).toBe(false); // a pending request is not a connection
    await A.call('answerConnection', b, { userId: a.id, accept: true });
    A.events.length = 0;
    const m = await A.call('sendMessage', a, { toId: b.id, body: '  hello Bob  ' });
    expect(m.message).toMatchObject({ fromId: a.id, toId: b.id, body: 'hello Bob' });
    expect(A.events).toContainEqual({ room: `u:${b.id}`, event: 'inbox', payload: { kind: 'message', fromId: a.id } });
    A.advance(1000);
    expect((await A.call('sendMessage', b, { toId: a.id, body: 'hi Alice' })).message.body).toBe('hi Alice');
    // A Subscriber can write to anyone; the free member can read it but not reply.
    expect((await A.call('sendMessage', sub, { toId: a.id, body: 'I liked your game' })).message.body).toBe('I liked your game');
    expect((await A.call('profile', sub, { id: a.id })).canMessage).toBe(true);
    expect((await A.call('thread', a, { userId: sub.id })).canMessage).toBe(false);
    expect((await err(A.call('sendMessage', a, { toId: sub.id, body: 'thanks' }))).status).toBe(403);
    const inbox = await A.call('inbox', a);
    expect(inbox.others.map((o) => [o.card.id, o.last.body])).toEqual([[sub.id, 'I liked your game']]);
    expect(inbox.connections.map((c) => [c.card.id, c.last.body])).toEqual([[b.id, 'hi Alice']]);
  });

  it('never to a bot, never from a guest, never across a block, even for a Subscriber', async () => {
    const A = makeArena();
    const sub = await member(A, 'Sub', { tier: 'ceo' }); const b = await member(A, 'Bob'); const g = await guest(A, 'Gus');
    expect((await err(A.call('sendMessage', sub, { toId: 'arena', body: 'hi' }))).status).toBe(403);
    expect((await err(A.call('sendMessage', g, { toId: b.id, body: 'hi' }))).status).toBe(403);
    expect((await err(A.call('sendMessage', sub, { toId: 'nope', body: 'hi' }))).status).toBe(404);
    await A.call('sendMessage', sub, { toId: b.id, body: 'one' });
    await A.call('block', b, { userId: sub.id });
    expect((await err(A.call('sendMessage', sub, { toId: b.id, body: 'two' }))).status).toBe(403);
    expect(A.c.messages.count((m) => m.toId === b.id && m.fromId === sub.id)).toBe(1);
    // The speaker is the session's member, never a field of the request.
    const c = await member(A, 'Carol');
    const m = await A.call('sendMessage', sub, { toId: c.id, body: 'x', fromId: 'arena', id: 'chosen', at: 1 });
    expect(m.message.fromId).toBe(sub.id);
    expect(m.message.id).not.toBe('chosen');
    expect((await A.call('inbox', c)).notes).toEqual([]);
  });

  it('needs a body, caps it at 2000 characters, and is rate limited', async () => {
    const A = makeArena();
    const sub = await member(A, 'Sub', { tier: 'member' }); const b = await member(A, 'Bob');
    expect((await err(A.call('sendMessage', sub, { toId: b.id, body: '   ' }))).message).toMatch(/Write something/);
    expect((await err(A.call('sendMessage', sub, { toId: b.id }))).message).toMatch(/Write something/);
    expect((await A.call('sendMessage', sub, { toId: b.id, body: 'y'.repeat(5000) })).message.body).toHaveLength(2000);
    for (let i = 0; i < 39; i++) await A.call('sendMessage', sub, { toId: b.id, body: `m${i}` });
    expect((await err(A.call('sendMessage', sub, { toId: b.id, body: 'too many' }))).status).toBe(429);
    A.advance(60001);
    expect((await A.call('sendMessage', sub, { toId: b.id, body: 'again' })).message.body).toBe('again');
  });

  it('a thread holds only the two people in it, oldest first, and no table chat', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice', { tier: 'member' }); const b = await member(A, 'Bob', { tier: 'member' }); const c = await member(A, 'Carol', { tier: 'member' });
    await A.call('sendMessage', a, { toId: b.id, body: 'a to b' }); A.advance(1000);
    await A.call('sendMessage', b, { toId: a.id, body: 'b to a' }); A.advance(1000);
    await A.call('sendMessage', a, { toId: c.id, body: 'a to c' });
    const { table } = await A.call('createTable', a, { gameId: GAME });
    await A.call('sendChat', a, { id: table.id, body: 'table talk' });
    const ab = await A.call('thread', a, { userId: b.id });
    expect(ab.messages.map((m) => m.body)).toEqual(['a to b', 'b to a']);
    expect(ab.with.id).toBe(b.id);
    expect((await A.call('thread', b, { userId: a.id })).messages.map((m) => m.body)).toEqual(['a to b', 'b to a']);
    // Carol cannot read Alice and Bob's thread through any argument.
    const cb = await A.call('thread', c, { userId: b.id, fromId: a.id, toId: b.id, me: a.id });
    expect(cb.messages).toEqual([]);
    expect((await A.call('thread', c, { userId: a.id })).messages.map((m) => m.body)).toEqual(['a to c']);
    expect(JSON.stringify(await A.call('inbox', c))).not.toContain('a to b');
    expect((await err(A.call('thread', c, { userId: 'nope' }))).status).toBe(404);
  });

  it('notes from the arena arrive in the inbox, newest first, and only for the member they are for', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    A.notify(a.id, 'first'); A.advance(1000); A.notify(a.id, 'second'); A.notify(b.id, 'for bob');
    expect((await A.call('inbox', a)).notes.map((n) => n.body)).toEqual(['second', 'first']);
    expect((await A.call('inbox', b)).notes.map((n) => n.body)).toEqual(['for bob']);
    expect(A.events.filter((e) => e.room === `u:${a.id}` && e.payload.kind === 'note')).toHaveLength(2);
  });
});

describe('introductions', () => {
  async function cast(A) {
    const sub = await member(A, 'Sub', { ...READY, tier: 'member', intent: ['mentor', 'cofounder'] });
    const mentor = await member(A, 'Mentor', { ...READY, stage: 'exited', offers: ['mentoring'], openToMentoring: 1 });
    const co = await member(A, 'Co', { ...READY, archetype: 'trader', intent: ['cofounder'] });
    return { sub, mentor, co };
  }

  it('need an account, a verified email and a 70% profile', async () => {
    const A = makeArena();
    const { mentor } = await cast(A);
    const g = await guest(A);
    expect((await err(A.call('requestIntro', g, { userId: mentor.id, kind: 'mentor' }))).status).toBe(403);
    const thin = await member(A, 'Thin', { tier: 'ceo' });
    const e = await err(A.call('requestIntro', thin, { userId: mentor.id, kind: 'mentor' }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/complete your profile/);
    const unverified = await member(A, 'Unv', { ...READY, tier: 'ceo', emailVerified: false });
    expect((await err(A.call('requestIntro', unverified, { userId: mentor.id, kind: 'mentor' }))).status).toBe(403);
    expect((await err(A.call('requestIntro', mentor, { userId: mentor.id, kind: 'mentor' }))).message).toMatch(/That is you/);
    expect((await err(A.call('requestIntro', mentor, { userId: 'nope', kind: 'mentor' }))).status).toBe(404);
    expect(A.c.introductions.size).toBe(0);
  });

  it('mentor and cofounder introductions are a Subscriber feature; investor introductions a VIP one', async () => {
    const A = makeArena();
    const { mentor, co } = await cast(A);
    const investor = await member(A, 'Inv', { ...READY, offers: ['investing'] });
    const free = await member(A, 'Free', { ...READY, intent: ['mentor', 'cofounder', 'investor'] });
    for (const [kind, to, word] of [['mentor', mentor, /Subscriber/], ['cofounder', co, /Subscriber/], ['investor', investor, /VIP/]]) {
      const e = await err(A.call('requestIntro', free, { userId: to.id, kind }));
      expect(e.status, kind).toBe(403);
      expect(e.message).toMatch(word);
    }
    free.tier = 'member';
    expect((await A.call('requestIntro', free, { userId: mentor.id, kind: 'mentor', reason: 'r' })).intro).toMatchObject({ kind: 'mentor', status: 'pending', fromId: free.id, toId: mentor.id });
    expect((await A.call('requestIntro', free, { userId: co.id, kind: 'cofounder' })).intro.kind).toBe('cofounder');
    expect((await err(A.call('requestIntro', free, { userId: investor.id, kind: 'investor' }))).status).toBe(403);
    free.tier = 'vip';
    expect((await A.call('requestIntro', free, { userId: investor.id, kind: 'investor' })).intro.kind).toBe('investor');
  });

  it('nobody is introduced into something they did not opt into', async () => {
    const A = makeArena();
    const vip = await member(A, 'Vip', { ...READY, tier: 'vip', intent: ['mentor', 'cofounder', 'investor'] });
    const plain = await member(A, 'Plain', READY); // offers nothing, looking only for peers
    expect((await err(A.call('requestIntro', vip, { userId: plain.id, kind: 'mentor' }))).message).toMatch(/not taking new people/);
    expect((await err(A.call('requestIntro', vip, { userId: plain.id, kind: 'cofounder' }))).message).toMatch(/not looking for a cofounder/);
    expect((await err(A.call('requestIntro', vip, { userId: plain.id, kind: 'investor' }))).message).toMatch(/opted in/);
    // A mentor who says yes to mentoring but takes nobody (capacity 0) is not asked either.
    const closed = await member(A, 'Closed', { ...READY, offers: ['mentoring'], openToMentoring: 0 });
    expect((await err(A.call('requestIntro', vip, { userId: closed.id, kind: 'mentor' }))).message).toMatch(/not taking new people/);
    expect(A.c.introductions.size).toBe(0);
    // The protected direction for capital: the backer sees the founder and asks.
    const backer = await member(A, 'Backer', { ...READY, tier: 'vip', offers: ['investing'] });
    const founder = await member(A, 'Founder', { ...READY, intent: ['investor'] });
    expect((await A.call('requestIntro', backer, { userId: founder.id, kind: 'investor' })).intro.status).toBe('pending');
    expect((await err(A.call('requestIntro', backer, { userId: plain.id, kind: 'investor' }))).message).toMatch(/opted in/);
    const incubator = await member(A, 'Incubator', { ...READY, tier: 'vip', offers: ['incubating'] });
    const early = await member(A, 'Early', { ...READY, stage: 'idea', intent: ['mentor'] });
    expect((await A.call('requestIntro', incubator, { userId: early.id, kind: 'investor' })).intro.status).toBe('pending');
  });

  it('an introduction cannot be used as a way to message any stranger', async () => {
    const A = makeArena();
    const free = await member(A, 'Free', READY); const target = await member(A, 'Target', READY);
    // "opportunity" introductions exist only as a response to a post on the board.
    const e = await err(A.call('requestIntro', free, { userId: target.id, kind: 'opportunity', reason: 'buy my course' }));
    expect(e.status).toBe(403);
    expect((await err(A.call('requestIntro', free, { userId: target.id, kind: 'made-up', reason: 'buy my course' }))).status).toBe(403);
    expect((await err(A.call('requestIntro', free, { userId: target.id, reason: 'buy my course' }))).status).toBe(403);
    expect(A.c.introductions.size).toBe(0);
    expect((await A.call('inbox', target)).introsIn).toEqual([]);
  });

  it('a mentor takes as many people a quarter as they said, and no more', async () => {
    const A = makeArena();
    const { sub, mentor } = await cast(A);
    const s2 = await member(A, 'Sub2', { ...READY, tier: 'member' }); const s3 = await member(A, 'Sub3', { ...READY, tier: 'member' });
    const i1 = (await A.call('requestIntro', sub, { userId: mentor.id, kind: 'mentor', reason: 'x'.repeat(500) })).intro;
    expect(i1.reason).toHaveLength(300);
    // Pending requests do not use up capacity: a second person can still ask.
    const i2 = (await A.call('requestIntro', s2, { userId: mentor.id, kind: 'mentor' })).intro;
    await A.call('answerIntro', mentor, { id: i1.id, accept: true });
    const e = await err(A.call('requestIntro', s3, { userId: mentor.id, kind: 'mentor' }));
    expect(e.message).toMatch(/not taking new people/);
    await A.call('answerIntro', mentor, { id: i2.id, accept: false });
    // Raising the number opens a place; so does a new quarter.
    mentor.openToMentoring = 2;
    expect((await A.call('requestIntro', s3, { userId: mentor.id, kind: 'mentor' })).intro.status).toBe('pending');
    mentor.openToMentoring = 1;
    const s4 = await member(A, 'Sub4', { ...READY, tier: 'member' });
    expect((await err(A.call('requestIntro', s4, { userId: mentor.id, kind: 'mentor' }))).message).toMatch(/not taking/);
    A.advance(91 * DAY);
    expect((await A.call('requestIntro', s4, { userId: mentor.id, kind: 'mentor' })).intro.status).toBe('pending');
  });

  it('accepting connects the two and tells the asker; declining does neither', async () => {
    const A = makeArena();
    const { sub, mentor, co } = await cast(A);
    const im = (await A.call('requestIntro', sub, { userId: mentor.id, kind: 'mentor', reason: 'Pricing help' })).intro;
    const ic = (await A.call('requestIntro', sub, { userId: co.id, kind: 'cofounder' })).intro;
    expect((await A.call('inbox', mentor)).introsIn).toHaveLength(1);
    expect((await A.call('inbox', mentor)).introsIn[0]).toMatchObject({ id: im.id, kind: 'mentor', reason: 'Pricing help', status: 'pending', from: { id: sub.id }, to: { id: mentor.id } });
    expect((await A.call('inbox', sub)).introsOut.map((i) => i.id).sort()).toEqual([im.id, ic.id].sort());
    // Only the person asked can answer.
    expect((await err(A.call('answerIntro', sub, { id: im.id, accept: true }))).message).toMatch(/already answered/);
    expect((await err(A.call('answerIntro', co, { id: im.id, accept: true }))).message).toMatch(/already answered/);
    expect((await err(A.call('answerIntro', mentor, { id: 'nope', accept: true }))).message).toMatch(/already answered/);
    expect(A.areConnected(sub.id, mentor.id)).toBe(false);

    await A.call('answerIntro', mentor, { id: im.id, accept: true });
    expect(A.areConnected(sub.id, mentor.id)).toBe(true);
    expect(A.c.connections.get([sub.id, mentor.id].sort().join(':'))).toMatchObject({ source: 'intro:mentor', status: 'accepted' });
    expect((await A.call('inbox', sub)).notes[0].body).toMatch(/Mentor accepted your mentor introduction/);
    expect(A.canMessage(mentor, sub)).toBe(true);
    expect((await err(A.call('answerIntro', mentor, { id: im.id, accept: false }))).message).toMatch(/already answered/);

    await A.call('answerIntro', co, { id: ic.id, accept: false });
    expect(A.areConnected(sub.id, co.id)).toBe(false);
    expect(A.connectionState(sub, co)).toBe('none'); // a decline is just a decline
    expect(A.c.introductions.get(ic.id).status).toBe('declined');
    expect((await A.call('inbox', sub)).notes).toHaveLength(1);
    expect((await A.call('inbox', co)).introsIn).toEqual([]);
  });

  it('asking the same person twice is one request; ten new requests a day at most', async () => {
    const A = makeArena();
    const { sub, co } = await cast(A);
    const a = (await A.call('requestIntro', sub, { userId: co.id, kind: 'cofounder' })).intro;
    const b = (await A.call('requestIntro', sub, { userId: co.id, kind: 'cofounder' })).intro;
    expect(b.id).toBe(a.id);
    expect(A.c.introductions.size).toBe(1);
    for (let i = 0; i < 9; i++) { const u = await member(A, `C${i}`, { ...READY, intent: ['cofounder'] }); await A.call('requestIntro', sub, { userId: u.id, kind: 'cofounder' }); }
    const extra = await member(A, 'Extra', { ...READY, intent: ['cofounder'] });
    expect((await err(A.call('requestIntro', sub, { userId: extra.id, kind: 'cofounder' }))).status).toBe(429);
    A.advance(DAY + 1);
    expect((await A.call('requestIntro', sub, { userId: extra.id, kind: 'cofounder' })).intro.status).toBe('pending');
  });

  it('an introduction is not a way round a block', async () => {
    const A = makeArena();
    const { sub, co } = await cast(A);
    const i = (await A.call('requestIntro', sub, { userId: co.id, kind: 'cofounder' })).intro;
    await A.call('block', sub, { userId: co.id }); // second thoughts
    expect((await err(A.call('answerIntro', co, { id: i.id, accept: true }))).message).toMatch(/cannot connect/);
    expect(A.areBlocked(sub.id, co.id)).toBe(true);
    expect(A.areConnected(sub.id, co.id)).toBe(false);
  });
});

describe('challenges', () => {
  it('a guest sends 3 in any 24 hours, a Registered member 10, a Subscriber as many as they like', async () => {
    const A = makeArena();
    const target = await member(A, 'Target');
    const cases = [[await guest(A, 'Gus'), 3], [await member(A, 'Free'), 10]];
    for (const [u, n] of cases) {
      for (let i = 0; i < n; i++) { A.advance(HOUR); await A.call('challenge', u, { userId: target.id, gameId: GAME }); }
      const e = await err(A.call('challenge', u, { userId: target.id, gameId: GAME }));
      expect(e.status, A.tier(u)).toBe(403);
      expect(e.message).toMatch(/Daily challenge limit/);
      // Rolling window: 24 hours after the FIRST one, exactly one more is allowed.
      A.advance(DAY - (n - 1) * HOUR + 1000);
      await A.call('challenge', u, { userId: target.id, gameId: GAME });
      expect((await err(A.call('challenge', u, { userId: target.id, gameId: GAME }))).status).toBe(403);
    }
    const sub = await member(A, 'Sub', { tier: 'member' });
    for (let i = 0; i < 15; i++) await A.call('challenge', sub, { userId: target.id, gameId: GAME });
    expect(A.c.challenges.count((c) => c.fromId === sub.id)).toBe(15);
  });

  it('cancelled and declined challenges still count toward the day (it is a sending limit)', async () => {
    const A = makeArena();
    const g = await guest(A, 'Gus'); const target = await member(A, 'Target');
    for (let i = 0; i < 3; i++) { const { challenge } = await A.call('challenge', g, { userId: target.id, gameId: GAME }); await A.call('cancelChallenge', g, { id: challenge.id }); }
    expect((await err(A.call('challenge', g, { userId: target.id, gameId: GAME }))).status).toBe(403);
  });

  it('refuses yourself, a bot, an unknown game, an unknown member', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    expect((await err(A.call('challenge', a, { userId: a.id, gameId: GAME }))).message).toMatch(/yourself/);
    expect((await err(A.call('challenge', a, { userId: 'arena', gameId: GAME }))).message).toMatch(/Play a bot/);
    expect((await err(A.call('challenge', a, { userId: b.id, gameId: 'venturemaker' }))).message).toMatch(/not playable/);
    expect((await err(A.call('challenge', a, { userId: b.id, gameId: 'constructor' }))).message).toMatch(/not playable/);
    expect((await err(A.call('challenge', a, { userId: 'nope', gameId: GAME }))).status).toBe(404);
    expect(A.c.challenges.size).toBe(0);
    const c = (await A.call('challenge', a, { userId: b.id, gameId: GAME, message: `  ${'m'.repeat(300)}` })).challenge;
    expect(c.message).toHaveLength(200);
    expect(c).toMatchObject({ status: 'pending', gameName: 'Four in a Row', incoming: false, from: { id: a.id }, to: { id: b.id }, expiresAt: A.now() + 48 * HOUR });
    expect((await A.call('challenge', a, { userId: b.id, gameId: GAME, message: '   ' })).challenge.message).toBe(null);
    expect((await A.call('inbox', b)).challenges[0].incoming).toBe(true);
  });

  it('accepting opens a private table with both seated, the challenger hosting, and pays the accepter 5 points once', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await guest(A, 'Bob'); const c = await member(A, 'Carol');
    const { challenge } = await A.call('challenge', a, { userId: b.id, gameId: GAME });
    expect((await err(A.call('answerChallenge', a, { id: challenge.id, accept: true }))).message).toMatch(/not your challenge/); // the sender cannot accept for them
    expect((await err(A.call('answerChallenge', c, { id: challenge.id, accept: true }))).message).toMatch(/not your challenge/);
    expect((await err(A.call('answerChallenge', b, { id: 'nope', accept: true }))).message).toMatch(/not your challenge/);
    const before = b.points;
    const { tableId } = await A.call('answerChallenge', b, { id: challenge.id, accept: true });
    const t = A.c.tables.get(tableId);
    expect(t).toMatchObject({ hostId: a.id, visibility: 'private', status: 'open', players: [a.id, b.id], observers: [], gameId: GAME, challengeId: challenge.id });
    expect(t.settings).toEqual({ size: 2, fillBots: true, botLevel: 2 });
    expect(b.points - before).toBe(5);
    expect(A.c.challenges.get(challenge.id)).toMatchObject({ status: 'accepted', tableId });
    expect((await A.call('inbox', a)).notes[0].body).toMatch(/Bob accepted your Four in a Row challenge/);
    // Answering again is refused and pays nothing.
    expect((await err(A.call('answerChallenge', b, { id: challenge.id, accept: true }))).message).toMatch(/already answered/);
    expect((await err(A.call('answerChallenge', b, { id: challenge.id, accept: false }))).message).toMatch(/already answered/);
    expect(b.points - before).toBe(5);
    expect(A.c.tables.count((x) => x.challengeId === challenge.id)).toBe(1);
    // The table is theirs alone.
    expect((await err(A.call('table', c, { id: tableId }))).status).toBe(403);
    expect((await A.call('table', b, { id: tableId })).table.me.role).toBe('player');
    // Both see it in their challenge list until the game is over.
    expect((await A.call('inbox', a)).challenges.map((x) => [x.id, x.status, x.tableId])).toEqual([[challenge.id, 'accepted', tableId]]);
    await A.call('startTable', a, { id: tableId });
    for (const [seat, col] of [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]]) await drop(A, tableId, seat, col);
    await tick(5);
    expect(A.c.tables.get(tableId).status).toBe('finished');
    expect((await A.call('inbox', a)).challenges).toEqual([]);
  });

  it('declining and cancelling', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const c1 = (await A.call('challenge', a, { userId: b.id, gameId: GAME })).challenge;
    expect(await A.call('answerChallenge', b, { id: c1.id, accept: false })).toEqual({ ok: true });
    expect(A.c.challenges.get(c1.id).status).toBe('declined');
    expect(A.c.tables.size).toBe(0);
    expect(b.points).toBe(0);
    expect((await err(A.call('cancelChallenge', a, { id: c1.id }))).message).toMatch(/Nothing to cancel/);

    const c2 = (await A.call('challenge', a, { userId: b.id, gameId: GAME })).challenge;
    expect((await err(A.call('cancelChallenge', b, { id: c2.id }))).message).toMatch(/Nothing to cancel/); // only the sender cancels
    expect((await err(A.call('cancelChallenge', a, { id: 'nope' }))).message).toMatch(/Nothing to cancel/);
    expect(await A.call('cancelChallenge', a, { id: c2.id })).toEqual({ ok: true });
    expect(A.c.challenges.get(c2.id).status).toBe('cancelled');
    expect((await err(A.call('answerChallenge', b, { id: c2.id, accept: true }))).message).toMatch(/already answered/);
    expect((await A.call('inbox', b)).challenges).toEqual([]);
  });

  it('expires after 48 hours, and the expiry is written down even though the answer is an error', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const c1 = (await A.call('challenge', a, { userId: b.id, gameId: GAME })).challenge;
    A.advance(48 * HOUR - 1000);
    expect((await A.call('inbox', b)).challenges.map((c) => c.status)).toEqual(['pending']);
    A.advance(2000);
    const e = await err(A.call('answerChallenge', b, { id: c1.id, accept: true }));
    expect(e.message).toMatch(/expired/);
    expect(A.c.challenges.get(c1.id).status).toBe('expired');
    expect(A.c.tables.size).toBe(0);
    expect(b.points).toBe(0);
    expect((await err(A.call('answerChallenge', b, { id: c1.id, accept: true }))).message).toMatch(/expired/);
    // Just listing them notices the deadline too, and an expired challenge is no longer shown.
    A.advance(DAY);
    const c2 = (await A.call('challenge', a, { userId: b.id, gameId: GAME })).challenge;
    A.advance(48 * HOUR + 1);
    expect((await A.call('inbox', b)).challenges).toEqual([]);
    expect(A.c.challenges.get(c2.id).status).toBe('expired');
    expect((await err(A.call('cancelChallenge', a, { id: c2.id }))).message).toMatch(/Nothing to cancel/);
  });

  it('a block stops new challenges both ways', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await A.call('block', a, { userId: b.id });
    expect((await err(A.call('challenge', b, { userId: a.id, gameId: GAME }))).message).toMatch(/cannot challenge/);
    expect((await err(A.call('challenge', a, { userId: b.id, gameId: GAME }))).message).toMatch(/cannot challenge/);
  });
});

describe('invites', () => {
  it('logging an invite gives the member their code: 8 characters, no I, O, 0 or 1', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    expect((await A.call('inviteInfo', a)).history).toEqual([]);
    const { code } = await A.call('logInvite', a, { channel: 'sms', contact: '+1 555 0100', name: 'Bo', tableCode: 'abcd1234' });
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    A.advance(1000);
    await A.call('logInvite', a, { channel: 'carrier pigeon', contact: 'c'.repeat(500), name: 'n'.repeat(100) });
    const info = await A.call('inviteInfo', a);
    expect(info.code).toBe(code);
    expect(info.history).toHaveLength(2);
    expect(info.history[0]).toMatchObject({ channel: 'link', joined: false }); // newest first; unknown channels are "link"
    expect(info.history[0].contact).toHaveLength(120);
    expect(info.history[0].name).toHaveLength(40);
    expect(info.history[1]).toMatchObject({ channel: 'sms', contact: '+1 555 0100', name: 'Bo', tableCode: 'abcd1234', joined: false });
    for (const ch of ['sms', 'email', 'share', 'link']) { await A.call('logInvite', a, { channel: ch }); }
    expect((await A.call('inviteInfo', a)).history.slice(0, 4).map((h) => h.channel).sort()).toEqual(['email', 'link', 'share', 'sms']);
  });

  it('guests have no code and cannot log invites; history is the member\'s own', async () => {
    const A = makeArena();
    const g = await guest(A); const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const e = await err(A.call('logInvite', g, { channel: 'link' }));
    expect(e.status).toBe(403);
    expect(await A.call('inviteInfo', g)).toEqual({ code: null, history: [] });
    await A.call('logInvite', a, { channel: 'email', contact: 'secret@example.com' });
    expect(JSON.stringify(await A.call('inviteInfo', b))).not.toContain('secret@example.com');
    expect((await A.call('inviteInfo', b)).code).not.toBe((await A.call('inviteInfo', a)).code);
  });

  it('history shows the 20 most recent and is rate limited to 60 an hour', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    for (let i = 0; i < 60; i++) { A.advance(10); await A.call('logInvite', a, { channel: 'link', name: `n${i}` }); }
    expect((await err(A.call('logInvite', a, { channel: 'link' }))).status).toBe(429);
    const h = (await A.call('inviteInfo', a)).history;
    expect(h).toHaveLength(20);
    expect(h[0].name).toBe('n59');
  });
});

describe('presence and tablemates', () => {
  it('online means seen in the last three minutes; the list is newest first, without me or bots', async () => {
    const A = makeArena();
    const me = await member(A, 'Me'); const a = await member(A, 'Alice'); const b = await guest(A, 'Bob'); const c = await member(A, 'Carol');
    A.advance(10 * 60000);
    expect((await A.call('online', me)).members).toEqual([]);
    await A.call('heartbeat', a); A.advance(60000);
    await A.call('heartbeat', b); A.advance(60000);
    await A.call('heartbeat', me);
    expect((await A.call('online', me)).members.map((m) => m.id)).toEqual([b.id, a.id]); // guests are included
    expect((await A.call('online', me)).members[0].online).toBe(true);
    A.advance(60000 + 1); // Alice was last seen 3 minutes and 1 ms ago
    expect((await A.call('online', me)).members.map((m) => m.id)).toEqual([b.id]);
    expect((await A.call('online', c)).members.map((m) => m.id)).toEqual([me.id, b.id]);
    expect(JSON.stringify(await A.call('online', me))).not.toContain('"arena"');
  });

  it('tablemates: the people I finished games with, how often, most recent first', async () => {
    const A = makeArena();
    const me = await member(A, 'Me'); const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol');
    await playOut(A, me, a); A.advance(1000);
    await playOut(A, b, me); A.advance(1000);
    await playOut(A, me, a); A.advance(1000);
    await playOut(A, a, c); // not my game
    const { table } = await A.call('playBots', me, { gameId: GAME }); // a bot is not a tablemate
    await A.call('leaveTable', me, { id: table.id }); await tick(10);
    const r = await A.call('tablemates', me);
    expect(r.members.map((m) => [m.card.id, m.games])).toEqual([[a.id, 2], [b.id, 1]]);
    expect(r.members[0].last).toBeGreaterThan(r.members[1].last);
    expect((await A.call('tablemates', c)).members.map((m) => m.card.id)).toEqual([a.id]);
    expect((await A.call('tablemates', await guest(A))).members).toEqual([]);
  });
});

describe('reports', () => {
  it('need a description and are rate limited', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    expect((await err(A.call('report', a, { userId: b.id, body: '  ' }))).message).toMatch(/what happened/);
    expect(await A.call('report', a, { userId: b.id, body: 'x'.repeat(3000) })).toEqual({ ok: true });
    const row = A.c.reports.all()[0];
    expect(row).toMatchObject({ reporterId: a.id, reportedId: b.id, status: 'new' });
    expect(row.body).toHaveLength(1000);
    for (let i = 0; i < 9; i++) await A.call('report', a, { body: 'again' });
    expect((await err(A.call('report', a, { body: 'eleventh' }))).status).toBe(429);
    expect(A.admin.reports()).toHaveLength(10);
  });

  it('store ids, never whatever else the request carried', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await A.call('report', a, { userId: { junk: 'x'.repeat(20000) }, tableId: ['y'.repeat(20000)], body: 'first' });
    A.advance(1000);
    await A.call('report', a, { userId: b.id, tableId: 't'.repeat(900), body: 'second' });
    const [second, first] = A.admin.reports();
    expect(first).toMatchObject({ reportedId: null, tableId: null, body: 'first' });
    expect(second.reportedId).toBe(b.id);
    expect(second.tableId.length).toBeLessThanOrEqual(64);
    expect(JSON.stringify(A.admin.reports()).length).toBeLessThan(1000);
  });
});

describe('the chat window', () => {
  const said = (list) => list.people.map((p) => [p.card.displayName, p.unread, p.last ? p.last.body : null]);

  it('lists everyone you can talk to, newest conversation first, with what is unread', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Cyd'); const d = await member(A, 'Dee', { tier: 'member' });
    for (const o of [b, c]) { await A.call('connect', a, { userId: o.id }); await A.call('answerConnection', o, { userId: a.id, accept: true }); }
    // No conversation yet: connections are listed, nothing unread.
    expect(said(await A.call('chatList', a))).toEqual(expect.arrayContaining([['Bob', 0, null], ['Cyd', 0, null]]));
    await A.call('sendMessage', b, { toId: a.id, body: 'one' }); A.advance(1000);
    await A.call('sendMessage', b, { toId: a.id, body: 'two' }); A.advance(1000);
    await A.call('sendMessage', c, { toId: a.id, body: 'hello from Cyd' }); A.advance(1000);
    // A Subscriber who is not a connection wrote too: they appear, so the message is not lost.
    await A.call('sendMessage', d, { toId: a.id, body: 'cold open' }); A.advance(1000);
    const list = await A.call('chatList', a);
    expect(said(list)).toEqual([['Dee', 1, 'cold open'], ['Cyd', 1, 'hello from Cyd'], ['Bob', 2, 'two']]);
    expect(list.unread).toBe(4);
    expect(list.people.find((p) => p.card.displayName === 'Dee').canMessage).toBe(false); // Alice is not a Subscriber and they are not connected
    // The sender sees their own last line, marked as theirs, and nothing unread.
    const bobs = await A.call('chatList', b);
    expect(bobs.people[0].last).toMatchObject({ body: 'two', mine: true });
    expect(bobs.unread).toBe(0);
    // The Inbox page carries the same counts.
    const box = await A.call('inbox', a);
    expect(box.connections.map((x) => [x.card.displayName, x.unread])).toEqual([['Cyd', 1], ['Bob', 2]]);
  });

  it('opening a conversation reads it; peeking does not; replying reads it too', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await A.call('connect', a, { userId: b.id }); await A.call('answerConnection', b, { userId: a.id, accept: true });
    await A.call('sendMessage', b, { toId: a.id, body: 'one' }); A.advance(1000);
    expect((await A.call('thread', a, { userId: b.id, peek: true })).unread).toBe(1);
    expect((await A.call('chatList', a)).unread).toBe(1);
    A.events.length = 0;
    expect((await A.call('thread', a, { userId: b.id })).unread).toBe(1); // what WAS waiting
    expect((await A.call('chatList', a)).unread).toBe(0);
    // Alice's other tabs are told, so their badge clears as well.
    expect(A.events).toContainEqual({ room: `u:${a.id}`, event: 'inbox', payload: { kind: 'read', withId: b.id } });
    A.advance(1000);
    await A.call('sendMessage', b, { toId: a.id, body: 'two' }); A.advance(1000);
    expect((await A.call('chatList', a)).unread).toBe(1);
    await A.call('sendMessage', a, { toId: b.id, body: 'got it' });
    expect((await A.call('chatList', a)).unread).toBe(0);
    await A.call('markRead', b, { userId: a.id });
    expect((await A.call('chatList', b)).unread).toBe(0);
  });

  it('leaves out blocked members, table chat and notes from the arena; a guest gets an empty list', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Cyd');
    for (const o of [b, c]) { await A.call('connect', a, { userId: o.id }); await A.call('answerConnection', o, { userId: a.id, accept: true }); }
    await A.call('sendMessage', b, { toId: a.id, body: 'hi' });
    A.notify(a.id, 'A note from the arena');
    await playOut(A, a, c); // puts table chat and system lines in the same collection
    await A.call('block', a, { userId: b.id });
    const list = await A.call('chatList', a);
    expect(list.people.map((p) => p.card.displayName)).toEqual(['Cyd']);
    expect(list.unread).toBe(0);
    const g = await guest(A, 'Gus');
    expect(await A.call('chatList', g)).toEqual({ people: [], unread: 0, guest: true });
  });
});
