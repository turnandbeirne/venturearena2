// Who a member is, in data: archetypes, the business-savvy card sort, stages,
// what people look for and offer, seat colours, play-style personas and ranks.
// Shared by the server (scoring, matching) and the client (forms, cards) so
// the two cannot disagree about what a value means.
//
// Emoji here are Emoji 11 or older on purpose: newer ones render as empty
// boxes on older phones (scripts/check-emoji.mjs enforces it).

export const ARCHETYPES = {
  builder: { name: 'Builder', tagline: 'Makes the thing', color: '#e8b64a', glyph: '⚒', blurb: 'You start with the product. Give you a weekend and a problem and something exists on Monday.' },
  trader: { name: 'Trader', tagline: 'Finds the deal', color: '#2fb7a6', glyph: '⇄', blurb: 'You see the market before the product. You know what people will pay and who will pay it first.' },
  operator: { name: 'Operator', tagline: 'Makes it run', color: '#8a97b5', glyph: '⚙', blurb: 'You turn chaos into a system. Growth without you is a fire; with you it is a machine.' },
  backer: { name: 'Backer', tagline: 'Fuels the run', color: '#5fc27a', glyph: '◆', blurb: 'You think in portfolios and people. You back founders early and open doors they cannot see.' },
  analyst: { name: 'Analyst', tagline: 'Sees the numbers', color: '#a37cf0', glyph: '∑', blurb: 'You find the truth in the spreadsheet. Your questions are the ones the room was avoiding.' },
};
export const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

export const STAGES = [
  { id: 'idea', name: 'Idea', hint: 'Exploring, not yet building' },
  { id: 'pre_revenue', name: 'Pre-revenue', hint: 'Building, no paying customers yet' },
  { id: 'revenue', name: 'Revenue', hint: 'Customers are paying' },
  { id: 'scaling', name: 'Scaling', hint: 'Growing a team and a machine' },
  { id: 'exited', name: 'Exited', hint: 'Sold or stepped back; now investing or mentoring' },
];
export const stageNum = (s) => Math.max(1, STAGES.findIndex((x) => x.id === s) + 1);

/** What I am looking for. */
export const INTENTS = [
  { id: 'play', name: 'People to play with', hint: 'Fun, regular games' },
  { id: 'peers', name: 'Peers at my stage', hint: 'People wrestling with the same problems' },
  { id: 'mentor', name: 'A mentor', hint: 'Someone a few steps ahead' },
  { id: 'cofounder', name: 'A cofounder', hint: 'Someone whose strengths are not mine' },
  { id: 'investor', name: 'Investors', hint: 'Capital for what I am building' },
  { id: 'clients', name: 'Clients', hint: 'Customers for what I sell' },
  { id: 'role', name: 'An internship or a role', hint: 'A team to join and learn from' },
];

/** What I can offer. Nobody is matched into something they did not opt into. */
export const OFFERS = [
  { id: 'mentoring', name: 'Mentoring', hint: 'I will take a few people under my wing' },
  { id: 'investing', name: 'Capital', hint: 'I back founders and want to see deals' },
  { id: 'hiring', name: 'Internships and jobs', hint: 'I am building a team' },
  { id: 'incubating', name: 'Incubation', hint: 'I take in teams and young companies' },
  { id: 'challenges', name: 'Business challenges', hint: 'I have real problems for a team to tackle' },
];

export const INTEREST_TAGS = ['SaaS', 'B2B services', 'Consumer', 'Marketplaces', 'Hardware', 'Health', 'Fintech', 'Education', 'Real estate', 'Food & ag', 'Games', 'AI', 'Local business', 'Community', 'Franchising', 'Manufacturing'];

/** One word for how someone played. Positive only; problems go through Report. */
export const CHIPS = ['bold', 'careful', 'generous', 'sharp', 'patient', 'fun'];

export const PROMPTS = [
  'The best business decision I made this year was...',
  'The thing I wish someone had told me earlier...',
  'I could talk for an hour about...',
  'The industry I secretly want to get into...',
  'My unfair advantage is...',
];

export const TABLE_QUESTIONS = [
  'What is the riskiest bet you are making this quarter?',
  'What would you build if you could not fail?',
  'Which of your customers would you clone?',
  'What did your last game teach you about cash?',
  'Who taught you the most about business, and what was the lesson?',
];

// ---- business-savvy card sort -------------------------------------------------
// Each scenario has three answers; each answer nudges archetype scores and
// risk / pace / collaboration style.
export const SCENARIOS = [
  { prompt: 'Your biggest customer asks for 40% off or they walk.', answers: [
    { text: 'Counter with a smaller discount tied to a longer contract', arch: { trader: 2 }, risk: 3, collab: 'dealmaker' },
    { text: 'Let them walk and fix the product so nobody asks again', arch: { builder: 2 }, risk: 4, collab: 'solo' },
    { text: 'Run the numbers on lifetime value before deciding', arch: { analyst: 2 }, risk: 2, pace: 2 },
  ] },
  { prompt: 'You have 6 months of cash left and growth is flat.', answers: [
    { text: 'Raise now while the story still holds', arch: { backer: 1, trader: 1 }, risk: 4, pace: 4 },
    { text: 'Cut costs to 12 months and find the one channel that works', arch: { operator: 2 }, risk: 2, pace: 3 },
    { text: 'Ship the feature customers keep asking for', arch: { builder: 2 }, risk: 3, pace: 4 },
  ] },
  { prompt: 'A friend pitches you their startup over dinner.', answers: [
    { text: 'Ask who else is in and what the terms are', arch: { backer: 2 }, collab: 'dealmaker' },
    { text: 'Ask to see the product and the retention numbers', arch: { analyst: 2 }, pace: 2 },
    { text: 'Offer to help build it for a weekend', arch: { builder: 1, operator: 1 }, collab: 'team' },
  ] },
  { prompt: 'Your best engineer wants to quit and start a competitor.', answers: [
    { text: 'Offer equity and a bigger problem to own', arch: { backer: 1, operator: 1 }, collab: 'team' },
    { text: 'Wish them well and hire two people', arch: { operator: 2 }, risk: 2 },
    { text: 'Propose partnering: they build, you sell', arch: { trader: 2 }, collab: 'dealmaker', risk: 4 },
  ] },
  { prompt: 'A new market opens overnight. Everyone is rushing in.', answers: [
    { text: 'Be first, fix it later', arch: { builder: 1, trader: 1 }, risk: 5, pace: 5 },
    { text: 'Wait a quarter and enter with the best product', arch: { builder: 1, analyst: 1 }, risk: 2, pace: 2 },
    { text: 'Sell shovels to the people rushing in', arch: { trader: 2 }, risk: 3, pace: 4 },
  ] },
  { prompt: 'You get to pick one meeting this week.', answers: [
    { text: 'Three customers who churned', arch: { analyst: 1, operator: 1 }, pace: 2 },
    { text: 'An investor who backed a rival', arch: { backer: 2 }, collab: 'dealmaker' },
    { text: 'Your team, to rebuild the roadmap', arch: { builder: 1, operator: 1 }, collab: 'team' },
  ] },
  { prompt: 'The board asks for a five-year plan.', answers: [
    { text: 'Give them three scenarios with the numbers', arch: { analyst: 2 }, pace: 2 },
    { text: 'Give them a one-page vision and next quarter in detail', arch: { builder: 1, backer: 1 }, risk: 3 },
    { text: 'Give them the operating model and hiring plan', arch: { operator: 2 }, pace: 3 },
  ] },
  { prompt: 'Two acquisition offers land the same day.', answers: [
    { text: 'Play them against each other', arch: { trader: 2 }, risk: 4, collab: 'dealmaker' },
    { text: 'Decline both; the run is not over', arch: { builder: 2 }, risk: 5 },
    { text: 'Model both against staying independent', arch: { analyst: 1, backer: 1 }, risk: 2, pace: 2 },
  ] },
];

export function scoreCardSort(picks) {
  const arch = Object.fromEntries(ARCHETYPE_IDS.map((k) => [k, 0]));
  const risks = []; const paces = []; const collabs = { solo: 0, dealmaker: 0, team: 0 };
  picks.forEach((ai, si) => {
    const a = SCENARIOS[si] && SCENARIOS[si].answers[ai];
    if (!a) return;
    for (const [k, v] of Object.entries(a.arch)) arch[k] += v || 0;
    if (a.risk) risks.push(a.risk);
    if (a.pace) paces.push(a.pace);
    if (a.collab) collabs[a.collab]++;
  });
  const archetype = Object.entries(arch).sort((x, y) => y[1] - x[1])[0][0];
  const avg = (xs, d) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : d);
  const collab = Object.entries(collabs).sort((x, y) => y[1] - x[1])[0][0];
  return { archetype, risk: avg(risks, 3), pace: avg(paces, 3), collab, scores: arch };
}

export function describeDna(dna = {}) {
  const r = dna.risk ?? 3; const p = dna.pace ?? 3;
  return {
    risk: `Risk ${r} of 5: ${r >= 4 ? 'you raise early and spend into growth' : r <= 2 ? 'you keep a buffer and move when the numbers say so' : 'you take calculated swings'}`,
    pace: `Pace ${p} of 5: ${p >= 4 ? 'you decide fast and correct later' : p <= 2 ? 'you think first and move once' : 'you match the tempo of the room'}`,
    collab: dna.collab === 'dealmaker' ? 'Dealmaker: you win by making everyone a little better off' : dna.collab === 'team' ? 'Team-first: you build the people before the product' : 'Solo: you move alone until the path is clear',
  };
}

/** How well two archetypes complement each other (1 = made for each other). */
const COMPLEMENTS = new Set(['builder|trader', 'backer|builder', 'builder|operator', 'analyst|operator', 'analyst|trader', 'backer|operator']);
export function archetypeFit(a, b) {
  if (!a || !b) return 0.4;
  if (a === b) return 0.5;
  return COMPLEMENTS.has([a, b].sort().join('|')) ? 1 : 0.7;
}

// ---- identity at the table ---------------------------------------------------
export const COLORS = [
  { id: 'gold', name: 'Gold', hex: '#C9962B' },
  { id: 'felt', name: 'Felt Green', hex: '#1F6A4B' },
  { id: 'teal', name: 'Teal', hex: '#1C7C86' },
  { id: 'plum', name: 'Plum', hex: '#6B3D8C' },
  { id: 'brick', name: 'Brick', hex: '#B24A2F' },
  { id: 'cobalt', name: 'Cobalt', hex: '#2F5DA8' },
  { id: 'coral', name: 'Coral', hex: '#D97B3C' },
  { id: 'slate', name: 'Slate', hex: '#5B6478' },
  { id: 'rose', name: 'Rose', hex: '#B83B6E' },
  { id: 'olive', name: 'Olive', hex: '#6F7F2B' },
  { id: 'ink', name: 'Ink', hex: '#16203A' },
  { id: 'sky', name: 'Sky', hex: '#3E8FD1' },
];
export const colorHex = (id) => (COLORS.find((c) => c.id === id) || COLORS[0]).hex;

/**
 * Seat colours: each person, in seat order, gets their first ranked colour
 * nobody earlier holds, then their second, then their third, then the next
 * free palette colour. Bots take what is left. Runs once, when the table
 * starts (the earlier build assigned at "preview" time, which locked colours
 * before the people who cared had sat down).
 */
export function assignSeatColors(seats) {
  const taken = new Set();
  const out = [];
  for (const seat of seats) {
    const ranks = Array.isArray(seat.colorRanks) ? seat.colorRanks : [];
    let pick = ranks.find((r) => !taken.has(r) && COLORS.some((c) => c.id === r));
    if (!pick) pick = (COLORS.find((c) => !taken.has(c.id)) || COLORS[0]).id;
    taken.add(pick);
    out.push(pick);
  }
  return out;
}

export const AVATARS = ['\u{1F98A}', '\u{1F43B}', '\u{1F43C}', '\u{1F438}', '\u{1F981}', '\u{1F428}', '\u{1F42F}', '\u{1F989}', '\u{1F419}', '\u{1F422}', '\u{1F984}', '\u{1F433}', '\u{1F43A}', '\u{1F985}', '\u{1F41D}', '\u{1F98B}', '\u{1F42C}', '\u{1F988}', '\u{1F432}', '\u{1F992}', '\u{1F99A}', '\u{1F427}', '\u{1F99C}', '\u{1F417}'];
export const BOT_AVATAR = '\u{1F916}';

// ---- guest names ----------------------------------------------------------------
// Two guests at one table both called "Guest" cannot tell each other apart,
// so every guest gets a name of their own until they pick one.
const GUEST_ADJ = ['Bold', 'Bright', 'Calm', 'Clever', 'Daring', 'Eager', 'Keen', 'Lucky', 'Nimble', 'Quick', 'Sharp', 'Steady'];
const GUEST_NOUN = ['Falcon', 'Otter', 'Fox', 'Heron', 'Lynx', 'Badger', 'Kestrel', 'Marten', 'Osprey', 'Raven', 'Stoat', 'Wren'];
export function guestName(id) {
  const n = parseInt(String(id).replace(/-/g, '').slice(0, 8), 16) || 0;
  return `${GUEST_ADJ[n % 12]} ${GUEST_NOUN[Math.floor(n / 12) % 12]} ${Math.floor(n / 144) % 90 + 10}`;
}
const GUEST_NAME_RE = new RegExp(`^(guest|player|(${GUEST_ADJ.join('|')}) (${GUEST_NOUN.join('|')}) \\d\\d)$`, 'i');
/** True for a name nobody chose: "Guest", "Player" or a generated guest name. */
export const isGuestName = (name) => GUEST_NAME_RE.test(String(name || '').trim());

// ---- profile completion (the "survey score") ----------------------------------
// Contact details, photo and location earn nothing: people should never feel
// paid to hand over a phone number.
// "identity" excludes only the two placeholder names. (Bug: the test was a
// prefix match, so "Guestav" or "Playerson" could never earn the 10 points.)
export const SURVEY_PARTS = [
  { id: 'identity', label: 'Name and colours', points: 10, done: (u) => !!u.displayName && !isGuestName(u.displayName) && (u.colorRanks || []).length > 0 },
  { id: 'cardsort', label: 'Business-savvy card sort', points: 15, done: (u) => !!u.archetype },
  { id: 'headline', label: 'One line about you', points: 10, done: (u) => !!(u.headline || '').trim() },
  { id: 'stage', label: 'Stage', points: 10, done: (u) => !!u.stage },
  { id: 'industry', label: 'Industry or interests', points: 10, done: (u) => !!(u.industry || '').trim() || (u.interests || []).length > 0 },
  { id: 'intent', label: 'What you are looking for', points: 15, done: (u) => (u.intent || []).length > 0 || !!(u.lookingFor || '').trim() },
  { id: 'goals', label: 'Goals', points: 10, done: (u) => !!(u.goals || '').trim() },
  { id: 'project', label: 'What you are building', points: 10, done: (u) => !!(u.currentProject || '').trim() },
  { id: 'skills', label: 'Skills', points: 5, done: (u) => (u.skills || []).length > 0 },
  { id: 'links', label: 'A social link', points: 5, done: (u) => Object.keys(u.socialLinks || {}).length > 0 },
];
export function surveyScore(u) {
  return SURVEY_PARTS.reduce((sum, part) => sum + (part.done(u) ? part.points : 0), 0);
}
/** Bonus tier reached at a score: 50% / 80% / 100% pay 50 points each. */
export const surveyBonusTier = (score) => (score >= 100 ? 3 : score >= 80 ? 2 : score >= 50 ? 1 : 0);
export const SURVEY_BONUS_TOTAL = [0, 50, 100, 150];
export const PROFILE_GATE = 70;

export const SOCIAL_KEYS = [
  { id: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/you' },
  { id: 'x', label: 'X / Twitter', placeholder: 'https://x.com/you' },
  { id: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/you' },
  { id: 'website', label: 'Website', placeholder: 'https://yourcompany.com' },
  { id: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@you' },
];

// ---- play style: six dimensions read from how people actually play ------------
export const STYLE_DIMS = ['risk', 'horizon', 'negotiation', 'cooperation', 'speed', 'resilience'];
export const STYLE_LABELS = { risk: 'Risk', horizon: 'Horizon', negotiation: 'Negotiation', cooperation: 'Cooperation', speed: 'Speed', resilience: 'Resilience' };

export const PERSONAS = {
  Dealmaker: 'Negotiation-led: you hold out for the better trade.',
  Wildcard: 'High risk, fast moves: you make the table nervous.',
  Connector: 'Cooperative and social: the table talks when you are in it.',
  Closer: 'Strong under pressure: you come back from behind.',
  Builder: 'Long horizon, cooperative: you build things that compound.',
  Strategist: 'Long horizon, competitive: you plan several moves ahead.',
  Operator: 'Deliberate and steady: low variance, few mistakes.',
  Explorer: 'Trying everything: your style is still taking shape.',
};

/** First matching rule wins. */
export function personaLabel(p) {
  if (p.negotiation >= 65) return 'Dealmaker';
  if (p.risk >= 65 && p.speed >= 60) return 'Wildcard';
  if (p.cooperation >= 70) return 'Connector';
  if (p.resilience >= 68) return 'Closer';
  if (p.horizon >= 60 && p.cooperation >= 55) return 'Builder';
  if (p.horizon >= 60) return 'Strategist';
  if (p.risk <= 40 && p.speed <= 55) return 'Operator';
  return 'Explorer';
}
const PERSONA_PAIRS = new Set(['Builder|Dealmaker', 'Operator|Wildcard', 'Connector|Strategist', 'Closer|Explorer']);
export const personasComplement = (a, b) => !!a && !!b && PERSONA_PAIRS.has([a, b].sort().join('|'));

/** One line for the result card, from this game's signals alone. */
export function styleInsight(s) {
  if (!s) return null;
  if (s.negotiation >= 65) return 'You held out for the better deal: classic Dealmaker.';
  if (s.risk >= 65) return 'Most of your game went into high-variance bets. Bold: a Wildcard table.';
  if (s.horizon >= 60) return 'You invested in things that pay later over quick wins: a long-horizon game.';
  if (s.resilience >= 68) return 'You were behind at the midpoint and finished stronger. That is a Closer\'s game.';
  if (s.risk <= 40 && s.speed <= 55) return 'Steady, low-variance, deliberate turns: an Operator\'s game.';
  if (s.speed >= 75) return 'Fast turns all game. Speed is a style; watch it does not become a habit under pressure.';
  return 'Trying everything: your style is still taking shape.';
}

// ---- ranks ---------------------------------------------------------------------
/** Per-game skill rank from a rating. */
export function skillRank(rating) {
  if (rating >= 1450) return { name: 'Mogul', icon: '\u{1F451}' };
  if (rating >= 1300) return { name: 'Shark', icon: '\u{1F988}' };
  if (rating >= 1150) return { name: 'Operator', icon: '⚙️' };
  return { name: 'Apprentice', icon: '\u{1F331}' };
}
/** Overall Arena rank: play, skill and contribution together. */
export function arenaRank({ rating = 1200, games = 0, points = 0 }) {
  if (games >= 40 && rating >= 1500 && points >= 1500) return 'Mogul';
  if (games >= 20 && rating >= 1350 && points >= 600) return 'Partner';
  if (games >= 10 && rating >= 1250) return 'Operator';
  if (games >= 3) return 'Founder';
  return 'Rookie';
}

export function repBand(score = 100) {
  if (score >= 150) return { label: 'Trusted', color: '#5fc27a' };
  if (score >= 50) return { label: 'Good standing', color: '#e8b64a' };
  return { label: 'New', color: '#8a97b5' };
}

/** Points paid for the things members do. */
export const POINTS = { checkin: 10, checkinStreak: 15, quizRight: 10, quizWrong: 3, topicReply: 5, gamePlayed: 10, gameWon: 25, challengeAccepted: 5, referral: 20 };
export const POINT_LABELS = { checkin: 'Daily check-in', quiz: 'Daily quiz', topic_reply: 'Joined the Topic of the Day', game_played: 'Played a game', game_won: 'Won a game', challenge_accepted: 'Accepted a challenge', referral: 'Referral', survey: 'Profile completed' };

export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}
