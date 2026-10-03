// The daily rhythm (topic and quiz), the opportunities board, the feedback
// loop, membership billing and the admin helpers.
import crypto from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeArena, guest, member } from './helpers.js';
import { TOPICS, QUIZ } from '../src/server/data/daily-content.js';
import { OPPORTUNITY_KINDS } from '../src/server/arena/community.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const READY = { colorRanks: ['teal'], archetype: 'builder', headline: 'I build tools', stage: 'revenue', industry: 'SaaS', intent: ['peers'], goals: 'Reach 100 customers', currentProject: 'A billing tool', onboardedAt: 1 };
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
/** An arena whose clock sits at the next UTC noon. */
function arena(config) {
  const A = makeArena(config);
  A.advance((Math.floor(A.now() / DAY) + 1) * DAY + 12 * HOUR - A.now());
  return A;
}
const dayNo = (A) => Math.floor(A.now() / DAY);
const quizOf = (A) => { const i = dayNo(A) % QUIZ.length; const [theme, question, options, answerIndex, explanation] = QUIZ[i]; return { id: `quiz-${i}`, theme, question, options, answerIndex, explanation }; };

afterEach(() => { vi.unstubAllGlobals(); });

describe('the content bank', () => {
  it('is well formed: every quiz has four options and an answer among them', () => {
    expect(TOPICS.length).toBeGreaterThanOrEqual(30);
    expect(QUIZ.length).toBeGreaterThanOrEqual(30);
    for (const [theme, title, prompt] of TOPICS) { expect(theme).toBeTruthy(); expect(title).toBeTruthy(); expect(prompt.length).toBeGreaterThan(10); }
    for (const [theme, question, options, answerIndex, explanation] of QUIZ) {
      expect(theme).toBeTruthy(); expect(question).toBeTruthy(); expect(explanation).toBeTruthy();
      expect(options).toHaveLength(4);
      expect(Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex < 4, question).toBe(true);
    }
  });
});

describe('topic of the day and daily quiz: rotation', () => {
  it('everyone sees the same item on the same UTC day and the next one the day after', async () => {
    const A = arena();
    const a = await member(A, 'Alice'); const g = await guest(A);
    const i = dayNo(A);
    const d1 = await A.call('daily', a);
    expect(d1.topic).toMatchObject({ id: `topic-${i % TOPICS.length}`, theme: TOPICS[i % TOPICS.length][0], title: TOPICS[i % TOPICS.length][1], prompt: TOPICS[i % TOPICS.length][2], replies: [] });
    expect(d1.quiz).toMatchObject({ id: `quiz-${i % QUIZ.length}`, question: QUIZ[i % QUIZ.length][1], options: QUIZ[i % QUIZ.length][2], answered: false });
    const dg = await A.call('daily', g);
    expect(dg.topic.id).toBe(d1.topic.id);
    expect(dg.quiz.id).toBe(d1.quiz.id);
    A.advance(11 * HOUR + 59 * 60000); // 23:59 UTC
    expect((await A.call('daily', a)).topic.id).toBe(d1.topic.id);
    A.advance(2 * 60000); // 00:01 UTC
    const d2 = await A.call('daily', a);
    expect(d2.topic.id).toBe(`topic-${(i + 1) % TOPICS.length}`);
    expect(d2.quiz.id).toBe(`quiz-${(i + 1) % QUIZ.length}`);
    // The bank never runs dry: after a full lap the same item comes round.
    A.advance(TOPICS.length * DAY);
    expect((await A.call('daily', a)).topic.id).toBe(d2.topic.id);
  });
});

describe('daily quiz', () => {
  it('the answer is not sent until this member has answered', async () => {
    const A = arena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const q = quizOf(A);
    const before = (await A.call('daily', a)).quiz;
    expect(before).toEqual({ id: q.id, theme: q.theme, question: q.question, options: q.options, answered: false });
    expect(JSON.stringify(before)).not.toContain(q.explanation);
    const r = await A.call('answerQuiz', a, { id: q.id, choice: q.answerIndex });
    expect(r).toEqual({ correct: true, myChoice: q.answerIndex, answerIndex: q.answerIndex, explanation: q.explanation, awarded: 10 });
    expect((await A.call('daily', a)).quiz).toMatchObject({ answered: true, myChoice: q.answerIndex, correct: true, answerIndex: q.answerIndex, explanation: q.explanation });
    // Bob has not answered: still nothing for him.
    const bob = (await A.call('daily', b)).quiz;
    expect(bob.answered).toBe(false);
    expect(bob).not.toHaveProperty('answerIndex');
    expect(bob).not.toHaveProperty('explanation');
  });

  it('first answer wins: 10 points if right, 3 if wrong, and it cannot be changed', async () => {
    const A = arena();
    const a = await member(A, 'Alice'); const g = await guest(A); // guests may answer
    const q = quizOf(A);
    const wrong = (q.answerIndex + 1) % 4;
    const pa = a.points;
    expect(await A.call('answerQuiz', a, { id: q.id, choice: wrong })).toMatchObject({ correct: false, myChoice: wrong, answerIndex: q.answerIndex, awarded: 3 });
    expect(await A.call('answerQuiz', a, { id: q.id, choice: q.answerIndex })).toMatchObject({ correct: false, myChoice: wrong, awarded: 0 });
    expect(a.points - pa).toBe(3);
    expect(A.c.quizAnswers.count((x) => x.userId === a.id)).toBe(1);
    expect(await A.call('answerQuiz', g, { id: q.id, choice: q.answerIndex })).toMatchObject({ correct: true, awarded: 10 });
    expect(g.points).toBe(10);
  });

  it('only a real choice counts; a bad one is not recorded', async () => {
    const A = arena();
    const a = await member(A, 'Alice');
    const q = quizOf(A);
    for (const choice of [undefined, null, -1, 4, 1.5, 'a', '', NaN, [], {}]) {
      const e = await err(A.call('answerQuiz', a, { id: q.id, choice }));
      expect(e.message, JSON.stringify(choice)).toMatch(/Pick one/);
    }
    expect(A.c.quizAnswers.size).toBe(0);
    expect((await A.call('daily', a)).quiz.answered).toBe(false);
    expect((await A.call('answerQuiz', a, { id: q.id, choice: String(q.answerIndex) })).correct).toBe(true); // a numeric string from a form is fine
  });

  it("only today's question can be answered", async () => {
    const A = arena();
    const a = await member(A, 'Alice');
    const q = quizOf(A);
    const i = dayNo(A) % QUIZ.length;
    for (const id of [`quiz-${(i + 1) % QUIZ.length}`, `quiz-${(i + QUIZ.length - 1) % QUIZ.length}`, 'quiz-9999', '', undefined, null, i, { id: q.id }]) {
      const e = await err(A.call('answerQuiz', a, { id, choice: 0 }));
      expect(e.message, String(id)).toMatch(/rotated out/);
    }
    expect(a.points).toBe(0);
    A.advance(DAY);
    expect((await err(A.call('answerQuiz', a, { id: q.id, choice: q.answerIndex }))).message).toMatch(/rotated out/); // yesterday's
  });

  it('points once a day, and again the next day for the next question', async () => {
    const A = arena();
    const a = await member(A, 'Alice');
    let total = 0;
    for (let d = 0; d < 3; d++) {
      const q = quizOf(A);
      const r = await A.call('answerQuiz', a, { id: q.id, choice: q.answerIndex });
      expect(r.awarded).toBe(10);
      total += 10;
      expect(a.points).toBe(total);
      A.advance(DAY);
    }
    expect(A.c.points.count((p) => p.userId === a.id && p.kind === 'quiz')).toBe(3);
  });

  it('when the bank comes round again the question is new for the day: unanswered, answerable, paid', async () => {
    const A = arena();
    const a = await member(A, 'Alice');
    const q = quizOf(A);
    const wrong = (q.answerIndex + 1) % 4;
    await A.call('answerQuiz', a, { id: q.id, choice: wrong });
    A.advance(QUIZ.length * DAY);
    expect(quizOf(A).id).toBe(q.id);
    const again = (await A.call('daily', a)).quiz;
    expect(again.answered).toBe(false);
    expect(again).not.toHaveProperty('answerIndex');
    const before = a.points;
    expect(await A.call('answerQuiz', a, { id: q.id, choice: q.answerIndex })).toMatchObject({ correct: true, myChoice: q.answerIndex, awarded: 10 });
    expect(a.points - before).toBe(10);
    // Still first-answer-wins within that day.
    expect(await A.call('answerQuiz', a, { id: q.id, choice: wrong })).toMatchObject({ correct: true, myChoice: q.answerIndex, awarded: 0 });
  });
});

describe('topic replies', () => {
  it('guests read but do not reply', async () => {
    const A = arena();
    const g = await guest(A); const a = await member(A, 'Alice');
    const e = await err(A.call('replyTopic', g, { body: 'my take' }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/free account/);
    await A.call('replyTopic', a, { body: 'Close fast.' });
    expect((await A.call('daily', g)).topic.replies.map((r) => r.body)).toEqual(['Close fast.']);
  });

  it('the first reply to a topic pays 5 points; more replies are welcome and pay nothing', async () => {
    const A = arena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    A.events.length = 0;
    expect(await A.call('replyTopic', a, { body: `  ${'t'.repeat(1500)}` })).toEqual({ awarded: 5 });
    expect(A.events).toContainEqual({ room: 'lobby', event: 'daily', payload: {} });
    A.advance(1000);
    expect(await A.call('replyTopic', a, { body: 'and another thing' })).toEqual({ awarded: 0 });
    A.advance(1000);
    expect(await A.call('replyTopic', b, { body: 'I disagree' })).toEqual({ awarded: 5 });
    expect(a.points).toBe(5);
    expect((await err(A.call('replyTopic', a, { body: '   ' }))).message).toMatch(/Write your take/);
    expect((await err(A.call('replyTopic', a, {}))).message).toMatch(/Write your take/);
    const replies = (await A.call('daily', b)).topic.replies;
    expect(replies.map((r) => [r.name, r.body.length])).toEqual([['Alice', 1000], ['Alice', 17], ['Bob', 10]]);
    expect(replies[0]).toMatchObject({ userId: a.id, avatar: a.avatar });
    // Tomorrow's topic pays again and starts empty.
    A.advance(DAY);
    expect((await A.call('daily', a)).topic.replies).toEqual([]);
    expect(await A.call('replyTopic', a, { body: 'new day' })).toEqual({ awarded: 5 });
    expect(a.points).toBe(10);
  });

  it('pays again when the same topic comes round a lap later', async () => {
    const A = arena();
    const a = await member(A, 'Alice');
    await A.call('replyTopic', a, { body: 'first lap' });
    A.advance(TOPICS.length * DAY);
    expect(await A.call('replyTopic', a, { body: 'second lap' })).toEqual({ awarded: 5 });
    expect(a.points).toBe(10);
  });

  it('is rate limited to 10 an hour and shows the latest 50', async () => {
    const A = arena();
    const a = await member(A, 'Alice');
    for (let i = 0; i < 10; i++) await A.call('replyTopic', a, { body: `take ${i}` });
    expect((await err(A.call('replyTopic', a, { body: 'eleven' }))).status).toBe(429);
    const topicId = (await A.call('daily', a)).topic.id;
    for (let i = 0; i < 60; i++) A.c.topicReplies.put({ id: `r${i}`, topicId, userId: a.id, body: `bulk ${i}`, at: A.now() + 1000 + i });
    const replies = (await A.call('daily', a)).topic.replies;
    expect(replies).toHaveLength(50);
    expect(replies[49].body).toBe('bulk 59');
    expect(replies[0].body).toBe('bulk 10');
  });
});

describe('the opportunities board', () => {
  const post = (A, u, kind, extra = {}) => A.call('postOpportunity', u, { kind, title: 'A clear title', body: 'A few sentences of detail about this.', ...extra });

  it('who can post what: asks for every member, roles for Subscribers, venture calls for VIPs, nothing for guests', async () => {
    const A = arena();
    const asks = ['seeking_cofounder', 'seeking_mentor', 'seeking_role', 'seeking_clients']; const offers = ['role']; const calls = ['incubation', 'investment', 'challenge'];
    expect(Object.keys(OPPORTUNITY_KINDS).sort()).toEqual([...asks, ...offers, ...calls].sort());
    const g = await guest(A);
    for (const kind of [...asks, ...offers, ...calls]) { const e = await err(post(A, g, kind)); expect(e.status, kind).toBe(403); expect(e.message).toMatch(/free account/); }
    const cases = [['free', asks, [...offers, ...calls]], ['member', [...asks, ...offers], calls], ['vip', [...asks, ...offers, ...calls], []], ['ceo', [...asks, ...offers, ...calls], []]];
    for (const [tier, yes, no] of cases) {
      const A2 = arena();
      const u = await member(A2, 'User', { tier });
      const two = await member(A2, 'Second', { tier });
      const kinds = (await A2.call('opportunities', u, {})).kinds;
      expect(kinds.filter((k) => k.canPost).map((k) => k.id).sort(), tier).toEqual([...yes].sort());
      for (const [i, kind] of yes.entries()) expect((await post(A2, i < 5 ? u : two, kind)).item, `${tier}:${kind}`).toMatchObject({ kind, kindLabel: OPPORTUNITY_KINDS[kind].label, mine: true, responded: false, responses: 0 });
      for (const kind of no) {
        const e = await err(post(A2, u, kind));
        expect(e.status, `${tier}:${kind}`).toBe(403);
        expect(e.message).toMatch(kind === 'role' ? /Subscriber/ : /VIP/);
      }
    }
    const u = await member(A, 'User', { tier: 'ceo' });
    for (const kind of [undefined, 'nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect((await err(post(A, u, kind))).message, String(kind)).toMatch(/Pick what kind/);
    expect(A.c.opportunities.size).toBe(0);
  });

  it('needs a real title and some detail, capped; five open posts at most', async () => {
    const A = arena();
    const u = await member(A, 'User');
    expect((await err(post(A, u, 'seeking_role', { title: 'Short' }))).message).toMatch(/clear title/);
    expect((await err(post(A, u, 'seeking_role', { body: 'Too short.' }))).message).toMatch(/clear title/);
    expect((await err(post(A, u, 'seeking_role', { title: 42, body: ['x'] }))).message).toMatch(/clear title/);
    const big = (await post(A, u, 'seeking_role', { title: 't'.repeat(300), body: 'b'.repeat(5000) })).item;
    expect(big.title).toHaveLength(100);
    expect(big.body).toHaveLength(1200);
    const ids = [big.id];
    for (let i = 0; i < 4; i++) ids.push((await post(A, u, 'seeking_clients')).item.id);
    expect((await err(post(A, u, 'seeking_clients'))).message).toMatch(/5 open posts/);
    expect(await A.call('closeOpportunity', u, { id: ids[0] })).toEqual({ ok: true });
    expect((await post(A, u, 'seeking_clients')).item.kind).toBe('seeking_clients');
  });

  it('lists open posts, CEO members first then newest, filtered by kind, with only my own response counts', async () => {
    const A = arena();
    const a = await member(A, 'Alice'); const ceo = await member(A, 'Ceo', { tier: 'ceo' }); const b = await member(A, 'Bob', READY);
    const p1 = (await post(A, ceo, 'investment')).item; A.advance(1000);
    const p2 = (await post(A, a, 'seeking_cofounder')).item; A.advance(1000);
    const p3 = (await post(A, a, 'seeking_role')).item; A.advance(1000);
    const closed = (await post(A, a, 'seeking_role')).item;
    await A.call('closeOpportunity', a, { id: closed.id });
    await A.call('respondOpportunity', b, { id: p2.id, note: 'I am in' });
    const all = await A.call('opportunities', b, {});
    expect(all.items.map((o) => o.id)).toEqual([p1.id, p3.id, p2.id]);
    expect(all.items.find((o) => o.id === p2.id)).toMatchObject({ mine: false, responded: true, by: { id: a.id } });
    expect(all.items.find((o) => o.id === p2.id).responses).toBeUndefined(); // how many answered is the poster's business
    expect((await A.call('opportunities', a, {})).items.find((o) => o.id === p2.id)).toMatchObject({ mine: true, responded: false, responses: 1 });
    expect((await A.call('opportunities', b, { kind: 'seeking_role' })).items.map((o) => o.id)).toEqual([p3.id]);
    expect((await A.call('opportunities', b, { kind: 'nope' })).items).toHaveLength(3);
    expect((await A.call('opportunities', b, { kind: 'constructor' })).items).toHaveLength(3);
    // Raw responder ids never leave the server.
    expect(JSON.stringify(await A.call('opportunities', ceo, {}))).not.toContain(b.id);
    // A guest can read the board.
    expect((await A.call('opportunities', await guest(A), {})).items).toHaveLength(3);
  });

  it('responding is an introduction the poster accepts or declines', async () => {
    const A = arena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob', READY);
    const p = (await post(A, a, 'seeking_cofounder', { title: 'Technical cofounder wanted' })).item;
    expect(await A.call('respondOpportunity', b, { id: p.id, note: `Let us talk ${'x'.repeat(400)}` })).toEqual({ ok: true });
    const intro = A.c.introductions.all()[0];
    expect(intro).toMatchObject({ kind: 'opportunity', fromId: b.id, toId: a.id, ref: p.id, status: 'pending' });
    expect(intro.reason.startsWith('Re: Technical cofounder wanted. Let us talk')).toBe(true);
    expect(intro.reason).toHaveLength('Re: Technical cofounder wanted. '.length + 240); // the note is capped at 240
    expect(intro.reason.length).toBeLessThanOrEqual(300);
    expect((await A.call('inbox', a)).introsIn.map((i) => i.id)).toEqual([intro.id]);
    // Twice is still one introduction and one response.
    await A.call('respondOpportunity', b, { id: p.id, note: 'again' });
    expect(A.c.introductions.size).toBe(1);
    expect(A.c.opportunities.get(p.id).responders).toEqual([b.id]);
    await A.call('answerIntro', a, { id: intro.id, accept: true });
    expect(A.areConnected(a.id, b.id)).toBe(true);
  });

  it('refuses your own post, a closed post, a responder without a finished profile, and closing someone else\'s', async () => {
    const A = arena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob', READY); const thin = await member(A, 'Thin'); const g = await guest(A);
    const p = (await post(A, a, 'seeking_cofounder')).item;
    expect((await err(A.call('respondOpportunity', a, { id: p.id }))).message).toMatch(/your own post/);
    expect((await err(A.call('respondOpportunity', thin, { id: p.id }))).status).toBe(403);
    expect((await err(A.call('respondOpportunity', g, { id: p.id }))).status).toBe(403);
    expect(A.c.opportunities.get(p.id).responders).toEqual([]);
    expect((await err(A.call('closeOpportunity', b, { id: p.id }))).message).toMatch(/not your post/);
    expect((await err(A.call('closeOpportunity', b, { id: 'nope' }))).message).toMatch(/not your post/);
    expect(A.c.opportunities.get(p.id).status).toBe('open');
    await A.call('closeOpportunity', a, { id: p.id });
    expect((await err(A.call('respondOpportunity', b, { id: p.id }))).message).toMatch(/closed/);
    expect((await err(A.call('respondOpportunity', b, { id: 'nope' }))).message).toMatch(/closed/);
    // A block is respected here too.
    const p2 = (await post(A, a, 'seeking_cofounder')).item;
    await A.call('block', a, { userId: b.id });
    expect((await err(A.call('respondOpportunity', b, { id: p2.id }))).message).toMatch(/cannot contact/);
  });
});

describe('the feedback loop', () => {
  it('feedback, a thank-you in the inbox, an admin response, a second note', async () => {
    const A = arena();
    const a = await guest(A, 'Ada'); const b = await member(A, 'Bob');
    const r1 = await A.call('sendFeedback', a, { kind: 'problem', scope: 'fourinarow', body: 'The disc fell through the board.', page: '/table/1' });
    A.advance(1000);
    const r2 = await A.call('sendFeedback', b, { kind: 'nonsense', body: 'Love it' });
    expect([r1.id, r2.id]).toEqual(['1', '2']);
    expect(A.c.feedback.get('1')).toMatchObject({ userId: a.id, kind: 'problem', scope: 'fourinarow', status: 'new', response: null, page: '/table/1' });
    expect(A.c.feedback.get('2')).toMatchObject({ kind: 'general', scope: 'arena' });
    const note = (await A.call('inbox', a)).notes;
    expect(note).toHaveLength(1);
    expect(note[0].body).toMatch(/Thanks for the problem report about fourinarow/);
    expect((await A.call('inbox', b)).notes[0].body).toMatch(/Thanks for the feedback about arena/);

    expect(A.admin.feedback().map((f) => [f.id, f.by])).toEqual([['2', 'bob'], ['1', a.username]]);
    expect(A.admin.feedback('new')).toHaveLength(2);
    A.advance(1000);
    const done = A.admin.respondFeedback(1, 'fixed', 'Discs now stay put.');
    expect(done).toMatchObject({ id: '1', status: 'fixed', response: 'Discs now stay put.', respondedAt: A.now() });
    expect(A.admin.feedback('new').map((f) => f.id)).toEqual(['2']);
    const notes = (await A.call('inbox', a)).notes;
    expect(notes).toHaveLength(2);
    expect(notes[0].body).toMatch(/Your problem #1: fixed\. Discs now stay put\./);
    expect((await A.call('inbox', b)).notes).toHaveLength(1); // nobody else hears about it
    expect(() => A.admin.respondFeedback(99, 'done', 'x')).toThrow(/No such feedback/);
  });

  it('needs a few characters, is capped, and is rate limited', async () => {
    const A = arena();
    const a = await member(A, 'Alice');
    expect((await err(A.call('sendFeedback', a, { body: 'ok' }))).message).toMatch(/little more/);
    expect((await err(A.call('sendFeedback', a, {}))).message).toMatch(/little more/);
    await A.call('sendFeedback', a, { kind: 'suggestion', body: 'f'.repeat(9000), scope: 's'.repeat(100), page: 'p'.repeat(999) });
    expect(A.c.feedback.get('1').body).toHaveLength(4000);
    expect(A.c.feedback.get('1').scope).toHaveLength(40);
    expect(A.c.feedback.get('1').page).toHaveLength(200);
    for (let i = 0; i < 9; i++) await A.call('sendFeedback', a, { body: `more ${i}` });
    expect((await err(A.call('sendFeedback', a, { body: 'eleventh' }))).status).toBe(429);
    expect(A.c.feedback.size).toBe(10);
  });
});

describe('membership', () => {
  const STRIPE = { secret: 'sk_test_123', webhookSecret: 'whsec_test_456', prices: { member: 'price_member', vip: 'price_vip', ceo: 'price_ceo' } };
  const sign = (A, body, secret = STRIPE.webhookSecret, t = Math.floor(A.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const subEvent = (type, sub) => JSON.stringify({ type, data: { object: sub } });

  it('with billing off, choosing a plan joins the waitlist and records which plan', async () => {
    const A = arena();
    const a = await member(A, 'Alice'); const g = await guest(A);
    expect(await A.call('membership', a)).toEqual({ tier: 'free', billingLive: false, waitlisted: false, expiresAt: null });
    expect(await A.call('checkout', a, { tier: 'vip' })).toEqual({ waitlisted: true, tier: 'vip' });
    expect(await A.call('membership', a)).toMatchObject({ waitlisted: true, tier: 'free' }); // wanting a plan does not grant it
    expect(A.admin.waitlist()).toEqual([{ id: a.id, tier: 'vip', at: A.now(), email: 'alice@example.com' }]);
    await A.call('checkout', a, { tier: 'ceo' }); // changing your mind replaces the row
    expect(A.admin.waitlist().map((w) => w.tier)).toEqual(['ceo']);
    expect((await err(A.call('checkout', g, { tier: 'member' }))).status).toBe(403);
    for (const tier of ['free', 'anonymous', 'platinum', undefined, '__proto__']) expect((await err(A.call('checkout', a, { tier }))).message, String(tier)).toMatch(/Unknown plan/);
    expect((await err(A.call('billingPortal', a))).message).toMatch(/No billing account/);
    expect(a.tier).toBe('free');
  });

  it('verifyStripeSignature: valid, tampered body, wrong secret, stale or malformed timestamp', async () => {
    const A = arena({ stripe: STRIPE });
    const body = JSON.stringify({ type: 'ping' });
    const good = sign(A, body);
    expect(A.verifyStripeSignature(body, good)).toBe(true);
    expect(A.verifyStripeSignature(`${body} `, good)).toBe(false);
    expect(A.verifyStripeSignature(body.replace('ping', 'pong'), good)).toBe(false);
    expect(A.verifyStripeSignature(body, sign(A, body, 'whsec_other'))).toBe(false);
    expect(A.verifyStripeSignature(body, good.slice(0, -1))).toBe(false);
    expect(A.verifyStripeSignature(body, `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`)).toBe(false);
    // Known vector, independent of this file's own signer.
    const fixed = makeArena({ stripe: { ...STRIPE, webhookSecret: 'whsec_known' } });
    const t = 1700000000; const b = '{"id":"evt_1"}';
    const v1 = crypto.createHmac('sha256', 'whsec_known').update(`${t}.${b}`).digest('hex');
    expect(v1).toMatch(/^[0-9a-f]{64}$/);
    expect(fixed.verifyStripeSignature(b, `t=${t},v1=${v1}`, 'whsec_known', Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(fixed.verifyStripeSignature(b, `t=${t},v1=${v1}`)).toBe(false); // 2023 is far outside the five-minute window
    // Tolerance: five minutes either way.
    const old = Math.floor(A.now() / 1000) - 301; const fresh = Math.floor(A.now() / 1000) - 299; const future = Math.floor(A.now() / 1000) + 301;
    expect(A.verifyStripeSignature(body, sign(A, body, STRIPE.webhookSecret, old))).toBe(false);
    expect(A.verifyStripeSignature(body, sign(A, body, STRIPE.webhookSecret, fresh))).toBe(true);
    expect(A.verifyStripeSignature(body, sign(A, body, STRIPE.webhookSecret, future))).toBe(false);
    // A timestamp that is not a number must not slip past the freshness check.
    expect(A.verifyStripeSignature(body, sign(A, body, STRIPE.webhookSecret, 'abc'))).toBe(false);
    // Missing pieces.
    for (const header of [undefined, null, '', 'garbage', 't=1', 'v1=abc', `t=${Math.floor(A.now() / 1000)}`, `v1=${good.split('v1=')[1]}`]) expect(A.verifyStripeSignature(body, header), String(header)).toBe(false);
    // No secret configured: nothing verifies.
    const off = arena();
    expect(off.verifyStripeSignature(body, sign(off, body, ''))).toBe(false);
    expect(off.verifyStripeSignature(body, sign(off, body, 'undefined'))).toBe(false);
  });

  it('a subscription event sets the tier and an expiry with three days of grace; a cancelled one resets to free', async () => {
    const A = arena({ stripe: STRIPE });
    const a = await member(A, 'Alice'); a.stripeCustomerId = 'cus_alice';
    const b = await member(A, 'Bob'); b.stripeCustomerId = 'cus_bob';
    const end = Math.floor(A.now() / 1000) + 30 * 86400;
    A.events.length = 0;
    const body = subEvent('customer.subscription.created', { customer: 'cus_alice', status: 'active', current_period_end: end, items: { data: [{ price: { id: 'price_vip' } }] } });
    expect(await A.stripeWebhook(body, sign(A, body))).toEqual({ received: true });
    expect(a.tier).toBe('vip');
    expect(a.tierExpiresAt).toBe(end * 1000 + 3 * DAY);
    expect(A.tier(a)).toBe('vip');
    expect(b.tier).toBe('free'); // nobody else is touched
    expect(A.events).toContainEqual({ room: `u:${a.id}`, event: 'me', payload: {} });
    expect((await A.call('membership', a)).expiresAt).toBe(a.tierExpiresAt);
    // The period end may sit on the item (newer API versions).
    const up = subEvent('customer.subscription.updated', { customer: 'cus_alice', status: 'trialing', items: { data: [{ price: { id: 'price_ceo' }, current_period_end: end + 100 }] } });
    await A.stripeWebhook(up, sign(A, up));
    expect(a.tier).toBe('ceo');
    expect(a.tierExpiresAt).toBe((end + 100) * 1000 + 3 * DAY);
    // If no renewal arrives, the plan lapses by itself after the grace period.
    A.advance(30 * DAY + 3 * DAY + 200000);
    expect(A.tier(a)).toBe('free');
    // Cancelled.
    a.tierExpiresAt = A.now() + DAY;
    const del = subEvent('customer.subscription.deleted', { customer: 'cus_alice', status: 'canceled', items: { data: [{ price: { id: 'price_ceo' } }] } });
    await A.stripeWebhook(del, sign(A, del));
    expect(a.tier).toBe('free');
    expect(a.tierExpiresAt).toBe(null);
    // Past due, unpaid, incomplete: not a paid tier.
    for (const status of ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
      a.tier = 'vip';
      const ev = subEvent('customer.subscription.updated', { customer: 'cus_alice', status, current_period_end: end, items: { data: [{ price: { id: 'price_vip' } }] } });
      await A.stripeWebhook(ev, sign(A, ev));
      expect(a.tier, status).toBe('free');
    }
  });

  it('an unknown price, an unknown customer or an unrelated event changes nobody', async () => {
    const A = arena({ stripe: STRIPE });
    const a = await member(A, 'Alice', { tier: 'member' }); a.stripeCustomerId = 'cus_alice';
    const end = Math.floor(A.now() / 1000) + 86400;
    const stranger = subEvent('customer.subscription.created', { customer: 'cus_nobody', status: 'active', current_period_end: end, items: { data: [{ price: { id: 'price_ceo' } }] } });
    await A.stripeWebhook(stranger, sign(A, stranger));
    const other = JSON.stringify({ type: 'invoice.paid', data: { object: { customer: 'cus_alice' } } });
    await A.stripeWebhook(other, sign(A, other));
    expect(a.tier).toBe('member');
    // A price this arena does not sell is never a paid tier, whatever its id looks like.
    for (const id of ['price_other', '', 'constructor', '__proto__', undefined]) {
      a.tier = 'member';
      const ev = subEvent('customer.subscription.updated', { customer: 'cus_alice', status: 'active', current_period_end: end, items: { data: [{ price: { id } }] } });
      await A.stripeWebhook(ev, sign(A, ev));
      expect(a.tier, String(id)).toBe('free');
      expect(A.tier(a)).toBe('free');
    }
    // A guest (no customer id) is never matched by an event without a customer.
    const g = await guest(A);
    const none = subEvent('customer.subscription.created', { status: 'active', current_period_end: end, items: { data: [{ price: { id: 'price_ceo' } }] } });
    await A.stripeWebhook(none, sign(A, none));
    const nul = subEvent('customer.subscription.created', { customer: null, status: 'active', current_period_end: end, items: { data: [{ price: { id: 'price_ceo' } }] } });
    await A.stripeWebhook(nul, sign(A, nul));
    expect(g.tier).toBe('free');
    expect(A.c.users.count((u) => u.tier === 'ceo' && !u.isArena)).toBe(0);
  });

  it('a plan whose price is not configured can never be granted by an event with an empty price id', async () => {
    const A = arena({ stripe: { ...STRIPE, prices: { member: 'price_member', vip: '', ceo: '' } } });
    const a = await member(A, 'Alice'); a.stripeCustomerId = 'cus_alice';
    const ev = subEvent('customer.subscription.created', { customer: 'cus_alice', status: 'active', current_period_end: Math.floor(A.now() / 1000) + 86400, items: { data: [{ price: { id: '' } }] } });
    await A.stripeWebhook(ev, sign(A, ev));
    expect(a.tier).toBe('free');
    // And it cannot be bought: the member is told, Stripe is not called with an empty price.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const e = await err(A.call('checkout', a, { tier: 'vip' }));
    expect(e.message).toMatch(/not on sale|Unknown plan|unavailable/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a bad signature applies nothing', async () => {
    const A = arena({ stripe: STRIPE });
    const a = await member(A, 'Alice'); a.stripeCustomerId = 'cus_alice';
    const body = subEvent('customer.subscription.created', { customer: 'cus_alice', status: 'active', current_period_end: Math.floor(A.now() / 1000) + 86400, items: { data: [{ price: { id: 'price_ceo' } }] } });
    for (const sig of [undefined, 'nope', sign(A, body, 'whsec_wrong'), sign(A, `${body} `)]) {
      const e = await err(A.stripeWebhook(body, sig));
      expect(e.status).toBe(400);
    }
    expect(a.tier).toBe('free');
    // And with no webhook secret configured the endpoint accepts nothing at all.
    const off = arena();
    expect((await err(off.stripeWebhook(body, sign(off, body, '')))).status).toBe(400);
  });

  it('checkout completed: the subscription is fetched from Stripe with the secret key and applied', async () => {
    const A = arena({ stripe: STRIPE });
    const a = await member(A, 'Alice'); a.stripeCustomerId = 'cus_alice';
    const end = Math.floor(A.now() / 1000) + 30 * 86400;
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ customer: 'cus_alice', status: 'active', current_period_end: end, items: { data: [{ price: { id: 'price_member' } }] } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { subscription: 'sub_123', customer: 'cus_alice' } } });
    await A.stripeWebhook(body, sign(A, body));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.stripe.com/v1/subscriptions/sub_123');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk_test_123');
    expect(a.tier).toBe('member');
    // Stripe unreachable: nothing changes, the webhook still answers.
    a.tier = 'free';
    fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({}) }));
    expect(await A.stripeWebhook(body, sign(A, body))).toEqual({ received: true });
    expect(a.tier).toBe('free');
  });

  it('with billing on, checkout creates a customer once and returns the Stripe URL; the tier does not change until the webhook', async () => {
    const A = arena({ stripe: STRIPE });
    const a = await member(A, 'Alice');
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url, body: Object.fromEntries(new URLSearchParams(init.body)), auth: init.headers.Authorization });
      if (url.endsWith('/customers')) return { ok: true, json: async () => ({ id: 'cus_new' }) };
      if (url.endsWith('/checkout/sessions')) return { ok: true, json: async () => ({ url: 'https://checkout.stripe.test/s1' }) };
      if (url.endsWith('/billing_portal/sessions')) return { ok: true, json: async () => ({ url: 'https://billing.stripe.test/p1' }) };
      return { ok: false, json: async () => ({ error: { message: 'nope' } }) };
    }));
    expect((await A.call('membership', a)).billingLive).toBe(true);
    expect(await A.call('checkout', a, { tier: 'vip' })).toEqual({ url: 'https://checkout.stripe.test/s1' });
    expect(a.stripeCustomerId).toBe('cus_new');
    expect(a.tier).toBe('free');
    expect(A.c.waitlist.size).toBe(0);
    expect(calls.map((c) => c.url)).toEqual(['https://api.stripe.com/v1/customers', 'https://api.stripe.com/v1/checkout/sessions']);
    expect(calls.every((c) => c.auth === 'Bearer sk_test_123')).toBe(true);
    expect(calls[0].body).toEqual({ email: 'alice@example.com', 'metadata[user_id]': a.id });
    expect(calls[1].body).toMatchObject({ customer: 'cus_new', mode: 'subscription', 'line_items[0][price]': 'price_vip', 'line_items[0][quantity]': '1', success_url: 'http://test/membership?upgraded=1', cancel_url: 'http://test/membership' });
    await A.call('checkout', a, { tier: 'member' });
    expect(calls.filter((c) => c.url.endsWith('/customers'))).toHaveLength(1); // the customer is reused
    expect(await A.call('billingPortal', a)).toEqual({ url: 'https://billing.stripe.test/p1' });
    expect(calls[calls.length - 1].body).toEqual({ customer: 'cus_new', return_url: 'http://test/membership' });
  });

  it('a Stripe error reaches the member as a 502 with Stripe\'s message and no secret', async () => {
    const A = arena({ stripe: STRIPE });
    const a = await member(A, 'Alice');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'Your card was declined.' } }) })));
    const e = await err(A.call('checkout', a, { tier: 'member' }));
    expect(e.status).toBe(502);
    expect(e.message).toBe('Your card was declined.');
    expect(e.message).not.toContain('sk_test');
    expect(a.stripeCustomerId).toBe(null);
  });
});

describe('admin helpers', () => {
  it('setTier: by username or email, any case; clears the expiry; refuses unknown tiers and members', async () => {
    const A = arena();
    const a = await member(A, 'Alice', { tierExpiresAt: 123 });
    A.events.length = 0;
    expect(A.admin.setTier('ALICE', 'vip')).toEqual({ username: 'alice', tier: 'vip' });
    expect(a).toMatchObject({ tier: 'vip', tierExpiresAt: null });
    expect(A.events).toContainEqual({ room: `u:${a.id}`, event: 'me', payload: {} });
    expect(A.admin.setTier('Alice@Example.com', 'ceo').tier).toBe('ceo');
    expect(A.admin.setTier('alice', 'free').tier).toBe('free');
    for (const tier of ['anonymous', 'platinum', '', undefined, '__proto__', 'constructor', 'toString']) expect(() => A.admin.setTier('alice', tier), String(tier)).toThrow(/Unknown tier/);
    expect(a.tier).toBe('free');
    expect(() => A.admin.setTier('nobody', 'vip')).toThrow(/No such member/);
    // A guest has no email: "null" or "" must not match one.
    const g = await guest(A);
    for (const key of ['', 'null', 'undefined', null, undefined]) expect(() => A.admin.setTier(key, 'ceo'), String(key)).toThrow(/No such member/);
    expect(g.tier).toBe('free');
  });

  it('stats count members, guests, online, tables and tiers; bots are not people', async () => {
    const A = arena();
    const a = await member(A, 'Alice', { tier: 'vip' }); await member(A, 'Bob'); await guest(A); await guest(A);
    await A.call('createTable', a, { gameId: 'fourinarow' });
    await A.call('playBots', a, { gameId: 'fourinarow' });
    expect(A.admin.stats()).toEqual({ members: 2, guests: 2, online: 4, tablesOpen: 1, tablesPlaying: 1, gamesFinished: 0, byTier: { vip: 1, free: 1, anonymous: 2 } });
    A.advance(4 * 60000);
    expect(A.admin.stats().online).toBe(0);
  });
});
