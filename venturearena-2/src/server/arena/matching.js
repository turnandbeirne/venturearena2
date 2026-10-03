// Who should meet whom. One scorer, several recipes.
//
// Inputs, in the order they were added across the builds: what people said
// (stage, what they look for and offer, interests, goals), how they sorted the
// business-savvy cards (archetype, risk, pace), and how they actually play
// (the six-dimension style read from their games).
//
// Every match is a person + one sentence of why + one first move. Nobody is
// matched into something they did not opt into, and for mentor, cofounder and
// investor matches BOTH sides have to have opted in.
import { clean } from './context.js';
import { archetypeFit, stageNum, personasComplement, ARCHETYPES, STAGES } from '../../shared/profile.js';

const STOP = new Set('the and for with that this from have are you your our who can will want looking need someone people help get into about more some all any one new out not but they them their has was been also just like build building make making'.split(' '));
export function keywords(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().split(/[^a-z0-9+#]+/)) if (w.length >= 3 && !STOP.has(w)) out.add(w);
  return out;
}
const hits = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

export function haversineKm(a, b) {
  const R = 6371; const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// The stage's display name, lower-cased ("pre-revenue", not "pre revenue").
const stageName = (s) => ((STAGES.find((x) => x.id === s) || STAGES[0]).name).toLowerCase();

export function install(A) {
  const { users, mixerSeen, connections } = A.c;

  /** Everything two members have going for each other. */
  function affinity(me, c) {
    const reasons = [];
    const needs = hits(keywords(`${me.lookingFor} ${me.goals}`), keywords(`${c.headline} ${c.currentProject} ${(c.skills || []).join(' ')} ${c.industry}`));
    const theirs = hits(keywords(`${c.lookingFor} ${c.goals}`), keywords(`${me.headline} ${me.currentProject} ${(me.skills || []).join(' ')} ${me.industry}`));
    const sameIndustry = !!me.industry && !!c.industry && me.industry.toLowerCase() === c.industry.toLowerCase();
    const shared = (me.interests || []).filter((i) => (c.interests || []).includes(i));
    const gap = Math.abs(stageNum(me.stage) - stageNum(c.stage));
    const archFit = archetypeFit(me.archetype, c.archetype);
    const pa = me.persona; const pc = c.persona;
    const complement = !!pa && !!pc && personasComplement(pa.label, pc.label);
    const similar = !!pa && !!pc && Math.abs(pa.risk - pc.risk) + Math.abs(pa.horizon - pc.horizon) + Math.abs(pa.speed - pc.speed) < 60;
    const bothBuilding = !!me.currentProject && !!c.currentProject;
    const dist = me.shareLocation && c.shareLocation && me.loc && c.loc ? haversineKm(me.loc, c.loc) : null;
    let base = Math.min(needs, 3) * 12 + Math.min(theirs, 3) * 8 + (sameIndustry ? 15 : 0) + Math.min(shared.length, 3) * 5
      + (gap >= 2 ? 12 : 0) + (archFit === 1 ? 12 : 0) + (complement ? 12 : 0) + (similar ? 6 : 0) + (bothBuilding ? 8 : 0)
      + (dist !== null ? Math.round(Math.max(0, 20 - dist / 10)) : 0);
    if (needs) reasons.push('Matches what you are looking for');
    if (theirs) reasons.push('You match what they are looking for');
    if (sameIndustry) reasons.push('Same industry'); else if (shared.length) reasons.push(`Shared interest: ${shared.slice(0, 2).join(', ')}`);
    if (gap >= 2) reasons.push('One of you has done what the other is doing');
    if (archFit === 1) reasons.push(`${ARCHETYPES[c.archetype].name} to your ${ARCHETYPES[me.archetype].name}`);
    if (complement) reasons.push(`Complementary playing styles (${pa.label} + ${pc.label})`); else if (similar) reasons.push('Similar playing style');
    if (bothBuilding) reasons.push('Both have a project underway');
    if (dist !== null && dist < 50) reasons.push(c.city ? `Nearby: ${c.city}` : 'Nearby');
    const recent = A.now() - (c.lastSeenAt || 0) < 7 * 86400000;
    return { base, score: base + (recent ? 5 : 0), reasons, shared, gap, archFit, distanceKm: dist !== null ? Math.ceil(dist / 5) * 5 : null };
  }

  function candidates(me) {
    return users.filter((c) => c.id !== me.id && !c.isBot && !c.isGuest && !!c.onboardedAt && !A.areBlocked(me.id, c.id));
  }

  /** All recommendations for a member, strongest first within each type. */
  A.recommend = (me) => {
    const out = [];
    const has = (u, list, v) => (u[list] || []).includes(v);
    const myRisk = me.dna && me.dna.risk ? me.dna.risk : 3;
    for (const c of candidates(me)) {
      const f = affinity(me, c);
      const add = (type, score, reason) => out.push({ userId: c.id, type, score: Math.round(score), reason, reasons: f.reasons, distanceKm: f.distanceKm });
      const who = `${c.archetype ? ARCHETYPES[c.archetype].name : 'Player'}, ${stageName(c.stage)} stage`;

      // playmate: style that complements yours, near your stage, shared interests
      const overlap = (me.interests || []).length ? f.shared.length / me.interests.length : 0;
      add('playmate', 35 * f.archFit + 30 * (1 - Math.min(f.gap, 4) / 4) + 35 * overlap + f.score / 10,
        `${who}; ${f.archFit === 1 ? 'a style that complements yours' : f.shared.length ? `also into ${f.shared[0]}` : 'plays at your level'}`);

      if (has(me, 'intent', 'peers') && stageNum(c.stage) === stageNum(me.stage)) {
        add('peer', 50 + 50 * f.archFit + f.score / 10, `Same stage as you (${stageName(me.stage)}), ${c.archetype ? ARCHETYPES[c.archetype].name : 'founder'}`);
      }
      if (has(me, 'intent', 'mentor') && has(c, 'offers', 'mentoring') && (c.openToMentoring || 0) > 0 && stageNum(c.stage) - stageNum(me.stage) >= 2) {
        add('mentor', 40 + 30 * (c.archetype === me.archetype ? 1 : 0.5) + 30 * Math.min(c.reputation.score, 200) / 200 + f.score / 10,
          `${cap(stageName(c.stage))}-stage ${c.archetype ? ARCHETYPES[c.archetype].name : 'founder'}, two steps ahead of you and open to mentoring`);
      }
      if (has(me, 'intent', 'cofounder') && has(c, 'intent', 'cofounder') && f.archFit === 1 && Math.abs(myRisk - ((c.dna && c.dna.risk) || 3)) <= 1) {
        add('cofounder', 90 + f.score / 10, `${ARCHETYPES[c.archetype].name} to your ${ARCHETYPES[me.archetype].name}, also looking for a cofounder, similar appetite for risk`);
      }
      // investor and incubator matches run the protected way round: the person
      // with the capital sees the founder first; the founder hears about it
      // only if the backer asks for an introduction.
      if (has(me, 'offers', 'investing') && has(c, 'intent', 'investor') && stageNum(c.stage) >= 3) {
        add('venture', 80 + f.score / 10, `${cap(stageName(c.stage))}-stage ${c.archetype ? ARCHETYPES[c.archetype].name : 'founder'} looking for investors`);
      } else if (has(me, 'offers', 'incubating') && stageNum(c.stage) <= 2 && (has(c, 'intent', 'mentor') || has(c, 'intent', 'investor') || has(c, 'intent', 'cofounder'))) {
        add('venture', 70 + f.score / 10, `${cap(stageName(c.stage))}-stage ${c.archetype ? ARCHETYPES[c.archetype].name : 'founder'} who could use an incubator`);
      }
      if (has(me, 'offers', 'hiring') && has(c, 'intent', 'role')) {
        add('talent', 70 + f.score / 10, `Looking for a role${(c.skills || []).length ? `; brings ${c.skills.slice(0, 3).join(', ')}` : ''}`);
      } else if (has(me, 'intent', 'role') && has(c, 'offers', 'hiring')) {
        add('talent', 70 + f.score / 10, `Building a team${c.currentProject ? `: ${c.currentProject}` : ''}`);
      }
      if (has(me, 'intent', 'clients') && f.base >= 20 && stageNum(c.stage) >= 3) {
        add('client', 40 + f.score / 5, `Could be a customer: ${f.reasons[0] || 'overlapping business'}`);
      }
    }
    return out.sort((a, b) => b.score - a.score);
  };

  const GATE = { mentor: 'mentor_match', cofounder: 'cofounder_match', venture: 'investor_match' };
  function segments(me) {
    const recs = A.recommend(me);
    const by = {};
    for (const r of recs) (by[r.type] || (by[r.type] = [])).push({ ...r, card: A.card(users.get(r.userId), me), state: A.connectionState(me, users.get(r.userId)) });
    const locked = {};
    for (const [type, feature] of Object.entries(GATE)) if (!A.allows(me, feature)) { locked[type] = feature; by[type] = []; }
    // Anything past "who to play with" needs a finished profile on your side
    // too: an introduction to someone who can see nothing about you is not one.
    const profileLocked = !A.canSeeBios(me);
    if (profileLocked) for (const type of Object.keys(by)) if (type !== 'playmate' && type !== 'peer') by[type] = [];
    // The reason chips are drawn from the other person's bio (industry,
    // headline, project). (Bug: a viewer who may not see bios still got
    // "Same industry" and "Matches what you are looking for" on every
    // playmate, which reads those hidden fields back one bit at a time.)
    if (profileLocked) for (const type of Object.keys(by)) by[type] = by[type].map((r) => ({ ...r, reasons: [] }));
    for (const type of Object.keys(by)) by[type] = by[type].slice(0, 12);
    return { by, locked, profileLocked };
  }

  A.rpc.recommendations = (me) => segments(me);

  A.rpc.people = (me, args) => {
    const q = clean(args.q, 60).toLowerCase();
    let list = users.filter((u) => !u.isBot && u.id !== me.id && (!u.isGuest || A.isOnline(u)));
    // Search only what the viewer's card of that person shows. (Bug: the
    // industry was always searched, so a viewer who may not see bios could
    // still learn anyone's industry by typing guesses.)
    const bios = A.canSeeBios(me);
    if (q) list = list.filter((u) => [u.username, u.displayName, u.archetype, u.stage, bios ? u.industry : '', ...(u.interests || []), ...(u.intent || []), ...(u.offers || [])].join(' ').toLowerCase().includes(q));
    // CEO members get featured placement; then whoever was around most recently.
    list.sort((a, b) => (A.tier(b) === 'ceo') - (A.tier(a) === 'ceo') || (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
    return { members: list.slice(0, 60).map((u) => A.card(u, me)) };
  };

  // Looking someone up by address answers "does this person have an account
  // here", so it is for members and it is counted. (It had neither check:
  // any guest session could test addresses as fast as it could send them.)
  A.rpc.findByEmail = (me, args) => {
    if (me.isGuest) throw A.err('Create a free account to look people up by email.', 403);
    A.limit(`findemail:${me.id}`, 30, 3600000);
    const email = clean(args.email, 254).toLowerCase();
    const u = email ? users.find((x) => x.email === email && !x.isGuest) : null;
    return { card: u ? A.card(u, me) : null };
  };

  // The Mixer: one person at a time, with the reason. From the recommender
  // when it knows you, at random from recently active members when it does
  // not. Never the same person twice in a day.
  A.rpc.mixer = (me, args) => {
    const mode = ['any', 'peer', 'mentor', 'cofounder', 'playmate'].includes(args.mode) ? args.mode : 'any';
    if (GATE[mode]) A.need(me, GATE[mode], `${cap(mode)} introductions are a Subscriber feature.`);
    const dayAgo = A.now() - 86400000;
    const seenToday = (id) => { const s = mixerSeen.get(`${me.id}:${id}`); return !!s && s.at > dayAgo; };
    // The same profile lock the Matches tab applies. (Bug: the Mixer skipped
    // it, so a member with an unfinished profile was handed mentor, talent
    // and client matches, reason line and all, one click at a time.)
    const profileLocked = !A.canSeeBios(me);
    const open = (type) => !profileLocked || type === 'playmate' || type === 'peer';
    const recs = A.recommend(me).filter((r) => open(r.type) && (mode === 'any' ? !GATE[r.type] || A.allows(me, GATE[r.type]) : r.type === mode));
    let pick = recs.find((r) => !seenToday(r.userId));
    let reason = pick ? pick.reason : null; let type = pick ? pick.type : 'playmate'; let id = pick ? pick.userId : null;
    if (!id) {
      const pool = users.filter((u) => !u.isBot && u.id !== me.id && !u.isGuest && !connections.get([me.id, u.id].sort().join(':')));
      const fresh = pool.filter((u) => !seenToday(u.id)).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
      // Nobody new today means nobody, as the comment above promises and the
      // page says ("Nobody new to introduce right now"). (Bug: this fell back
      // to `pool[random]`, which repeated someone already shown today.)
      const u = fresh[0];
      if (u) { id = u.id; reason = `Random mixer: ${u.archetype ? ARCHETYPES[u.archetype].name : 'a founder'}${u.stage ? `, ${stageName(u.stage)} stage` : ''}`; type = 'playmate'; }
    }
    if (!id) return { pick: null };
    mixerSeen.put({ id: `${me.id}:${id}`, at: A.now() });
    const u = users.get(id);
    return { pick: { card: A.card(u, me), reason, type, state: A.connectionState(me, u) } };
  };
}
