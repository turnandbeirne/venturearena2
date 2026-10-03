// The age step: accounts are for 13 and over, the date of birth is never
// stored, and an adult and an under-18 can only contact each other privately
// after they have finished a game at the same table.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member, tick } from './helpers.js';
import { parseBirthDate, ageOn, adultFrom, MIN_AGE } from '../src/shared/age.js';

const GAME = 'fourinarow';
const DAY = 86400000;
const READY = { colorRanks: ['teal'], archetype: 'builder', headline: 'I build tools', stage: 'revenue', industry: 'SaaS', intent: ['peers'], goals: 'Reach 100 customers', currentProject: 'A billing tool', interests: ['SaaS'], emailVerified: true, onboardedAt: 1 };
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
const ip = () => ({ ip: `ip-${Math.random()}` });
/** A date of birth that makes someone `years` old (and `days` past that birthday) on the arena's clock. */
function bornAgo(A, years, days = 30) {
  const n = new Date(A.now() - days * DAY);
  return `${n.getUTCFullYear() - years}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
}
async function memberAged(A, name, years, extra = {}) {
  const u = await guest(A, name);
  await A.call('register', u, { email: `${name.toLowerCase()}@example.com`, password: 'correct horse', displayName: name, birthDate: bornAgo(A, years) }, ip());
  Object.assign(u, READY, extra); A.c.users.put(u); A.recomputeSurvey(u);
  return u;
}
async function playOut(A, a, b) {
  const { table } = await A.call('createTable', a, { gameId: GAME });
  await A.call('joinTable', b, { id: table.id }); await A.call('startTable', a, { id: table.id });
  for (const [seat, col] of [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]]) await A.bgio.submit(table.id, GAME, seat, 'drop', [col]);
  await tick(5);
  return table.id;
}

describe('dates of birth', () => {
  const now = Date.UTC(2026, 9, 2); // 2 October 2026
  it('reads a real calendar day and nothing else', () => {
    expect(parseBirthDate('2010-10-02', now)).toEqual({ y: 2010, m: 10, d: 2 });
    for (const bad of ['', '2010-13-01', '2010-02-30', '2011-02-29', '10/02/2010', '2010-1-2', '1899-12-31', '2026-10-03', null, 20101002, {}]) expect(parseBirthDate(bad, now), String(bad)).toBeNull();
    expect(parseBirthDate('2012-02-29', now)).toEqual({ y: 2012, m: 2, d: 29 });
  });
  it('counts whole years, turning over ON the birthday', () => {
    expect(ageOn({ y: 2013, m: 10, d: 2 }, now)).toBe(13);
    expect(ageOn({ y: 2013, m: 10, d: 3 }, now)).toBe(12);
    expect(ageOn({ y: 2008, m: 10, d: 2 }, now)).toBe(18);
    expect(ageOn({ y: 2008, m: 10, d: 3 }, now)).toBe(17);
    expect(adultFrom({ y: 2008, m: 10, d: 3 })).toBe(Date.UTC(2026, 9, 3));
  });
});

describe('creating an account', () => {
  it('needs a date of birth', async () => {
    const A = makeArena();
    for (const birthDate of [undefined, '', 'yesterday', '2010-02-30']) {
      const e = await err(A.call('register', null, { email: 'no@example.com', password: 'correct horse', birthDate }, ip()));
      expect(e.message).toMatch(/date of birth/);
    }
    expect(A.c.users.find((u) => u.email === 'no@example.com')).toBeFalsy();
  });

  it(`refuses anyone under ${MIN_AGE}, and keeps nothing they typed`, async () => {
    const A = makeArena();
    const g = await guest(A, 'Kid');
    const before = JSON.stringify(A.user(g.id));
    const e = await err(A.call('register', g, { email: 'kid@example.com', password: 'correct horse', displayName: 'Kid K', birthDate: bornAgo(A, 12) }, ip()));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/aged 13 and over/);
    // Still the same guest: no email, no password, no name change, no age fields.
    expect(JSON.stringify(A.user(g.id))).toBe(before);
    expect(A.c.users.find((u) => u.email === 'kid@example.com')).toBeFalsy();
    // The day before the 13th birthday is still too young; the birthday itself is not.
    expect((await err(A.call('register', null, { email: 'k2@example.com', password: 'correct horse', birthDate: bornAgo(A, 13, -1) }, ip()))).status).toBe(403);
    await A.call('register', null, { email: 'k3@example.com', password: 'correct horse', birthDate: bornAgo(A, 13, 0) }, ip());
  });

  it('never stores the date of birth: an adult is only marked as checked, an under-18 also has the day they turn 18', async () => {
    const A = makeArena();
    const adult = await memberAged(A, 'Ada', 34);
    const teen = await memberAged(A, 'Tia', 15);
    for (const u of [adult, teen]) {
      const row = A.user(u.id);
      expect(row.ageCheckedAt).toBeTruthy();
      expect(JSON.stringify(row)).not.toMatch(/birth/i);
      expect(Object.values(row).some((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v !== row.streakDay)).toBe(false);
    }
    expect(A.user(adult.id).adultAt).toBeNull();
    expect(A.user(teen.id).adultAt).toBeGreaterThan(A.now());
    expect(A.isMinor(A.user(teen.id))).toBe(true);
    expect(A.isMinor(A.user(adult.id))).toBe(false);
  });

  it('tells a member about themselves, and tells nobody else', async () => {
    const A = makeArena();
    const adult = await memberAged(A, 'Ada', 34);
    const teen = await memberAged(A, 'Tia', 15);
    const self = A.selfView(A.user(teen.id));
    expect(self.under18).toBe(true);
    expect(self.needsAge).toBe(false);
    expect(self).not.toHaveProperty('adultAt');
    // Nothing about age is on the card other people see, or on the profile page.
    const card = A.card(A.user(teen.id), A.user(adult.id));
    expect(JSON.stringify(card)).not.toMatch(/adultAt|under18|minor|ageChecked/);
    const profile = await A.call('profile', A.user(adult.id), { id: teen.id });
    expect(JSON.stringify(profile)).not.toMatch(/adultAt|under18|minor|ageChecked/);
  });

  it('the protections end by themselves on the 18th birthday', async () => {
    const A = makeArena();
    const teen = await memberAged(A, 'Tia', 17, {});
    expect(A.isMinor(A.user(teen.id))).toBe(true);
    A.advance(340 * DAY); // born 17 years and 30 days ago: 18 in 335 days
    expect(A.isMinor(A.user(teen.id))).toBe(false);
    expect(A.selfView(A.user(teen.id)).under18).toBe(false);
  });
});

describe('an adult and an under-18', () => {
  it('cannot connect, message or ask for an introduction until they have played together', async () => {
    const A = makeArena();
    const adult = await memberAged(A, 'Ada', 34, { tier: 'vip', offers: ['mentoring'], openToMentoring: 3 });
    const teen = await memberAged(A, 'Tia', 15, { tier: 'member', intent: ['mentor', 'cofounder'] });
    const [a, t] = [A.user(adult.id), A.user(teen.id)];
    expect(A.contactOk(a, t)).toBe(false);
    for (const [from, to] of [[a, t], [t, a]]) {
      expect((await err(A.call('connect', from, { userId: to.id }))).message).toMatch(/after you have played a game together/);
      // Subscribers may "message anyone": not across this line.
      expect(A.canMessage(from, to)).toBe(false);
      expect((await err(A.call('sendMessage', from, { toId: to.id, body: 'hello' }))).status).toBe(403);
      expect((await err(A.call('requestIntro', from, { userId: to.id, kind: 'cofounder', reason: 'hi' }))).message).toMatch(/after you have played a game together/);
    }
    expect(A.c.connections.all()).toHaveLength(0);
    expect(A.c.messages.filter((m) => !m.tableId && m.fromId !== 'arena')).toHaveLength(0);

    await playOut(A, a, t);
    expect(A.contactOk(a, t)).toBe(true);
    expect(await A.call('connect', a, { userId: t.id })).toEqual({ state: 'requested' });
    await A.call('answerConnection', t, { userId: a.id, accept: true });
    await A.call('sendMessage', t, { toId: a.id, body: 'Good game' });
    expect((await A.call('thread', a, { userId: t.id })).messages.map((m) => m.body)).toEqual(['Good game']);
  });

  it('two adults, or two under-18s, are not affected', async () => {
    const A = makeArena();
    const a1 = await memberAged(A, 'Ada', 34); const a2 = await memberAged(A, 'Bob', 51);
    const t1 = await memberAged(A, 'Tia', 15); const t2 = await memberAged(A, 'Uma', 16);
    expect(await A.call('connect', A.user(a1.id), { userId: a2.id })).toEqual({ state: 'requested' });
    expect(await A.call('connect', A.user(t1.id), { userId: t2.id })).toEqual({ state: 'requested' });
  });

  it('are not suggested to each other, in Matches or in the Mixer', async () => {
    const A = makeArena();
    const adult = await memberAged(A, 'Ada', 34, { tier: 'member' });
    const teen = await memberAged(A, 'Tia', 15, { tier: 'member' });
    const peer = await memberAged(A, 'Uma', 16, { tier: 'member' });
    const ids = (recs) => new Set(recs.map((r) => r.userId));
    expect(ids(A.recommend(A.user(adult.id))).has(teen.id)).toBe(false);
    expect(ids(A.recommend(A.user(teen.id))).has(adult.id)).toBe(false);
    expect(ids(A.recommend(A.user(teen.id))).has(peer.id)).toBe(true);
    for (let i = 0; i < 4; i++) {
      const { pick } = await A.call('mixer', A.user(adult.id), { mode: 'any' });
      if (pick) expect([teen.id, peer.id]).not.toContain(pick.card.id);
    }
  });

  it('a challenge still goes through, without its private note', async () => {
    const A = makeArena();
    const adult = await memberAged(A, 'Ada', 34);
    const teen = await memberAged(A, 'Tia', 15);
    const { challenge } = await A.call('challenge', A.user(adult.id), { userId: teen.id, gameId: GAME, message: 'Add me on another app' });
    expect(challenge.message).toBeNull();
    const adult2 = await memberAged(A, 'Bob', 40);
    expect((await A.call('challenge', A.user(adult.id), { userId: adult2.id, gameId: GAME, message: 'Loser buys coffee' })).challenge.message).toBe('Loser buys coffee');
  });

  it('an invite link does not connect them either, but the sign-up and the referral still work', async () => {
    const A = makeArena();
    const adult = await memberAged(A, 'Ada', 34);
    const code = A.referralCode(A.user(adult.id));
    const g = await guest(A, 'Tia');
    const r = await A.call('register', g, { email: 'tia@example.com', password: 'correct horse', displayName: 'Tia', birthDate: bornAgo(A, 15), ref: code }, ip());
    expect(r.user.under18).toBe(true);
    expect(A.user(g.id).referredBy).toBe(adult.id);
    expect(A.c.connections.all()).toHaveLength(0);
    // An adult invited the same way IS connected.
    const h = await guest(A, 'Bob');
    await A.call('register', h, { email: 'bob@example.com', password: 'correct horse', displayName: 'Bob', birthDate: bornAgo(A, 30), ref: code }, ip());
    expect(A.c.connections.all()).toHaveLength(1);
  });
});

describe('an account made before the age step existed', () => {
  async function legacy(A, name) {
    const u = await member(A, name);
    delete u.ageCheckedAt; delete u.adultAt; A.c.users.put(u);
    return u;
  }
  it('is asked once', async () => {
    const A = makeArena();
    const u = await legacy(A, 'Old');
    expect(A.selfView(A.user(u.id)).needsAge).toBe(true);
    expect((await err(A.call('confirmAge', A.user(u.id), { birthDate: 'nope' }))).message).toMatch(/date of birth/);
    const r = await A.call('confirmAge', A.user(u.id), { birthDate: bornAgo(A, 16) });
    expect(r.user.needsAge).toBe(false);
    expect(r.user.under18).toBe(true);
    // A second answer changes nothing: the first one stands.
    await A.call('confirmAge', A.user(u.id), { birthDate: bornAgo(A, 40) });
    expect(A.isMinor(A.user(u.id))).toBe(true);
    // Guests are not asked, and are not accounts.
    expect(A.selfView(await guest(A, 'G')).needsAge).toBe(false);
  });

  it('is closed and signed out if the answer is under 13; the record is kept, not deleted', async () => {
    const A = makeArena();
    const u = await legacy(A, 'Young');
    const { setSession } = await A.call('login', null, { email: 'young@example.com', password: 'correct horse' }, ip());
    expect(A.userForToken(setSession).id).toBe(u.id);
    const e = await err(A.call('confirmAge', A.user(u.id), { birthDate: bornAgo(A, 11) }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/closed/);
    expect(A.userForToken(setSession)).toBeNull();
    expect((await err(A.call('login', null, { email: 'young@example.com', password: 'correct horse' }, ip()))).message).toMatch(/closed/);
    expect(A.user(u.id)).toBeTruthy();
    expect(A.user(u.id).closed).toBe('age');
  });
});
