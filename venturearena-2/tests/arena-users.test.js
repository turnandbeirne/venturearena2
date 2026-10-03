// Identity: guests, accounts, sessions, profiles, the access ladder, points,
// streaks, referrals, photos and location. Everything runs against an
// in-memory arena with an injected clock.
import { isGuestName } from '../src/shared/profile.js';
import { GUESTS_PER_HOUR } from '../src/server/arena/users.js';
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member, playToEnd, tick } from './helpers.js';
import {
  SCENARIOS, scoreCardSort, surveyScore, surveyBonusTier, SURVEY_PARTS, PROFILE_GATE, INTEREST_TAGS, AVATARS, PROMPTS,
} from '../src/shared/profile.js';
import { FEATURES, HOST_LIMIT, TIERS, tierAllows } from '../src/shared/tiers.js';

const DAY = 86400000;
const HOUR = 3600000;

/** An arena whose clock sits at the next UTC noon, so "+3 hours" never crosses a day. */
function arena(config) {
  const A = makeArena(config);
  A.advance((Math.floor(A.now() / DAY) + 1) * DAY + 12 * HOUR - A.now());
  return A;
}
const ip = () => ({ ip: `ip-${Math.random()}` });
/** A profile that scores 90: everything except skills and a social link. */
const READY = { colorRanks: ['teal'], archetype: 'builder', headline: 'I build tools', stage: 'revenue', industry: 'SaaS', intent: ['peers'], goals: 'Reach 100 customers', currentProject: 'A billing tool' };
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };

describe('guests and accounts', () => {
  it('a guest is one click: a session, a starter avatar, no form', async () => {
    const A = arena();
    const r = await A.call('guest', null, {}, ip());
    expect(r.setSession).toMatch(/^[0-9a-f]{64}$/);
    expect(r.user.isGuest).toBe(true);
    expect(isGuestName(r.user.displayName)).toBe(true); // a generated name, so two guests at a table can tell each other apart
    expect(r.user.displayName).not.toBe('Guest');
    expect(r.user.username).toMatch(/^guest_[0-9a-f]{6}$/);
    expect(AVATARS.slice(0, 12)).toContain(r.user.avatar);
    expect(A.userForToken(r.setSession).id).toBe(r.user.id);
    // Asking again with a session returns the same person and no new cookie.
    const again = await A.call('guest', A.user(r.user.id), {}, ip());
    expect(again.user.id).toBe(r.user.id);
    expect(again.setSession).toBeUndefined();
  });

  it('registering upgrades the guest IN PLACE: same id, history kept, and a fresh session', async () => {
    const A = arena();
    const g = await A.call('guest', null, {}, ip());
    const me = A.user(g.user.id);
    const { table } = await A.call('playBots', me, { gameId: 'fourinarow' });
    await playToEnd(A, table.id); await tick(20);
    await A.call('checkin', me);
    const before = { games: me.stats.games, points: me.points, streak: me.streak };
    expect(before.games).toBe(1);

    const r = await A.call('register', me, { email: 'Ada@Example.com ', password: 'correct horse', displayName: 'Ada' }, { ...ip(), token: g.setSession });
    expect(r.user.id).toBe(g.user.id);
    // The guest cookie stops working and the account gets a session of its own.
    expect(r.setSession).toMatch(/^[0-9a-f]{64}$/);
    expect(r.setSession).not.toBe(g.setSession);
    expect(A.userForToken(g.setSession)).toBe(null);
    expect(A.userForToken(r.setSession).id).toBe(g.user.id);
    expect(r.user.isGuest).toBe(false);
    expect(r.user.email).toBe('ada@example.com');
    expect(r.user.displayName).toBe('Ada');
    expect(r.user.username).toBe('ada');
    expect(me.stats.games).toBe(before.games);
    expect(me.streak).toBe(before.streak);
    expect(me.points).toBeGreaterThanOrEqual(before.points);
    expect(A.c.results.count((x) => x.userId === me.id)).toBe(1);
    expect(A.c.users.count((u) => u.email === 'ada@example.com')).toBe(1);
  });

  it('registering without a session creates an account and a session', async () => {
    const A = arena();
    const r = await A.call('register', null, { email: 'bo@example.com', password: 'longenough' }, ip());
    expect(r.setSession).toBeTruthy();
    expect(r.user.displayName).toBe('bo'); // the email's local part
    expect(A.userForToken(r.setSession).id).toBe(r.user.id);
  });

  it('refuses a duplicate email (any case), a bad email and a short password', async () => {
    const A = arena();
    await member(A, 'Ada');
    expect((await err(A.call('register', null, { email: 'ADA@example.com', password: 'another one' }, ip()))).message).toMatch(/already an account/);
    expect((await err(A.call('register', null, { email: 'not-an-email', password: 'another one' }, ip()))).message).toMatch(/email/);
    expect((await err(A.call('register', null, { email: 'x@example.com', password: 'short' }, ip()))).message).toMatch(/8 characters/);
    expect((await err(A.call('register', null, { email: 'x@example.com', password: 12345678 }, ip()))).message).toMatch(/8 characters/);
    expect(A.c.users.count((u) => !u.isBot)).toBe(1);
  });

  it('usernames are unique: the second "Ada" becomes ada2', async () => {
    const A = arena();
    await A.call('register', null, { email: 'a1@example.com', password: 'correct horse', displayName: 'Ada' }, ip());
    const r = await A.call('register', null, { email: 'a2@example.com', password: 'correct horse', displayName: 'Ada' }, ip());
    expect(r.user.username).toBe('ada2');
  });

  it('login, logout and a wrong password', async () => {
    const A = arena();
    const ada = await member(A, 'Ada');
    const bad = await err(A.call('login', null, { email: 'ada@example.com', password: 'wrong horse' }, ip()));
    expect(bad.status).toBe(401);
    const nobody = await err(A.call('login', null, { email: 'nobody@example.com', password: 'correct horse' }, ip()));
    expect(nobody.status).toBe(401);
    expect(nobody.message).toBe(bad.message); // the answer does not say which half was wrong
    // A guest has no password: an empty email must never match one.
    await guest(A);
    expect((await err(A.call('login', null, { email: '', password: '' }, ip()))).status).toBe(401);
    expect((await err(A.call('login', null, {}, ip()))).status).toBe(401);

    const r = await A.call('login', null, { email: ' ADA@example.com', password: 'correct horse' }, ip());
    expect(A.userForToken(r.setSession).id).toBe(ada.id);
    const out = await A.call('logout', ada, {}, { ip: 'x', token: r.setSession });
    expect(out.clearSession).toBe(true);
    expect(A.userForToken(r.setSession)).toBe(null);
  });

  it('sessions are stored hashed and expire after 180 days', async () => {
    const A = arena();
    const r = await A.call('guest', null, {}, ip());
    expect(A.c.sessions.get(r.setSession)).toBeUndefined(); // the raw token is never a key
    expect(JSON.stringify(A.c.sessions.all())).not.toContain(r.setSession);
    A.advance(179 * DAY);
    expect(A.userForToken(r.setSession).id).toBe(r.user.id);
    A.advance(2 * DAY);
    expect(A.userForToken(r.setSession)).toBe(null);
    expect(A.c.sessions.size).toBe(0);
    for (const junk of [null, undefined, '', 42, {}, 'nope']) expect(A.userForToken(junk)).toBe(null);
  });

  it('every handler except the public ones needs a session', async () => {
    const A = arena();
    for (const name of Object.keys(A.rpc)) {
      if (A.publicRpc.has(name)) continue;
      const e = await err(A.call(name, null, {}));
      expect(e.status, name).toBe(401);
    }
    expect([...A.publicRpc].sort()).toEqual(['games', 'guest', 'login', 'me', 'register', 'requestPasswordReset', 'resetPassword', 'verifyEmail']);
    expect((await err(A.call('__proto__', null, {}))).status).toBe(404);
    expect((await err(A.call('constructor', null, {}))).status).toBe(404);
    expect((await A.call('me', null, {})).user).toBe(null);
  });
});

describe('secrets never leave the server', () => {
  it('selfView has no password, verify token or coordinates; a card has no contact details at all', async () => {
    const A = arena();
    const mails = [];
    A.mailer = async (m) => { mails.push(m); };
    const r = await A.call('register', null, { email: 'ada@example.com', password: 'correct horse', displayName: 'Ada' }, ip());
    const ada = A.user(r.user.id);
    expect(ada.verifyToken).toBeTruthy();
    Object.assign(ada, READY, { phone: '+1 555 0100', city: 'Kansas City', region: 'MO', timezone: 'America/Chicago', stripeCustomerId: 'cus_123', referredBy: 'someone' });
    A.c.users.put(ada);
    await A.call('setLocation', ada, { share: true, lat: 39.0997, lon: -94.5786 });
    A.referralCode(ada);

    const self = JSON.stringify(A.selfView(ada));
    expect(self).not.toContain(ada.pass.hash);
    expect(self).not.toContain(ada.pass.salt);
    expect(self).not.toContain(ada.verifyToken);
    expect(self).not.toContain('"pass"');
    expect(self).not.toContain('"loc"');
    expect(self).not.toContain('39.1');
    expect(JSON.stringify(r)).not.toContain(ada.verifyToken);
    expect(A.selfView(ada).hasLocation).toBe(true);

    const bob = await member(A, 'Bob', { ...READY, tier: 'ceo', emailVerified: true });
    expect(A.canSeeBios(bob)).toBe(true);
    for (const viewer of [ada, bob, await guest(A), null]) {
      const card = A.card(ada, viewer);
      const text = JSON.stringify(card);
      for (const secret of [ada.email, ada.phone, ada.pass.hash, ada.pass.salt, ada.verifyToken, ada.referralCode, 'cus_123', 'someone', 'America/Chicago', '39.1', '-94.58']) {
        expect(text, `card leaked ${secret}`).not.toContain(secret);
      }
      for (const key of ['email', 'phone', 'pass', 'verifyToken', 'loc', 'referralCode', 'referredBy', 'stripeCustomerId', 'timezone', 'tierExpiresAt', 'cardSort']) {
        expect(card, key).not.toHaveProperty(key);
      }
    }
    // The same holds for every rpc that returns other people.
    const ws = [await A.call('profile', bob, { id: ada.id }), await A.call('people', bob, {}), await A.call('online', bob, {}), await A.call('lobby', bob, {}), await A.call('findByEmail', bob, { email: 'ada@example.com' })];
    for (const w of ws) for (const secret of [ada.email, ada.phone, ada.pass.hash, ada.verifyToken, ada.referralCode]) expect(JSON.stringify(w)).not.toContain(secret);
  });
});

describe('email verification', () => {
  it('with a mail provider: unverified until the link is used; resend is rate limited', async () => {
    const A = arena();
    const mails = [];
    A.mailer = async (m) => { mails.push(m); };
    const r = await A.call('register', null, { email: 'ada@example.com', password: 'correct horse' }, ip());
    const ada = A.user(r.user.id);
    expect(r.user.emailVerified).toBe(false);
    expect(r.user.access.level).toBe('unverified');
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toBe('ada@example.com');
    const token = /token=([0-9a-f]+)/.exec(mails[0].text)[1];
    expect(mails[0].text).toContain('http://test/verify?token=');

    expect((await err(A.call('verifyEmail', null, { token: 'f'.repeat(48) }))).message).toMatch(/expired/);
    expect((await err(A.call('verifyEmail', null, { token: '' }))).message).toMatch(/expired/);
    expect((await err(A.call('verifyEmail', null, {}))).message).toMatch(/expired/);
    expect(ada.emailVerified).toBe(false);

    await A.call('resendVerification', ada);
    expect(mails).toHaveLength(2);
    const token2 = /token=([0-9a-f]+)/.exec(mails[1].text)[1];
    expect(token2).not.toBe(token);
    expect((await err(A.call('verifyEmail', null, { token }))).message).toMatch(/expired/); // the old link is dead
    await A.call('resendVerification', ada);
    await A.call('resendVerification', ada);
    expect((await err(A.call('resendVerification', ada))).status).toBe(429);

    const token4 = /token=([0-9a-f]+)/.exec(mails[mails.length - 1].text)[1];
    expect((await A.call('verifyEmail', null, { token: token4 })).ok).toBe(true);
    expect(ada.emailVerified).toBe(true);
    expect(ada.verifyToken).toBe(null);
    expect((await err(A.call('verifyEmail', null, { token: token4 }))).message).toMatch(/expired/); // single use
    // A member with no token must not be "verified" by a null/empty lookup.
    const g = await guest(A);
    expect((await err(A.call('verifyEmail', null, { token: null }))).message).toMatch(/expired/);
    expect(g.emailVerified).toBe(false);
  });

  it('without a mail provider nobody could ever click a link, so the account is verified at once', async () => {
    const A = arena();
    const r = await A.call('register', null, { email: 'ada@example.com', password: 'correct horse' }, ip());
    expect(r.user.emailVerified).toBe(true);
    expect(r.user.access.level).toBe('verified');
  });

  it('a mail provider that throws does not fail the registration', async () => {
    const A = arena();
    A.mailer = async () => { throw new Error('provider down'); };
    const r = await A.call('register', null, { email: 'ada@example.com', password: 'correct horse' }, ip());
    expect(r.user.isGuest).toBe(false);
    expect(r.user.emailVerified).toBe(false);
  });
});

describe('saving a profile', () => {
  it('caps every text field and strips control characters', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const long = 'x'.repeat(5000);
    const r = await A.call('saveProfile', me, { displayName: long, headline: long, bio: long, industry: long, lookingFor: long, goals: long, currentProject: long, city: long, region: long, phone: long, timezone: long });
    const u = r.user;
    expect(u.displayName).toHaveLength(40);
    expect(u.headline).toHaveLength(120);
    expect(u.bio).toHaveLength(600);
    expect(u.industry).toHaveLength(60);
    expect(u.lookingFor).toHaveLength(160);
    expect(u.goals).toHaveLength(300);
    expect(u.currentProject).toHaveLength(200);
    expect(u.city).toHaveLength(60);
    expect(u.region).toHaveLength(60);
    expect(u.phone).toHaveLength(30);
    expect(u.timezone).toHaveLength(60);
    const c = await A.call('saveProfile', me, { headline: '  hi\u0000 the\u0007re \n', displayName: '   ' });
    expect(c.user.headline).toBe('hi there');
    expect(c.user.displayName).toBe('x'.repeat(40)); // a blank name keeps the old one
    // Non-strings never become text.
    const n = await A.call('saveProfile', me, { headline: { toString: () => 'boom' }, goals: 42, bio: ['a'] });
    expect(n.user.headline).toBe('');
    expect(n.user.goals).toBe('');
    expect(n.user.bio).toBe('');
  });

  it('keeps only values from the allowed lists', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const r = await A.call('saveProfile', me, {
      colorRanks: ['teal', 'nope', 'teal', 'gold', 'plum', 'rose'],
      interests: ['AI', 'Not a tag', 'SaaS', 'AI', ...INTEREST_TAGS],
      intent: ['mentor', 'world domination', 'peers', 'play', 'cofounder', 'investor'],
      offers: ['mentoring', 'bribes', 'investing'],
      stage: 'unicorn', avatar: '<img src=x>',
      skills: 'sales, , Sales, pricing,' + Array.from({ length: 20 }, (_, i) => `skill${i}`).join(',') + ',' + 'y'.repeat(80),
      openToMentoring: 99,
    });
    const u = r.user;
    expect(u.colorRanks).toEqual(['teal', 'gold', 'plum']);
    expect(u.interests).toHaveLength(8);
    expect(u.interests.slice(0, 2)).toEqual(['AI', 'SaaS']);
    for (const i of u.interests) expect(INTEREST_TAGS).toContain(i);
    expect(u.intent).toEqual(['mentor', 'peers', 'play', 'cofounder']);
    expect(u.offers).toEqual(['mentoring', 'investing']);
    expect(u.stage).toBe(null);
    expect(AVATARS).toContain(u.avatar);
    expect(u.skills).toHaveLength(12);
    expect(u.skills.slice(0, 3)).toEqual(['sales', 'Sales', 'pricing']);
    for (const s of u.skills) expect(s.length).toBeLessThanOrEqual(30);
    expect(u.openToMentoring).toBe(10);
    expect((await A.call('saveProfile', me, { stage: 'scaling', avatar: AVATARS[20], skills: ['a', 'b'], openToMentoring: -3 })).user).toMatchObject({ stage: 'scaling', avatar: AVATARS[20], skills: ['a', 'b'], openToMentoring: 0 });
    // Lists that are not lists are ignored rather than crashing.
    expect((await A.call('saveProfile', me, { interests: 'AI', intent: { 0: 'mentor' }, colorRanks: null })).user).toMatchObject({ interests: [], intent: [], colorRanks: [] });
  });

  it('mentoring capacity is a whole number of people', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    expect((await A.call('saveProfile', me, { openToMentoring: 2.7 })).user.openToMentoring).toBe(2);
    expect((await A.call('saveProfile', me, { openToMentoring: 0.4 })).user.openToMentoring).toBe(0);
    expect((await A.call('saveProfile', me, { openToMentoring: 'lots' })).user.openToMentoring).toBe(0);
    expect((await A.call('saveProfile', me, { openToMentoring: '3' })).user.openToMentoring).toBe(3);
  });

  it('normalises social links and drops unknown networks', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const r = await A.call('saveProfile', me, { socialLinks: { linkedin: 'linkedin.com/in/ada', x: '@ada', instagram: '   ', website: 'HTTP://ada.dev/a', youtube: 'https://youtube.com/@ada', myspace: 'https://myspace.com/ada', __proto__: { polluted: 'yes' } } });
    expect(r.user.socialLinks).toEqual({ linkedin: 'https://linkedin.com/in/ada', x: 'https://ada', website: 'HTTP://ada.dev/a', youtube: 'https://youtube.com/@ada' });
    // A script URL can never be stored as a link: anything without http(s) gets https:// in front.
    const s = await A.call('saveProfile', me, { socialLinks: { website: 'javascript:alert(1)', x: 'x'.repeat(500) } });
    expect(s.user.socialLinks.website).toBe('https://javascript:alert(1)');
    expect(s.user.socialLinks.x.length).toBeLessThanOrEqual(208);
    for (const v of Object.values(s.user.socialLinks)) expect(v).toMatch(/^https?:\/\//i);
    expect(({}).polluted).toBeUndefined();
    // Not an object: left alone.
    expect((await A.call('saveProfile', me, { socialLinks: 'https://x.com/a' })).user.socialLinks).toEqual(s.user.socialLinks);
    expect((await A.call('saveProfile', me, { socialLinks: {} })).user.socialLinks).toEqual({});
  });

  it('prompts: two at most, questions from the bank, blank answers dropped', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const r = await A.call('saveProfile', me, { prompts: [{ q: 'made up?', a: 'a'.repeat(300) }, null, { q: PROMPTS[2], a: 'x' }, { q: PROMPTS[1], a: 'third' }] });
    expect(r.user.prompts).toEqual([{ q: PROMPTS[0], a: 'a'.repeat(140) }]);
    expect((await A.call('saveProfile', me, { prompts: [{ q: PROMPTS[2], a: 'x' }, { q: PROMPTS[1], a: 'y' }] })).user.prompts).toEqual([{ q: PROMPTS[2], a: 'x' }, { q: PROMPTS[1], a: 'y' }]);
  });

  it('usernames: lower-case letters, digits and underscore, at least 3, unique', async () => {
    const A = arena();
    const ada = await member(A, 'Ada'); const bob = await member(A, 'Bob');
    expect((await A.call('saveProfile', ada, { username: 'Ada_Lovelace!!' })).user.username).toBe('ada_lovelace');
    expect((await err(A.call('saveProfile', bob, { username: 'ADA_lovelace' }))).message).toMatch(/taken/);
    expect((await err(A.call('saveProfile', bob, { username: 'ab' }))).message).toMatch(/at least 3/);
    expect((await err(A.call('saveProfile', bob, { username: 'venturearena' }))).message).toMatch(/taken/); // the arena's own account
    expect((await A.call('saveProfile', bob, { username: '!!!' })).user.username).toBe('bob'); // nothing usable: unchanged
  });

  it('only changes the fields that were sent, and never tier, points or reputation', async () => {
    const A = arena();
    const me = await member(A, 'Ada', READY);
    const before = { points: me.points, tier: me.tier };
    const r = await A.call('saveProfile', me, { bio: 'hello', tier: 'ceo', points: 99999, isGuest: false, emailVerified: true, reputation: { score: 9999 }, email: 'evil@example.com', pass: null, surveyScore: 100, id: 'arena', stats: { games: 500 } });
    expect(r.user.bio).toBe('hello');
    expect(r.user.headline).toBe(READY.headline);
    expect(me.tier).toBe(before.tier);
    expect(me.points).toBe(before.points);
    expect(me.reputation.score).toBe(100);
    expect(me.email).toBe('ada@example.com');
    expect(me.pass).toBeTruthy();
    expect(me.stats.games).toBe(0);
    expect(A.user(me.id)).toBe(me);
  });
});

describe('the business-savvy card sort', () => {
  it('eight answers in, an archetype and a DNA out', async () => {
    const A = arena();
    const me = await member(A, 'Ada', { stage: 'scaling' });
    const picks = [1, 2, 2, 0, 0, 2, 1, 1]; // builder-heavy
    const expected = scoreCardSort(picks);
    expect(expected.archetype).toBe('builder');
    const r = await A.call('cardSort', me, { picks });
    expect(r.result).toEqual(expected);
    expect(r.user.archetype).toBe('builder');
    expect(r.user.dna).toEqual({ risk: expected.risk, pace: expected.pace, collab: expected.collab, sophistication: 4 });
    expect(me.cardSort).toEqual(picks);
  });

  it('the DNA follows the stage when the stage is set AFTER the sort (the order onboarding asks in)', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    await A.call('cardSort', me, { picks: [1, 2, 2, 0, 0, 2, 1, 1] }); // onboarding step 2: no stage yet
    expect(me.dna.sophistication).toBe(1);
    const r = await A.call('saveProfile', me, { stage: 'scaling' }); // onboarding step 3
    expect(r.user.dna).toMatchObject({ sophistication: 4, risk: me.dna.risk, pace: me.dna.pace, collab: me.dna.collab });
    expect((await A.call('saveProfile', me, { stage: 'exited' })).user.dna.sophistication).toBe(5);
    // Someone who never did the sort has no DNA to update.
    const other = await member(A, 'Bob');
    expect((await A.call('saveProfile', other, { stage: 'revenue' })).user.dna).toEqual({});
  });

  it('scoreCardSort: all-analyst answers make an analyst who is careful and deliberate', () => {
    const r = scoreCardSort([2, 1, 1, 1, 1, 0, 0, 2]);
    expect(r.archetype).toBe('analyst');
    expect(r.scores.analyst).toBeGreaterThan(r.scores.builder);
    expect(r.risk).toBe(2);
    expect(r.pace).toBeLessThanOrEqual(3);
    for (const k of ['risk', 'pace']) { expect(r[k]).toBeGreaterThanOrEqual(1); expect(r[k]).toBeLessThanOrEqual(5); }
    expect(['solo', 'dealmaker', 'team']).toContain(r.collab);
    // Defaults when nothing is answered.
    expect(scoreCardSort([])).toMatchObject({ risk: 3, pace: 3 });
  });

  it("the member's own choice of label wins over the computed one", async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const picks = [1, 2, 2, 0, 0, 2, 1, 1];
    const r = await A.call('cardSort', me, { picks, archetype: 'backer' });
    expect(r.result.archetype).toBe('builder');
    expect(r.user.archetype).toBe('backer');
    // An unknown label falls back to the computed one.
    expect((await A.call('cardSort', me, { picks, archetype: 'wizard' })).user.archetype).toBe('builder');
    expect((await A.call('cardSort', me, { picks, archetype: 'constructor' })).user.archetype).toBe('builder');
  });

  it('refuses an incomplete or out-of-range sort', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const full = SCENARIOS.map(() => 0);
    for (const picks of [undefined, 'abc', [], full.slice(1), [...full, 0], full.map((x, i) => (i === 3 ? 3 : x)), full.map((x, i) => (i === 3 ? -1 : x)), full.map((x, i) => (i === 3 ? 1.5 : x)), full.map((x, i) => (i === 3 ? 'length' : x)), full.map((x, i) => (i === 3 ? null : x))]) {
      const e = await err(A.call('cardSort', me, { picks }));
      expect(e.message, JSON.stringify(picks)).toMatch(/every scenario/);
    }
    expect(me.archetype).toBe(null);
  });
});

describe('profile completion (survey score) and its bonus', () => {
  it('each part is worth what the table says and the parts total 100', () => {
    expect(SURVEY_PARTS.reduce((a, p) => a + p.points, 0)).toBe(100);
    const u = { displayName: 'Guest', colorRanks: [], socialLinks: {} };
    expect(surveyScore(u)).toBe(0);
    const steps = [
      [{ displayName: 'Ada' }, 0],                 // a name alone is not "identity"
      [{ colorRanks: ['teal'] }, 10],
      [{ archetype: 'builder' }, 25],
      [{ headline: '  ' }, 25],                   // blank does not count
      [{ headline: 'Hi' }, 35],
      [{ stage: 'idea' }, 45],
      [{ interests: ['AI'] }, 55],                 // industry OR interests
      [{ industry: 'SaaS' }, 55],
      [{ lookingFor: 'a cofounder' }, 70],         // intent OR lookingFor
      [{ intent: ['mentor'] }, 70],
      [{ goals: 'grow' }, 80],
      [{ currentProject: 'a tool' }, 90],
      [{ skills: ['sales'] }, 95],
      [{ socialLinks: { x: 'https://x.com/a' } }, 100],
    ];
    for (const [patch, score] of steps) { Object.assign(u, patch); expect(surveyScore(u), JSON.stringify(patch)).toBe(score); }
    // Contact details, a photo and a location earn nothing.
    expect(surveyScore({ displayName: 'Guest', phone: '555', city: 'KC', region: 'MO', photoId: 'p', shareLocation: true, email: 'a@b.co' })).toBe(0);
    expect([0, 49, 50, 79, 80, 99, 100].map(surveyBonusTier)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });

  it('only the placeholder names "Guest" and "Player" fail the identity part, not real names that start that way', () => {
    const base = { colorRanks: ['teal'] };
    for (const name of ['Guest', 'guest', 'Player', 'PLAYER']) expect(surveyScore({ ...base, displayName: name }), name).toBe(0);
    for (const name of ['Guestav Holm', 'Playerson', 'Ada']) expect(surveyScore({ ...base, displayName: name }), name).toBe(10);
  });

  it('pays 50 points at 50%, 80% and 100%, once each, never clawed back', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const start = me.points;
    expect(me.surveyScore).toBe(0);
    const save = (args) => A.call('saveProfile', me, args);
    expect((await save({ colorRanks: ['teal'], headline: 'Hi', stage: 'idea', industry: 'SaaS' })).bonus).toBe(0); // 40
    expect(me.surveyScore).toBe(40);
    expect((await save({ goals: 'grow' })).bonus).toBe(50); // 50
    expect(me.points - start).toBe(50);
    expect((await save({ goals: 'grow more' })).bonus).toBe(0);
    // Dropping below and crossing again pays nothing.
    expect((await save({ goals: '' })).bonus).toBe(0);
    expect(me.surveyScore).toBe(40);
    expect(me.points - start).toBe(50);
    expect((await save({ goals: 'grow' })).bonus).toBe(0);
    // Jumping two tiers at once pays both.
    expect((await save({ intent: ['peers'], currentProject: 'a tool', skills: ['sales'], socialLinks: { x: 'x.com/a' } })).bonus).toBe(50); // 85: the 80% tier
    expect(me.surveyBonus).toBe(2);
    expect(me.points - start).toBe(100);
  });

  it('bonus tiers: 0 to 2 pays 100, then 100% pays the last 50, 150 for life', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const start = me.points;
    const r = await A.call('saveProfile', me, { colorRanks: ['teal'], headline: 'Hi', stage: 'idea', industry: 'SaaS', intent: ['peers'], goals: 'grow', currentProject: 'a tool', skills: ['sales'] });
    expect(r.user.surveyScore).toBe(80);
    expect(r.bonus).toBe(100);
    const picks = SCENARIOS.map(() => 0);
    const c = await A.call('cardSort', me, { picks });
    expect(c.user.surveyScore).toBe(95);
    expect(c.bonus).toBe(0);
    const l = await A.call('saveProfile', me, { socialLinks: { website: 'ada.dev' } });
    expect(l.user.surveyScore).toBe(100);
    expect(l.bonus).toBe(50);
    expect(me.points - start).toBe(150);
    expect(me.surveyBonus).toBe(3);
    const rows = A.c.points.filter((p) => p.userId === me.id && p.kind === 'survey');
    expect(rows.map((x) => x.points).sort()).toEqual([100, 50]);
    await A.call('saveProfile', me, { socialLinks: {} });
    await A.call('saveProfile', me, { socialLinks: { website: 'ada.dev' } });
    expect(me.points - start).toBe(150);
  });

  it('a guest is never paid the bonus; it arrives when they register', async () => {
    const A = arena();
    const g = await guest(A);
    const r = await A.call('saveProfile', g, { displayName: 'Ada', colorRanks: ['teal'], headline: 'Hi', stage: 'idea', industry: 'SaaS', intent: ['peers'], goals: 'grow' });
    expect(r.user.surveyScore).toBe(65);
    expect(r.bonus).toBe(0);
    expect(g.points).toBe(0);
    expect(g.surveyBonus).toBe(0);
    await A.call('register', g, { email: 'ada@example.com', password: 'correct horse' }, ip());
    expect(g.points).toBe(50);
    expect(g.surveyBonus).toBe(1);
  });
});

describe('the access ladder', () => {
  it('anonymous, unverified, verified, ready', async () => {
    const A = arena();
    A.mailer = async () => {};
    const g = await guest(A);
    expect(A.access(g)).toMatchObject({ tier: 'anonymous', level: 'anonymous', canSeeBios: false, hostLimit: 1 });
    await A.call('register', g, { email: 'ada@example.com', password: 'correct horse', displayName: 'Ada' }, ip());
    expect(A.access(g)).toMatchObject({ tier: 'free', level: 'unverified', canSeeBios: false });
    // A complete profile is not enough without a confirmed email...
    Object.assign(g, READY); A.recomputeSurvey(g);
    expect(g.surveyScore).toBeGreaterThanOrEqual(PROFILE_GATE);
    expect(A.access(g)).toMatchObject({ level: 'unverified', canSeeBios: false });
    await A.call('verifyEmail', null, { token: g.verifyToken });
    expect(A.access(g)).toMatchObject({ level: 'ready', canSeeBios: true });
    // ...and a confirmed email is not enough without the profile.
    g.goals = ''; g.currentProject = ''; g.headline = ''; A.recomputeSurvey(g);
    expect(g.surveyScore).toBeLessThan(PROFILE_GATE);
    expect(A.access(g)).toMatchObject({ level: 'verified', canSeeBios: false });
    expect(A.canSeeBios(null)).toBe(false);
    expect(A.canSeeBios(undefined)).toBe(false);
  });

  it('exactly 70% opens bios; 69 does not', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    me.surveyScore = 69; expect(A.canSeeBios(me)).toBe(false);
    me.surveyScore = 70; expect(A.canSeeBios(me)).toBe(true);
    expect(A.access(me).level).toBe('ready');
  });

  it('paid tiers sit on top: features and host limits by tier', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    expect(TIERS).toEqual(['anonymous', 'free', 'member', 'vip', 'ceo']);
    expect(HOST_LIMIT).toEqual({ anonymous: 1, free: 1, member: 3, vip: 10, ceo: 100 });
    const expectOn = {
      free: ['play', 'host_table', 'table_chat', 'daily_quiz', 'keep_history', 'player_card', 'connect', 'topic_reply', 'invite', 'dm_connections', 'post_ask'],
      member: ['private_table', 'full_history', 'view_style', 'dm_anyone', 'mentor_match', 'cofounder_match', 'full_lessons', 'custom_settings', 'unlimited_challenges', 'post_offer'],
      vip: ['investor_match', 'head_to_head', 'post_venture_call', 'saved_presets'],
      ceo: ['vouch', 'featured', 'curated_intros'],
    };
    let on = [];
    for (const tier of ['free', 'member', 'vip', 'ceo']) {
      on = [...on, ...expectOn[tier]];
      me.tier = tier;
      const a = A.access(me);
      expect(a.tier).toBe(tier);
      expect(a.hostLimit).toBe(HOST_LIMIT[tier]);
      for (const f of Object.keys(FEATURES)) {
        if (f === 'custom_settings') continue; // open to all until billing is live
        expect(a.features[f], `${tier}:${f}`).toBe(on.includes(f));
      }
    }
    // A guest plays, hosts, chats and takes the quiz, and nothing else.
    const g = await guest(A);
    const ga = A.access(g);
    for (const f of Object.keys(FEATURES)) if (f !== 'custom_settings') expect(ga.features[f], f).toBe(['play', 'host_table', 'table_chat', 'daily_quiz'].includes(f));
    expect(tierAllows('ceo', 'no_such_feature')).toBe(false);
    expect(tierAllows('no_such_tier', 'play')).toBe(false);
  });

  it('custom settings stay open until GATE_CUSTOM_SETTINGS turns the paywall on', async () => {
    const open = arena(); const gated = arena({ gateCustomSettings: true });
    expect(open.access(await guest(open)).features.custom_settings).toBe(true);
    expect(gated.access(await guest(gated)).features.custom_settings).toBe(false);
    expect(gated.access(await member(gated, 'Sub', { tier: 'member' })).features.custom_settings).toBe(true);
  });

  it('a lapsed plan is Registered again; an unknown tier is Registered', async () => {
    const A = arena();
    const me = await member(A, 'Ada', { tier: 'vip' });
    me.tierExpiresAt = A.now() + DAY;
    expect(A.tier(me)).toBe('vip');
    A.advance(DAY + 1);
    expect(A.tier(me)).toBe('free');
    expect(A.allows(me, 'private_table')).toBe(false);
    me.tierExpiresAt = null; me.tier = 'platinum';
    expect(A.tier(me)).toBe('free');
    for (const weird of ['__proto__', 'constructor', 'toString', 'anonymous', '', null, undefined]) {
      me.tier = weird;
      expect(A.tier(me), String(weird)).toBe('free');
      expect(A.access(me).hostLimit).toBe(1);
    }
    expect(A.tier(null)).toBe('anonymous');
    expect(() => A.need(me, 'vouch')).toThrow(/higher membership/);
  });
});

describe('what one member may see of another (card gating)', () => {
  async function setup() {
    const A = arena();
    const ada = await member(A, 'Ada', { ...READY, skills: ['sales'], socialLinks: { x: 'https://x.com/ada' }, bio: 'Long bio', lookingFor: 'a designer', prompts: [{ q: PROMPTS[0], a: 'Hiring' }], city: 'Kansas City', region: 'MO', dna: { risk: 4, pace: 2, collab: 'team' }, persona: { label: 'Builder', risk: 50, counts: {}, games: 3 }, playStyle: 'Builder: steady' });
    return { A, ada };
  }
  const BIO = ['headline', 'industry', 'lookingFor', 'goals', 'currentProject', 'skills', 'socialLinks', 'bio', 'prompts', 'city', 'region'];
  const STYLE = ['dna', 'persona', 'playStyle'];

  it('bio fields: only for a verified viewer with a 70% profile, or yourself', async () => {
    const { A, ada } = await setup();
    const g = await guest(A);
    const thin = await member(A, 'Thin');
    const ready = await member(A, 'Ready', READY);
    for (const viewer of [g, thin, null]) {
      const card = A.card(ada, viewer);
      expect(card.locked).toBe(true);
      for (const k of BIO) expect(card, k).not.toHaveProperty(k);
      expect(JSON.stringify(card)).not.toContain('I build tools');
      expect(JSON.stringify(card)).not.toContain('Kansas City');
    }
    const open = A.card(ada, ready);
    expect(open.locked).toBe(false);
    expect(open).toMatchObject({ headline: 'I build tools', industry: 'SaaS', lookingFor: 'a designer', goals: READY.goals, currentProject: READY.currentProject, skills: ['sales'], bio: 'Long bio' });
    const self = A.card(ada, ada);
    expect(self.locked).toBe(false);
    for (const k of [...BIO, ...STYLE]) expect(self, k).toHaveProperty(k);
    // The basics are always there.
    for (const viewer of [g, thin, ready]) expect(A.card(ada, viewer)).toMatchObject({ id: ada.id, displayName: 'Ada', username: 'ada', tier: 'free', isGuest: false, verified: true, rating: 1200, games: 0, reputation: 100, rank: 'Rookie', personaLabel: 'Builder' });
    expect(A.card(null, ready)).toBe(null);
  });

  it('city and region show only while the owner shares location', async () => {
    const { A, ada } = await setup();
    const ready = await member(A, 'Ready', READY);
    expect(A.card(ada, ready)).toMatchObject({ city: '', region: '' });
    await A.call('setLocation', ada, { share: true, lat: 39.1, lon: -94.58 });
    expect(A.card(ada, ready)).toMatchObject({ city: 'Kansas City', region: 'MO' });
    await A.call('setLocation', ada, { share: false });
    expect(A.card(ada, ready)).toMatchObject({ city: '', region: '' });
  });

  it('style fields (DNA, persona, play style): only for Subscribers, or yourself', async () => {
    const { A, ada } = await setup();
    const ready = await member(A, 'Ready', READY);
    const sub = await member(A, 'Sub', { tier: 'member' });       // paid, thin profile
    const lapsed = await member(A, 'Lapsed', { ...READY, tier: 'vip', tierExpiresAt: A.now() - 1 });
    for (const viewer of [ready, lapsed, await guest(A)]) for (const k of STYLE) expect(A.card(ada, viewer), k).not.toHaveProperty(k);
    const c = A.card(ada, sub);
    expect(c.dna).toEqual({ risk: 4, pace: 2, collab: 'team' });
    expect(c.persona.label).toBe('Builder');
    expect(c.playStyle).toBe('Builder: steady');
    expect(c.locked).toBe(true); // paying does not skip the profile gate for bios
    expect(c).not.toHaveProperty('headline');
  });
});

describe('daily check-in and streak', () => {
  it('10 points a day, 15 from day 7, never twice in one day', async () => {
    const A = arena();
    const me = await guest(A); // guests check in too
    const first = await A.call('checkin', me);
    expect(first).toEqual({ streak: 1, awarded: 10, points: 10 });
    A.advance(3 * HOUR);
    expect(await A.call('checkin', me)).toEqual({ streak: 1, awarded: 0, points: 10 });
    let total = 10;
    for (let day = 2; day <= 9; day++) {
      A.advance(DAY);
      const r = await A.call('checkin', me);
      const pay = day >= 7 ? 15 : 10;
      total += pay;
      expect(r, `day ${day}`).toEqual({ streak: day, awarded: pay, points: total });
      expect((await A.call('checkin', me)).awarded).toBe(0);
    }
    expect(A.c.points.count((p) => p.userId === me.id && p.kind === 'checkin')).toBe(9);
  });

  it('one missed day is forgiven; two reset the streak', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    await A.call('checkin', me);
    A.advance(DAY); expect((await A.call('checkin', me)).streak).toBe(2);
    A.advance(2 * DAY); expect((await A.call('checkin', me)).streak).toBe(3); // skipped one day
    A.advance(2 * DAY); expect((await A.call('checkin', me)).streak).toBe(4); // forgiven every time, not a one-off token
    A.advance(3 * DAY);
    const r = await A.call('checkin', me);
    expect(r.streak).toBe(1);
    expect(r.awarded).toBe(10);
  });

  it('the day is the UTC calendar day, not "24 hours since last time"', async () => {
    const A = arena(); // clock is at 12:00 UTC
    const me = await member(A, 'Ada');
    A.advance(11 * HOUR + 59 * 60000); // 23:59
    expect((await A.call('checkin', me)).awarded).toBe(10);
    A.advance(2 * 60000); // 00:01 next day
    expect(await A.call('checkin', me)).toMatchObject({ streak: 2, awarded: 10 });
    expect(A.day()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a check-in marks the member as online; the heartbeat keeps them so for 3 minutes', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    A.advance(10 * 60000);
    expect(A.isOnline(me)).toBe(false);
    await A.call('checkin', me);
    expect(A.isOnline(me)).toBe(true);
    A.advance(3 * 60000 - 1); expect(A.isOnline(me)).toBe(true);
    A.advance(2); expect(A.isOnline(me)).toBe(false);
    await A.call('heartbeat', me);
    expect(A.isOnline(me)).toBe(true);
    expect(A.card(me, me).online).toBe(true);
  });
});

describe('the points ledger', () => {
  it('a once-key pays exactly once; the history is newest first, mine only, 20 rows', async () => {
    const A = arena();
    const me = await member(A, 'Ada'); const other = await member(A, 'Bob');
    expect(A.award(me, 'quiz', 10, { once: 'k' })).toBe(true);
    expect(A.award(me, 'quiz', 10, { once: 'k' })).toBe(false);
    expect(A.award(me, 'quiz', 0)).toBe(false);
    expect(me.points).toBe(10);
    A.award(other, 'checkin', 10);
    for (let i = 0; i < 25; i++) { A.advance(1000); A.award(me, 'game_played', 10, { ref: `t${i}` }); }
    const h = await A.call('pointsHistory', me);
    expect(h.balance).toBe(260);
    expect(h.rows).toHaveLength(20);
    expect(h.rows[0].ref).toBe('t24');
    expect(h.rows.every((r) => r.userId === me.id)).toBe(true);
    expect([...h.rows].sort((a, b) => b.at - a.at)).toEqual(h.rows);
  });
});

describe('referral codes', () => {
  it('8 characters from the 32-symbol alphabet, stable, unique, none for guests', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const code = A.referralCode(me);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    expect(A.referralCode(me)).toBe(code);
    expect(A.referralCode(await guest(A))).toBe(null);
    const seen = new Set([code]);
    for (let i = 0; i < 40; i++) { const u = A.newUser({ isGuest: false }); const c = A.referralCode(u); expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/); expect(seen.has(c)).toBe(false); seen.add(c); }
  });

  it('a new account that registers with a code: the inviter earns 20 once and a request is waiting', async () => {
    const A = arena();
    const ada = await member(A, 'Ada');
    const code = A.referralCode(ada);
    await A.call('logInvite', ada, { channel: 'email', contact: 'bob@example.com', name: 'Bob' });
    const before = ada.points;
    const r = await A.call('register', null, { email: 'bob@example.com', password: 'correct horse', displayName: 'Bob', ref: code.toLowerCase() }, ip());
    const bob = A.user(r.user.id);
    expect(bob.referredBy).toBe(ada.id);
    expect(ada.points - before).toBe(20);
    expect(A.connectionState(bob, ada)).toBe('incoming');
    expect(A.connectionState(ada, bob)).toBe('requested');
    const inv = (await A.call('inviteInfo', ada)).history;
    expect(inv[0].joined).toBe(true);
    expect((await A.call('inbox', ada)).notes[0].body).toMatch(/Bob joined from your invite/);
    // Claiming again changes nothing.
    expect((await A.call('claimReferral', bob, { code })).ok).toBe(false);
    expect(ada.points - before).toBe(20);
    // Nor does a second inviter get a turn.
    const cy = await member(A, 'Cy');
    expect((await A.call('claimReferral', bob, { code: A.referralCode(cy) })).ok).toBe(false);
    expect(bob.referredBy).toBe(ada.id);
  });

  it('refuses your own code, an unknown code, a guest, and an account more than a day old', async () => {
    const A = arena();
    const ada = await member(A, 'Ada'); const code = A.referralCode(ada);
    expect((await A.call('claimReferral', ada, { code })).ok).toBe(false);
    const bob = await member(A, 'Bob');
    expect((await A.call('claimReferral', bob, { code: 'ZZZZZZZZ' })).ok).toBe(false);
    expect((await A.call('claimReferral', bob, {})).ok).toBe(false);
    expect((await A.call('claimReferral', bob, { code: {} })).ok).toBe(false);
    const g = await guest(A);
    expect((await A.call('claimReferral', g, { code })).ok).toBe(false);
    expect(g.referredBy).toBe(null);
    // An existing member opening a ?ref link a week later credits nobody.
    A.advance(DAY + 1000);
    const before = ada.points;
    expect((await A.call('claimReferral', bob, { code })).ok).toBe(false);
    expect(ada.points).toBe(before);
    expect(bob.referredBy).toBe(null);
    // Inside the first day it works.
    const cy = await member(A, 'Cy');
    A.advance(DAY - 5000);
    expect((await A.call('claimReferral', cy, { code })).ok).toBe(true);
    expect(ada.points - before).toBe(20);
  });

  it('"new" is counted from registration: a guest who played for days and then signs up from an invite still counts', async () => {
    const A = arena();
    const ada = await member(A, 'Ada'); const code = A.referralCode(ada);
    const g = await guest(A);
    A.advance(3 * DAY);
    const before = ada.points;
    await A.call('register', g, { email: 'late@example.com', password: 'correct horse', displayName: 'Late', ref: code }, ip());
    expect(g.referredBy).toBe(ada.id);
    expect(ada.points - before).toBe(20);
    // ...but a day after registering the window is closed, as for anyone.
    const h = await guest(A);
    await A.call('register', h, { email: 'later@example.com', password: 'correct horse', displayName: 'Later' }, ip());
    A.advance(DAY + 1);
    expect((await A.call('claimReferral', h, { code })).ok).toBe(false);
  });

  it('an inviter who blocked the newcomer: the registration still succeeds and no referral is made', async () => {
    const A = arena();
    const ada = await member(A, 'Ada'); const code = A.referralCode(ada);
    const g = await guest(A);
    await A.call('block', ada, { userId: g.id });
    const before = ada.points;
    const r = await A.call('register', g, { email: 'g@example.com', password: 'correct horse', displayName: 'Gee', ref: code }, ip());
    expect(r.user.isGuest).toBe(false);
    expect(g.referredBy).toBe(null);
    expect(ada.points).toBe(before);
    expect(A.connectionState(ada, g)).toBe('blocked');
  });
});

describe('photos', () => {
  const png = `data:image/png;base64,${Buffer.from('fake image bytes').toString('base64')}`;
  it('members only; JPEG, PNG or WebP; small', async () => {
    const A = arena();
    const g = await guest(A);
    expect((await err(A.call('setPhoto', g, { dataUrl: png }))).status).toBe(403);
    const me = await member(A, 'Ada');
    for (const bad of [undefined, '', 'https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGI+', 'data:image/png;base64,not base64!', 'data:image/png;base64,', `${png}\n<script>`, { dataUrl: png }]) {
      expect((await err(A.call('setPhoto', me, { dataUrl: bad }))).message, String(bad)).toMatch(/JPEG, PNG or WebP/);
    }
    const big = `data:image/jpeg;base64,${'A'.repeat(120001)}`;
    expect((await err(A.call('setPhoto', me, { dataUrl: big }))).message).toMatch(/too large/);
    expect(me.photoId).toBe(null);
    expect(A.c.photos.size).toBe(0);
  });

  it('stores one photo per member; replacing or removing deletes the old one', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const r = await A.call('setPhoto', me, { dataUrl: png });
    expect(r.user.photo).toBe(`/api/photo/${me.photoId}`);
    const first = me.photoId;
    expect(A.photo(first)).toMatchObject({ type: 'image/png', userId: me.id });
    expect(Buffer.from(A.photo(first).b64, 'base64').toString()).toBe('fake image bytes');
    expect(A.card(me, null).photo).toBe(`/api/photo/${first}`);
    await A.call('setPhoto', me, { dataUrl: png.replace('image/png', 'image/webp') });
    expect(me.photoId).not.toBe(first);
    expect(A.photo(first)).toBeUndefined();
    expect(A.c.photos.size).toBe(1);
    const gone = await A.call('setPhoto', me, { remove: true });
    expect(gone.user.photo).toBe(null);
    expect(A.c.photos.size).toBe(0);
    expect((await A.call('setPhoto', me, { remove: true })).user.photo).toBe(null);
  });
});

describe('location', () => {
  it('stores coordinates rounded to two decimals and never returns them', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    const r = await A.call('setLocation', me, { share: true, lat: 39.099727, lon: -94.578567 });
    expect(me.loc).toEqual({ lat: 39.1, lon: -94.58 });
    expect(me.shareLocation).toBe(true);
    expect(r.user.hasLocation).toBe(true);
    expect(r.user).not.toHaveProperty('loc');
    const off = await A.call('setLocation', me, { share: false });
    expect(me.loc).toBe(null);
    expect(me.shareLocation).toBe(false);
    expect(off.user.hasLocation).toBe(false);
  });

  it('ignores coordinates that are missing or off the globe', async () => {
    const A = arena();
    const me = await member(A, 'Ada');
    for (const [lat, lon] of [[undefined, undefined], [null, null], ['', ''], [91, 0], [0, 181], [-90.01, 10], ['north', 'west'], [NaN, 5], [[], []], [true, true], [Infinity, 0]]) {
      await A.call('setLocation', me, { share: true, lat, lon });
      expect(me.loc, JSON.stringify([lat, lon])).toBe(null); // sharing is on (the city shows) but there is no position
      expect(me.shareLocation).toBe(true);
    }
    await A.call('setLocation', me, { share: true, lat: '-33.8688', lon: '151.2093' }); // numeric strings are fine
    expect(me.loc).toEqual({ lat: -33.87, lon: 151.21 });
    await A.call('setLocation', me, { share: true, lat: 90, lon: -180 });
    expect(me.loc).toEqual({ lat: 90, lon: -180 });
    await A.call('setLocation', me, { share: true, lat: 0, lon: 0 }); // the real (0, 0) is a number and is allowed
    expect(me.loc).toEqual({ lat: 0, lon: 0 });
  });
});

describe('rate limits', () => {
  it('guests per hour per address are capped, then 429, then open again', async () => {
    const A = arena();
    const req = { ip: '203.0.113.9' };
    for (let i = 0; i < GUESTS_PER_HOUR; i++) await A.call('guest', null, {}, req);
    expect((await err(A.call('guest', null, {}, req))).status).toBe(429);
    await A.call('guest', null, {}, { ip: '203.0.113.10' }); // another address is unaffected
    A.advance(HOUR + 1);
    expect((await A.call('guest', null, {}, req)).user.isGuest).toBe(true);
  });

  it('12 login attempts per 10 minutes per address', async () => {
    const A = arena();
    await member(A, 'Ada');
    const req = { ip: '203.0.113.9' };
    for (let i = 0; i < 12; i++) expect((await err(A.call('login', null, { email: 'ada@example.com', password: `guess ${i}` }, req))).status).toBe(401);
    // Even the right password is refused once the limit is hit.
    expect((await err(A.call('login', null, { email: 'ada@example.com', password: 'correct horse' }, req))).status).toBe(429);
    A.advance(10 * 60000 + 1);
    expect((await A.call('login', null, { email: 'ada@example.com', password: 'correct horse' }, req)).setSession).toBeTruthy();
  });

  it('10 registrations an hour per address', async () => {
    const A = arena();
    const req = { ip: '203.0.113.9' };
    for (let i = 0; i < 10; i++) await err(A.call('register', null, { email: 'bad', password: 'x' }, req));
    expect((await err(A.call('register', null, { email: 'ok@example.com', password: 'correct horse' }, req))).status).toBe(429);
    expect(A.c.users.count((u) => u.email === 'ok@example.com')).toBe(0);
  });

  it('the limiter is a fixed window and its sweep forgets old keys', async () => {
    const A = arena();
    A.limit('k', 2, 1000); A.limit('k', 2, 1000);
    expect(() => A.limit('k', 2, 1000)).toThrow(/Slow down/);
    A.advance(1001);
    expect(() => A.limit('k', 2, 1000)).not.toThrow();
    A.advance(HOUR + 1); A.sweepLimiter();
    A.limit('k', 1, 1000);
    expect(() => A.limit('k', 1, 1000)).toThrow();
  });
});
