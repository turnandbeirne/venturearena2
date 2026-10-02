// Membership tiers and the ONE feature table. The server enforces it
// (server/arena/*.js call allows()), the client mirrors it for buttons and
// copy. Changing who gets a feature is a one-line edit here.

export const TIERS = ['anonymous', 'free', 'member', 'vip', 'ceo'];
export const TIER_RANK = Object.fromEntries(TIERS.map((t, i) => [t, i]));

export const TIER_INFO = {
  anonymous: { name: 'Guest', price: 0, priceLabel: 'Free', frame: 'Try it' },
  free: { name: 'Registered', price: 0, priceLabel: 'Free', frame: 'Play' },
  member: { name: 'Subscriber', price: 9.99, priceLabel: '$9.99/mo', frame: 'Connect' },
  vip: { name: 'VIP', price: 49, priceLabel: '$49/mo', frame: 'Be introduced' },
  ceo: { name: 'CEO', price: 249, priceLabel: '$249/mo', frame: 'Be sought out' },
};

/** feature -> lowest tier that has it. */
export const FEATURES = {
  play: 'anonymous',
  host_table: 'anonymous',
  table_chat: 'anonymous',
  daily_quiz: 'anonymous',
  keep_history: 'free',
  player_card: 'free',
  connect: 'free',
  topic_reply: 'free',
  invite: 'free',
  dm_connections: 'free',
  post_ask: 'free',            // opportunities board: "I am looking for..."
  private_table: 'member',
  full_history: 'member',
  view_style: 'member',
  dm_anyone: 'member',
  mentor_match: 'member',
  cofounder_match: 'member',
  full_lessons: 'member',
  custom_settings: 'member',
  unlimited_challenges: 'member',
  post_offer: 'member',        // opportunities board: roles, internships
  investor_match: 'vip',
  head_to_head: 'vip',
  post_venture_call: 'vip',    // opportunities board: incubation, investment, challenges
  saved_presets: 'vip',
  vouch: 'ceo',
  featured: 'ceo',
  curated_intros: 'ceo',
};

export function tierAllows(tier, feature) {
  const need = FEATURES[feature];
  if (!need) return false;
  return TIER_RANK[tier] >= TIER_RANK[need];
}

/** Open tables a host may run at once. */
export const HOST_LIMIT = { anonymous: 1, free: 1, member: 3, vip: 10, ceo: 100 };
/** Challenges a member may send in any 24 hours. */
export const CHALLENGE_LIMIT = { anonymous: 3, free: 10, member: Infinity, vip: Infinity, ceo: Infinity };
/** Connections a member may hold. */
export const CONNECTION_LIMIT = { anonymous: 0, free: 25, member: Infinity, vip: Infinity, ceo: Infinity };
/** Days of other people's play history a viewer may see. */
export const HISTORY_DAYS = { anonymous: 30, free: 30, member: Infinity, vip: Infinity, ceo: Infinity };

/** Membership page content. */
export const TIER_CARDS = [
  { id: 'free', human: 'Play, keep a card, add up to 25 connections.',
    perks: ['Join or host a table, play any game', 'Player card, rating and 30 days of history', 'Connect and message the people you played with', 'Daily topic, quiz, streak and Arena Points', '10 challenges a day'] },
  { id: 'member', human: 'Meet the people you play with.',
    perks: ['Private tables and 3 tables at once', 'Full history and play-style profiles', 'Message anyone', 'Mentor and cofounder matches', 'Full lesson library and fine-grained game settings', 'Post roles and internships'] },
  { id: 'vip', human: 'Warm introductions to mentors and investors.',
    perks: ['Everything in Subscriber', 'Investor matches (opt-in on both sides)', 'Head-to-head records', '10 tables at once and saved presets', 'Post incubation calls, investment theses and business challenges', 'Verified badge'] },
  { id: 'ceo', human: 'For exited founders and investors who want curated peers.',
    perks: ['Everything in VIP', 'Unlimited tables and hosted events', 'Vouch for players', 'Featured placement', 'Curated introductions from the VentureArena team', 'Monthly coaching session'] },
];

/** Programs behind a paid seat (shown on Home and Membership). */
export const PAID_PROGRAMS = [
  { id: 'lessons', label: 'Lessons and best-practice library', short: 'Lessons', tier: 'member' },
  { id: 'matchmaking_plus', label: 'Matchmaking+ (mentor and cofounder intros)', short: 'Matchmaking+', tier: 'member' },
  { id: 'classes', label: 'Live classes and strategy sessions', short: 'Classes', tier: 'member' },
  { id: 'prizes', label: 'Prize-bearing tournaments', short: 'Prizes', tier: 'member' },
  { id: 'pitch_reviews', label: 'Pitch reviews', short: 'Pitch reviews', tier: 'vip' },
  { id: 'recruiting', label: 'Recruiting and venture calls', short: 'Recruiting', tier: 'vip' },
  { id: 'coaching', label: '1:1 coaching and office hours', short: 'Coaching', tier: 'ceo' },
  { id: 'consulting', label: 'Consulting engagements', short: 'Consulting', tier: 'ceo' },
];
