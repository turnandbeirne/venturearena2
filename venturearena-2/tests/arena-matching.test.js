// Who should meet whom: keywords, distance, the affinity score, each
// recommendation recipe's opt-in rules, tier and profile locks, the Mixer,
// people search and featured placement.
import { describe, it, expect } from 'vitest';
import { makeArena, guest, member } from './helpers.js';
import { keywords, haversineKm } from '../src/server/arena/matching.js';
import { archetypeFit, personasComplement, stageNum } from '../src/shared/profile.js';

const DAY = 86400000;
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
/** Onboarded, verified, 70%+ profile: someone the recommender will show and who may see bios. */
const READY = { colorRanks: ['teal'], archetype: 'builder', headline: 'Hello there', stage: 'idea', industry: '', interests: ['Community'], intent: ['play'], goals: 'Something', currentProject: '', lookingFor: '', onboardedAt: 1 };
const P = (label, risk = 50, horizon = 50, speed = 50) => ({ label, risk, horizon, speed, negotiation: 50, cooperation: 50, resilience: 50, counts: {}, games: 3 });
const recsFor = (A, me, type) => A.recommend(me).filter((r) => r.type === type);
const one = (A, me, c, type) => recsFor(A, me, type).find((r) => r.userId === c.id);

describe('keywords', () => {
  it('lower-cases, splits on anything that is not a letter, digit, + or #, and drops short and stop words', () => {
    expect([...keywords('Looking for a SaaS cofounder who can BUILD the back-end & sell!')]).toEqual(['saas', 'cofounder', 'back', 'end', 'sell']);
    expect([...keywords('C++ and C# and Go, go, GO; node.js')]).toEqual(['c++', 'node']);
    expect([...keywords('pricing pricing PRICING')]).toEqual(['pricing']);
    expect(keywords('').size).toBe(0);
    expect(keywords(null).size).toBe(0);
    expect(keywords(undefined).size).toBe(0);
    expect([...keywords('undefined null')]).toEqual(['undefined', 'null']);
    expect([...keywords(12345)]).toEqual(['12345']);
  });

  it('is linear on hostile input', () => {
    const t = Date.now();
    expect(keywords(`${'a '.repeat(200000)}!`).size).toBe(0);
    expect(keywords('-'.repeat(400000)).size).toBe(0);
    expect(Date.now() - t).toBeLessThan(1500);
  });
});

describe('haversineKm', () => {
  it('great-circle distance on a 6371 km sphere', () => {
    const kc = { lat: 39.1, lon: -94.58 }; const stl = { lat: 38.63, lon: -90.2 };
    expect(haversineKm(kc, kc)).toBe(0);
    expect(haversineKm(kc, stl)).toBeGreaterThan(375);
    expect(haversineKm(kc, stl)).toBeLessThan(385);
    expect(haversineKm(kc, stl)).toBeCloseTo(haversineKm(stl, kc), 9);
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6371, 3);
    expect(haversineKm({ lat: 0, lon: 179.5 }, { lat: 0, lon: -179.5 })).toBeCloseTo(111.19, 1); // across the date line
  });
});

describe('shared fit tables', () => {
  it('archetype fit and persona complements are symmetric', () => {
    expect(archetypeFit('builder', 'trader')).toBe(1);
    expect(archetypeFit('trader', 'builder')).toBe(1);
    expect(archetypeFit('builder', 'builder')).toBe(0.5);
    expect(archetypeFit('builder', 'analyst')).toBe(0.7);
    expect(archetypeFit(null, 'builder')).toBe(0.4);
    expect(personasComplement('Builder', 'Dealmaker')).toBe(true);
    expect(personasComplement('Dealmaker', 'Builder')).toBe(true);
    expect(personasComplement('Builder', 'Builder')).toBe(false);
    expect(personasComplement(null, 'Builder')).toBe(false);
    expect(['idea', 'pre_revenue', 'revenue', 'scaling', 'exited', null, 'nonsense'].map(stageNum)).toEqual([1, 2, 3, 4, 5, 1, 1]);
  });
});

describe('affinity: what two members have going for each other', () => {
  // Read through the "client" recipe, whose score is 40 + affinity / 5, so
  // every 5 points of affinity is one point of score. The candidate was last
  // seen long ago unless a test says otherwise (recency is worth 5).
  async function pair(A, mine, theirs) {
    const me = await member(A, 'Me', { ...READY, archetype: null, interests: [], intent: ['clients'], ...mine });
    const c = await member(A, 'Cand', { ...READY, archetype: null, interests: [], stage: 'revenue', lastSeenAt: A.now() - 30 * DAY, ...theirs });
    return { me, c, rec: one(A, me, c, 'client') };
  }

  it('same industry (15) and shared interests (5 each, 3 at most)', async () => {
    const r1 = await pair(makeArena(), { industry: 'Fintech', stage: 'revenue', interests: ['AI'] }, { industry: 'fintech', interests: ['AI'] });
    expect(r1.rec.score).toBe(44); // 15 + 5
    expect(r1.rec.reasons).toEqual(['Same industry']);
    const r2 = await pair(makeArena(), { stage: 'revenue', interests: ['AI', 'SaaS', 'Games', 'Health'] }, { interests: ['AI', 'SaaS', 'Games', 'Health'], currentProject: 'x' });
    expect(r2.rec).toBeUndefined(); // 15 from interests alone is under the 20 a client match needs
    const r3 = await pair(makeArena(), { stage: 'revenue', interests: ['AI', 'SaaS', 'Games', 'Health'], industry: 'Retail' }, { interests: ['AI', 'SaaS', 'Games', 'Health'], industry: 'RETAIL' });
    expect(r3.rec.score).toBe(46); // 15 + 15
    const r4 = await pair(makeArena(), { stage: 'revenue', interests: ['AI', 'SaaS'], currentProject: 'mine', lookingFor: 'pricing' }, { interests: ['AI', 'SaaS'], currentProject: 'theirs', headline: 'pricing' });
    expect(r4.rec.reasons).toEqual(['Matches what you are looking for', 'Shared interest: AI, SaaS', 'Both have a project underway']);
    expect(r4.rec.score).toBe(46); // 12 + 10 + 8
  });

  it('what I look for found in what they do (12 each, 3 at most) and the reverse (8 each, 3 at most)', async () => {
    const r1 = await pair(makeArena(), { stage: 'revenue', lookingFor: 'pricing help', goals: 'better onboarding and retention', headline: 'logistics routing software', skills: ['python'] },
      { headline: 'Pricing and onboarding', currentProject: 'retention tooling', skills: ['sales'], industry: 'x', lookingFor: 'logistics routing', goals: 'python' });
    expect(r1.rec.reasons).toEqual(['Matches what you are looking for', 'You match what they are looking for']);
    expect(r1.rec.score).toBe(52); // 36 + 24
    // Five hits each way are still capped at three.
    const r2 = await pair(makeArena(), { stage: 'revenue', lookingFor: 'alpha bravo charlie delta echo', headline: 'one two3 three four five6' },
      { headline: 'alpha bravo charlie delta echo', lookingFor: 'one two3 three four five6' });
    expect(r2.rec.score).toBe(52);
    const r3 = await pair(makeArena(), { stage: 'revenue', lookingFor: 'pricing', headline: 'logistics routing' }, { headline: 'pricing', goals: 'logistics routing' });
    expect(r3.rec.score).toBe(46); // 12 + 16
  });

  it('a stage gap of two or more (12), a project each (8)', async () => {
    const r = await pair(makeArena(), { stage: 'idea', currentProject: 'mine' }, { stage: 'revenue', currentProject: 'theirs' });
    expect(r.rec.reasons).toEqual(['One of you has done what the other is doing', 'Both have a project underway']);
    expect(r.rec.score).toBe(44);
    const near = await pair(makeArena(), { stage: 'pre_revenue', currentProject: 'mine', industry: 'a', interests: ['AI'] }, { stage: 'revenue', currentProject: 'theirs', industry: 'A', interests: ['AI'] });
    expect(near.rec.reasons).not.toContain('One of you has done what the other is doing');
  });

  it('complementary archetypes (12), complementary personas (12), similar style (6)', async () => {
    const r1 = await pair(makeArena(), { stage: 'revenue', archetype: 'builder', persona: P('Builder', 50, 50, 50), currentProject: 'm' }, { archetype: 'trader', persona: P('Dealmaker', 60, 60, 60), currentProject: 't' });
    expect(r1.rec.reasons).toEqual(['Trader to your Builder', 'Complementary playing styles (Builder + Dealmaker)', 'Both have a project underway']);
    expect(r1.rec.score).toBe(48); // 40 + (12 + 12 + 6 + 8) / 5, rounded: similar style stacks with complementary personas
    const r2 = await pair(makeArena(), { stage: 'idea', archetype: 'builder', persona: P('Explorer', 50, 50, 50) }, { stage: 'revenue', archetype: 'builder', persona: P('Explorer', 60, 60, 60), industry: '' });
    expect(r2.rec).toBeUndefined(); // 12 (gap) + 6 (similar) = 18: not enough for a client match
    const r3 = await pair(makeArena(), { stage: 'idea', archetype: 'builder', persona: P('Explorer', 50, 50, 50), currentProject: 'm' }, { stage: 'revenue', archetype: 'builder', persona: P('Explorer', 60, 69, 60), currentProject: 't' });
    expect(r3.rec.reasons).toEqual(['One of you has done what the other is doing', 'Similar playing style', 'Both have a project underway']);
    const r4 = await pair(makeArena(), { stage: 'idea', archetype: 'builder', persona: P('Explorer', 50, 50, 50), currentProject: 'm' }, { stage: 'revenue', archetype: 'builder', persona: P('Explorer', 70, 70, 70), currentProject: 't' });
    expect(r4.rec.reasons).not.toContain('Similar playing style'); // 20 + 20 + 20 = 60 is not under 60
  });

  it('distance: only when BOTH share, up to 20 points, shown rounded UP to 5 km', async () => {
    const kc = { lat: 39.1, lon: -94.58 };
    const r1 = await pair(makeArena(), { stage: 'revenue', shareLocation: true, loc: kc }, { shareLocation: true, loc: kc, city: 'Kansas City' });
    expect(r1.rec.score).toBe(44); // 20
    expect(r1.rec.distanceKm).toBe(0);
    expect(r1.rec.reasons).toEqual(['Nearby: Kansas City']);
    const r2 = await pair(makeArena(), { stage: 'revenue', shareLocation: true, loc: kc, industry: 'x', interests: ['AI'] }, { shareLocation: true, loc: { lat: 39.11, lon: -94.58 }, industry: 'x', interests: ['AI'] });
    expect(r2.rec.distanceKm).toBe(5); // about 1.1 km apart: never an exact figure
    expect(r2.rec.reasons).toEqual(['Same industry', 'Nearby']);
    const r3 = await pair(makeArena(), { stage: 'revenue', shareLocation: true, loc: kc, industry: 'x', interests: ['AI'] }, { shareLocation: true, loc: { lat: 38.63, lon: -90.2 }, industry: 'x', interests: ['AI'] });
    expect(r3.rec.distanceKm).toBe(385);
    expect(r3.rec.distanceKm % 5).toBe(0);
    expect(r3.rec.score).toBe(44); // too far to add anything
    expect(r3.rec.reasons).toEqual(['Same industry']);
    // One side not sharing: no distance, no points, even though coordinates are stored.
    for (const [mine, theirs] of [[true, false], [false, true], [false, false]]) {
      const r = await pair(makeArena(), { stage: 'revenue', shareLocation: mine, loc: kc, industry: 'x', interests: ['AI'] }, { shareLocation: theirs, loc: kc, city: 'Kansas City', industry: 'x', interests: ['AI'] });
      expect(r.rec.distanceKm).toBe(null);
      expect(r.rec.score).toBe(44);
      expect(JSON.stringify(r.rec)).not.toContain('Kansas City');
    }
  });

  it('being around in the last week is worth 5, and never qualifies anyone on its own', async () => {
    const A = makeArena();
    const { me, c, rec } = await pair(A, { stage: 'revenue', industry: 'x', interests: ['AI'] }, { industry: 'x', interests: ['AI'] });
    expect(rec.score).toBe(44);
    c.lastSeenAt = A.now() - 6 * DAY;
    expect(one(A, me, c, 'client').score).toBe(45);
    c.industry = 'y'; c.interests = [];
    expect(one(A, me, c, 'client')).toBeUndefined();
  });
});

describe('recommendation recipes and their opt-in rules', () => {
  it('candidates: not me, not bots, not guests, only people who finished onboarding, nobody blocked', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', READY);
    const ok = await member(A, 'Ok', READY);
    await member(A, 'NotOnboarded', { ...READY, onboardedAt: null });
    const g = await guest(A, 'Gus'); g.onboardedAt = 1;
    const blockedByMe = await member(A, 'B1', READY); const blockedMe = await member(A, 'B2', READY);
    await A.call('block', me, { userId: blockedByMe.id }); await A.call('block', blockedMe, { userId: me.id });
    expect([...new Set(A.recommend(me).map((r) => r.userId))]).toEqual([ok.id]);
  });

  it('playmate: everyone eligible, best fit first', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', { ...READY, archetype: 'builder', stage: 'idea', interests: ['AI', 'SaaS'] });
    const great = await member(A, 'Great', { ...READY, archetype: 'trader', stage: 'idea', interests: ['AI', 'SaaS'] });
    const fine = await member(A, 'Fine', { ...READY, archetype: 'analyst', stage: 'pre_revenue', interests: ['AI'] });
    const far = await member(A, 'Far', { ...READY, archetype: 'builder', stage: 'exited', interests: ['Health'] });
    const list = recsFor(A, me, 'playmate');
    expect(list.map((r) => r.userId)).toEqual([great.id, fine.id, far.id]);
    expect(list[0].reason).toBe('Trader, idea stage; a style that complements yours');
    expect(list[1].reason).toBe('Analyst, pre-revenue stage; also into AI');
    expect(list[2].reason).toBe('Builder, exited stage; plays at your level');
    for (const r of list) expect(Number.isInteger(r.score)).toBe(true);
  });

  it('peer: I asked for peers, and they are at my stage', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', { ...READY, stage: 'revenue', intent: ['peers'] });
    const same = await member(A, 'Same', { ...READY, stage: 'revenue' });
    await member(A, 'Other', { ...READY, stage: 'scaling' });
    expect(recsFor(A, me, 'peer').map((r) => r.userId)).toEqual([same.id]);
    expect(one(A, me, same, 'peer').reason).toBe('Same stage as you (revenue), Builder');
    me.intent = ['play'];
    expect(recsFor(A, me, 'peer')).toEqual([]);
  });

  it('mentor: I asked for one, they offer mentoring with room, and they are two stages ahead', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', { ...READY, stage: 'pre_revenue', intent: ['mentor'] });
    const good = await member(A, 'Good', { ...READY, stage: 'scaling', offers: ['mentoring'], openToMentoring: 2 });
    await member(A, 'NoOffer', { ...READY, stage: 'exited', offers: [], openToMentoring: 5 });
    await member(A, 'NoRoom', { ...READY, stage: 'exited', offers: ['mentoring'], openToMentoring: 0 });
    await member(A, 'TooClose', { ...READY, stage: 'revenue', offers: ['mentoring'], openToMentoring: 2 });
    expect(recsFor(A, me, 'mentor').map((r) => r.userId)).toEqual([good.id]);
    expect(one(A, me, good, 'mentor').reason).toBe('Scaling-stage Builder, two steps ahead of you and open to mentoring');
    me.intent = ['peers'];
    expect(recsFor(A, me, 'mentor')).toEqual([]); // I did not ask
    // The mentor is not shown the mentee: mentors are asked, they do not go looking.
    expect(recsFor(A, good, 'mentor')).toEqual([]);
  });

  it('cofounder: BOTH looking, complementary archetypes, risk within one step', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', { ...READY, archetype: 'builder', intent: ['cofounder'], dna: { risk: 3 } });
    const good = await member(A, 'Good', { ...READY, archetype: 'trader', intent: ['cofounder'], dna: { risk: 4 } });
    await member(A, 'NotLooking', { ...READY, archetype: 'trader', intent: ['play'], dna: { risk: 3 } });
    const sameType = await member(A, 'SameType', { ...READY, archetype: 'builder', intent: ['cofounder'], dna: { risk: 3 } });
    await member(A, 'Reckless', { ...READY, archetype: 'trader', intent: ['cofounder'], dna: { risk: 5 } });
    expect(recsFor(A, me, 'cofounder').map((r) => r.userId)).toEqual([good.id]);
    expect(one(A, me, good, 'cofounder').reason).toBe('Trader to your Builder, also looking for a cofounder, similar appetite for risk');
    expect(recsFor(A, good, 'cofounder').map((r) => r.userId).sort()).toEqual([me.id, sameType.id].sort()); // it is mutual (and the other Builder suits the Trader too)
    me.intent = ['play'];
    expect(recsFor(A, me, 'cofounder')).toEqual([]);
    expect(recsFor(A, good, 'cofounder').map((r) => r.userId)).toEqual([sameType.id]); // I am gone from Good's list as well
  });

  it('venture: the person with the capital sees the founder, never the other way round', async () => {
    const A = makeArena();
    const investor = await member(A, 'Inv', { ...READY, stage: 'exited', offers: ['investing'] });
    const founder = await member(A, 'Founder', { ...READY, stage: 'revenue', intent: ['investor'] });
    await member(A, 'TooEarly', { ...READY, stage: 'pre_revenue', intent: ['investor'] });
    await member(A, 'NotRaising', { ...READY, stage: 'scaling', intent: ['clients'] });
    expect(recsFor(A, investor, 'venture').map((r) => r.userId)).toEqual([founder.id]);
    expect(one(A, investor, founder, 'venture').reason).toBe('Revenue-stage Builder looking for investors');
    expect(recsFor(A, founder, 'venture')).toEqual([]);
    expect(A.recommend(founder).filter((r) => r.userId === investor.id).map((r) => r.type)).toEqual(['playmate']);
    investor.offers = [];
    expect(recsFor(A, investor, 'venture')).toEqual([]);
  });

  it('venture: an incubator sees early teams that asked for a mentor, an investor or a cofounder', async () => {
    const A = makeArena();
    const inc = await member(A, 'Inc', { ...READY, stage: 'exited', offers: ['incubating'] });
    const a = await member(A, 'A', { ...READY, stage: 'idea', intent: ['mentor'] });
    const b = await member(A, 'B', { ...READY, stage: 'pre_revenue', intent: ['cofounder'] });
    const c = await member(A, 'C', { ...READY, stage: 'pre_revenue', intent: ['investor'] });
    await member(A, 'Late', { ...READY, stage: 'revenue', intent: ['mentor'] });
    await member(A, 'JustPlaying', { ...READY, stage: 'idea', intent: ['play'] });
    expect(recsFor(A, inc, 'venture').map((r) => r.userId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(one(A, inc, a, 'venture').reason).toBe('Idea-stage Builder who could use an incubator');
    for (const u of [a, b, c]) expect(recsFor(A, u, 'venture')).toEqual([]);
  });

  it('talent: both directions, each needing the other side to have opted in', async () => {
    const A = makeArena();
    const hiring = await member(A, 'Hiring', { ...READY, offers: ['hiring'], currentProject: 'a billing tool' });
    const seeker = await member(A, 'Seeker', { ...READY, intent: ['role'], skills: ['sales', 'python', 'design', 'ops'] });
    await member(A, 'Neither', READY);
    expect(recsFor(A, hiring, 'talent').map((r) => r.userId)).toEqual([seeker.id]);
    expect(one(A, hiring, seeker, 'talent').reason).toBe('Looking for a role; brings sales, python, design');
    expect(recsFor(A, seeker, 'talent').map((r) => r.userId)).toEqual([hiring.id]);
    expect(one(A, seeker, hiring, 'talent').reason).toBe('Building a team: a billing tool');
    seeker.intent = ['play'];
    expect(recsFor(A, hiring, 'talent')).toEqual([]);
    expect(recsFor(A, seeker, 'talent')).toEqual([]);
  });

  it('client: I am looking for customers, they are at revenue stage or later, and there is real overlap', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', { ...READY, intent: ['clients'], industry: 'Logistics', interests: ['AI'] });
    const good = await member(A, 'Good', { ...READY, stage: 'revenue', industry: 'logistics', interests: ['AI'] });
    await member(A, 'Early', { ...READY, stage: 'pre_revenue', industry: 'logistics', interests: ['AI'] });
    await member(A, 'NoOverlap', { ...READY, stage: 'scaling', industry: 'Retail', interests: ['Health'] });
    expect(recsFor(A, me, 'client').map((r) => r.userId)).toEqual([good.id]);
    expect(one(A, me, good, 'client').reason).toBe('Could be a customer: Same industry');
    me.intent = ['play'];
    expect(recsFor(A, me, 'client')).toEqual([]);
  });
});

describe('the recommendations rpc: tier and profile locks', () => {
  async function world(A) {
    const mentor = await member(A, 'Mentor', { ...READY, stage: 'exited', offers: ['mentoring'], openToMentoring: 2 });
    const co = await member(A, 'Co', { ...READY, archetype: 'trader', intent: ['cofounder'], dna: { risk: 3 } });
    const founder = await member(A, 'Founder', { ...READY, stage: 'revenue', intent: ['investor', 'role'], industry: 'Fintech', headline: 'Payments for clinics' });
    const peer = await member(A, 'Peer', { ...READY, stage: 'idea' });
    return { mentor, co, founder, peer };
  }
  const ME = { ...READY, archetype: 'builder', stage: 'idea', intent: ['peers', 'mentor', 'cofounder'], offers: ['investing', 'hiring'], dna: { risk: 3 }, industry: 'Fintech' };

  it('Registered: mentor, cofounder and venture are locked; Subscriber: venture is; VIP: nothing is', async () => {
    const A = makeArena();
    const w = await world(A);
    const me = await member(A, 'Me', ME);
    const free = await A.call('recommendations', me);
    expect(free.locked).toEqual({ mentor: 'mentor_match', cofounder: 'cofounder_match', venture: 'investor_match' });
    expect(free.profileLocked).toBe(false);
    expect(free.by.mentor).toEqual([]); expect(free.by.cofounder).toEqual([]); expect(free.by.venture).toEqual([]);
    expect(free.by.playmate).toHaveLength(4);
    expect(free.by.peer.map((r) => r.userId).sort()).toEqual([w.co.id, w.peer.id].sort());
    expect(free.by.talent.map((r) => r.userId)).toEqual([w.founder.id]);
    expect(JSON.stringify(free.by)).not.toContain('open to mentoring');
    me.tier = 'member';
    const sub = await A.call('recommendations', me);
    expect(sub.locked).toEqual({ venture: 'investor_match' });
    expect(sub.by.mentor.map((r) => r.userId)).toEqual([w.mentor.id]);
    expect(sub.by.cofounder.map((r) => r.userId)).toEqual([w.co.id]);
    expect(sub.by.venture).toEqual([]);
    me.tier = 'vip';
    const vip = await A.call('recommendations', me);
    expect(vip.locked).toEqual({});
    expect(vip.by.venture.map((r) => r.userId)).toEqual([w.founder.id]);
    // Each match is a person, a reason and where the two of you stand.
    expect(vip.by.venture[0]).toMatchObject({ type: 'venture', state: 'none', card: { id: w.founder.id, headline: 'Payments for clinics' } });
    expect(vip.by.venture[0].reasons).toContain('Same industry');
    await A.call('connect', me, { userId: w.peer.id });
    expect((await A.call('recommendations', me)).by.peer.find((r) => r.userId === w.peer.id).state).toBe('requested');
  });

  it('an unfinished profile sees only who to play with and peers, and nothing drawn from other people\'s bios', async () => {
    const A = makeArena();
    const w = await world(A);
    const thin = await member(A, 'Thin', { tier: 'ceo', archetype: 'builder', stage: 'idea', intent: ['peers', 'mentor', 'cofounder'], offers: ['investing', 'hiring'], dna: { risk: 3 }, industry: 'Fintech' });
    expect(A.canSeeBios(thin)).toBe(false);
    const r = await A.call('recommendations', thin);
    expect(r.profileLocked).toBe(true);
    expect(r.locked).toEqual({});
    for (const type of Object.keys(r.by)) if (type !== 'playmate' && type !== 'peer') expect(r.by[type], type).toEqual([]);
    expect(r.by.playmate.length).toBeGreaterThan(0);
    expect(r.by.peer.length).toBeGreaterThan(0);
    const text = JSON.stringify(r);
    expect(text).not.toContain('Payments for clinics');
    expect(text).not.toContain('Same industry'); // would reveal the industry field the viewer may not see
    for (const rec of [...r.by.playmate, ...r.by.peer]) { expect(rec.card.locked).toBe(true); expect(rec.reasons).toEqual([]); }
    // An unverified email is the same lock.
    const unv = await member(A, 'Unv', { ...ME, tier: 'ceo', emailVerified: false });
    expect((await A.call('recommendations', unv)).profileLocked).toBe(true);
    expect(w.founder.industry).toBe('Fintech');
  });

  it('shows at most 12 per type, strongest first', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', { ...READY, interests: ['AI', 'SaaS'] });
    for (let i = 0; i < 15; i++) await member(A, `C${i}`, { ...READY, interests: i < 3 ? ['AI', 'SaaS'] : ['Health'] });
    const r = await A.call('recommendations', me);
    expect(r.by.playmate).toHaveLength(12);
    const scores = r.by.playmate.map((x) => x.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(r.by.playmate.slice(0, 3).every((x) => x.reason.includes('also into AI'))).toBe(true);
  });

  it('a guest gets an answer, not an error', async () => {
    const A = makeArena();
    await world(A);
    const r = await A.call('recommendations', await guest(A));
    expect(r.profileLocked).toBe(true);
    expect(Object.keys(r.locked).sort()).toEqual(['cofounder', 'mentor', 'venture']);
  });
});

describe('the Mixer', () => {
  it('one person at a time, never the same person twice in a day, random when the recommender runs out, then nobody', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', READY);
    const a = await member(A, 'Alice', { ...READY, archetype: 'trader' }); const b = await member(A, 'Bob', READY);
    const c = await member(A, 'Carol', { archetype: 'analyst', stage: 'scaling' }); // never onboarded: only the random pool knows her
    await guest(A, 'Gus');
    const picks = [];
    for (let i = 0; i < 3; i++) picks.push((await A.call('mixer', me, { mode: 'any' })).pick);
    expect(picks.map((p) => p.card.id)).toEqual([a.id, b.id, c.id]);
    expect(picks[0]).toMatchObject({ type: 'playmate', state: 'none', reason: 'Trader, idea stage; a style that complements yours' });
    expect(picks[2]).toMatchObject({ type: 'playmate', reason: 'Random mixer: Analyst, scaling stage' });
    // Everyone has been shown today: nobody new, rather than a repeat.
    expect(await A.call('mixer', me, { mode: 'any' })).toEqual({ pick: null });
    expect(await A.call('mixer', me, {})).toEqual({ pick: null });
    A.advance(DAY - 60000);
    expect((await A.call('mixer', me, { mode: 'any' })).pick).toBe(null);
    A.advance(120000);
    expect((await A.call('mixer', me, { mode: 'any' })).pick.card.id).toBe(a.id);
    // Someone else's day is their own.
    expect((await A.call('mixer', b, { mode: 'any' })).pick).toBeTruthy();
  });

  it('the random pool leaves out me, bots, guests and anyone I already have a connection or a block with', async () => {
    const A = makeArena();
    const me = await member(A, 'Me'); // not onboarded and thin: the recommender has nothing
    const friend = await member(A, 'Friend'); const blocked = await member(A, 'Blocked'); const asked = await member(A, 'Asked'); const fresh = await member(A, 'Fresh');
    await guest(A, 'Gus');
    await A.call('connect', me, { userId: friend.id }); await A.call('answerConnection', friend, { userId: me.id, accept: true });
    await A.call('block', blocked, { userId: me.id });
    await A.call('connect', me, { userId: asked.id });
    const first = await A.call('mixer', me, { mode: 'any' });
    expect(first.pick.card.id).toBe(fresh.id);
    expect(first.pick.reason).toBe('Random mixer: a founder');
    expect((await A.call('mixer', me, { mode: 'any' })).pick).toBe(null);
  });

  it('modes: a peer for anyone who asked for peers; mentor and cofounder modes are a Subscriber feature', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', { ...READY, stage: 'idea', intent: ['peers', 'mentor'] });
    const peer = await member(A, 'Peer', { ...READY, stage: 'idea' });
    const mentor = await member(A, 'Mentor', { ...READY, stage: 'scaling', offers: ['mentoring'], openToMentoring: 1 });
    expect((await A.call('mixer', me, { mode: 'peer' })).pick).toMatchObject({ type: 'peer', card: { id: peer.id } });
    for (const mode of ['mentor', 'cofounder']) {
      const e = await err(A.call('mixer', me, { mode }));
      expect(e.status, mode).toBe(403);
      expect(e.message).toMatch(/Subscriber/);
    }
    // In "any" mode a free member is never handed a gated match type.
    A.advance(DAY + 1);
    const seen = [];
    for (let i = 0; i < 2; i++) seen.push((await A.call('mixer', me, { mode: 'any' })).pick.type);
    expect(seen).not.toContain('mentor');
    me.tier = 'member';
    A.advance(DAY + 1);
    expect((await A.call('mixer', me, { mode: 'mentor' })).pick).toMatchObject({ type: 'mentor', card: { id: mentor.id } });
    expect((await A.call('mixer', me, { mode: 'venture' })).pick).toBeTruthy(); // an unknown mode is "any"
  });

  it('an unfinished profile is only ever mixed with playmates and peers', async () => {
    const A = makeArena();
    const thin = await member(A, 'Thin', { tier: 'ceo', intent: ['mentor', 'role', 'cofounder'], archetype: 'builder', stage: 'idea', offers: ['hiring', 'investing'], dna: { risk: 3 } });
    await member(A, 'Mentor', { ...READY, stage: 'exited', offers: ['mentoring', 'hiring'], openToMentoring: 3, intent: ['role', 'investor', 'cofounder'], archetype: 'trader', dna: { risk: 3 } });
    expect(A.canSeeBios(thin)).toBe(false);
    expect(new Set(A.recommend(thin).map((r) => r.type)).size).toBeGreaterThan(2); // the recommender itself has more to say
    for (const mode of ['any', 'mentor', 'cofounder']) {
      A.advance(DAY + 1);
      const { pick } = await A.call('mixer', thin, { mode });
      expect(pick.type, mode).toBe('playmate');
      expect(pick.card.locked).toBe(true);
      expect(pick.reason).not.toMatch(/brings|Building a team|mentoring|cofounder/);
    }
  });
});

describe('people search', () => {
  it('finds members by name, username, archetype, stage, interests, what they look for and offer', async () => {
    const A = makeArena();
    const me = await member(A, 'Me', READY);
    const a = await member(A, 'Alice Stone', { archetype: 'trader', stage: 'scaling', interests: ['Fintech'], intent: ['mentor'], offers: ['hiring'], industry: 'Payments' });
    const b = await member(A, 'Bob', { archetype: 'analyst', stage: 'idea', interests: ['Health'] });
    const ids = async (q, viewer = me) => (await A.call('people', viewer, { q })).members.map((m) => m.id);
    expect((await ids('')).sort()).toEqual([a.id, b.id].sort());
    expect(await ids('STONE')).toEqual([a.id]);
    expect(await ids('alice_stone')).toEqual([a.id]);
    expect(await ids('trader')).toEqual([a.id]);
    expect(await ids('scaling')).toEqual([a.id]);
    expect(await ids('fintech')).toEqual([a.id]);
    expect(await ids('hiring')).toEqual([a.id]);
    expect(await ids('health')).toEqual([b.id]);
    expect(await ids('payments')).toEqual([a.id]); // I can see bios, so I can search the industry field
    expect(await ids('zzz')).toEqual([]);
    expect(await ids({ $ne: null })).toHaveLength(2); // junk is "no query"
    // Never by email, phone or anything private.
    a.phone = '555-0100';
    expect(await ids('example.com')).toEqual([]);
    expect(await ids('555')).toEqual([]);
  });

  it('a viewer who cannot see bios cannot probe them through search either', async () => {
    const A = makeArena();
    const thin = await member(A, 'Thin'); const g = await guest(A);
    const a = await member(A, 'Alice', { ...READY, industry: 'Payments', headline: 'Payments for clinics' });
    for (const viewer of [thin, g]) {
      expect((await A.call('people', viewer, { q: 'payments' })).members).toEqual([]);
      expect((await A.call('people', viewer, { q: 'alice' })).members.map((m) => m.id)).toEqual([a.id]);
      expect(JSON.stringify(await A.call('people', viewer, {}))).not.toContain('Payments');
    }
  });

  it('leaves out me and bots; shows guests only while they are online', async () => {
    const A = makeArena();
    const me = await member(A, 'Me'); const a = await member(A, 'Alice'); const g = await guest(A, 'Gus');
    const ids = async () => (await A.call('people', me, {})).members.map((m) => m.id).sort();
    expect(await ids()).toEqual([a.id, g.id].sort());
    A.advance(5 * 60000);
    expect(await ids()).toEqual([a.id]); // members stay listed when offline; guests do not
  });

  it('featured placement: CEO members first, then whoever was around most recently; 60 at most', async () => {
    const A = makeArena();
    const me = await member(A, 'Me');
    const old = await member(A, 'Old'); A.advance(60000);
    const ceo = await member(A, 'Ceo', { tier: 'ceo' }); A.advance(60000);
    const lapsed = await member(A, 'Lapsed', { tier: 'ceo', tierExpiresAt: A.now() - 1 }); A.advance(60000);
    const recent = await member(A, 'Recent', { tier: 'vip' });
    expect((await A.call('people', me, {})).members.map((m) => m.id)).toEqual([ceo.id, recent.id, lapsed.id, old.id]);
    for (let i = 0; i < 70; i++) A.newUser({ isGuest: false, displayName: `U${i}`, username: `u${i}` });
    const many = (await A.call('people', me, {})).members;
    expect(many).toHaveLength(60);
    expect(many[0].id).toBe(ceo.id);
  });
});

describe('find by email', () => {
  it('exact address, any case, members only; the answer is a card, never the address', async () => {
    const A = makeArena();
    const me = await member(A, 'Me'); const a = await member(A, 'Alice');
    const hit = await A.call('findByEmail', me, { email: '  ALICE@example.com ' });
    expect(hit.card.id).toBe(a.id);
    expect(JSON.stringify(hit)).not.toContain('alice@example.com');
    for (const email of ['alice@example', 'lice@example.com', '', undefined, { $ne: '' }, '%@example.com']) expect((await A.call('findByEmail', me, { email })).card, String(email)).toBe(null);
    // A guest has no email: an empty lookup must not return the first guest.
    await guest(A);
    expect((await A.call('findByEmail', me, {})).card).toBe(null);
  });

  it('is for members, and is rate limited so it cannot be used to harvest who has an account', async () => {
    const A = makeArena();
    const me = await member(A, 'Me'); const g = await guest(A);
    await member(A, 'Alice');
    expect((await err(A.call('findByEmail', g, { email: 'alice@example.com' }))).status).toBe(403);
    for (let i = 0; i < 30; i++) await A.call('findByEmail', me, { email: `guess${i}@example.com` });
    expect((await err(A.call('findByEmail', me, { email: 'alice@example.com' }))).status).toBe(429);
    A.advance(3600001);
    expect((await A.call('findByEmail', me, { email: 'alice@example.com' })).card).toBeTruthy();
  });
});
