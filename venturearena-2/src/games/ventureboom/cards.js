// VentureBoom(TM) card data: the 70-card deck from the owner's rulebook.
// Data only. No React, no rules: rules.js, the bot, the board and meta all
// read from here so a card's name, text and link exist in exactly one place.
//
// Two things the rulebook is strict about, kept true here:
//  * Real entrepreneurs never appear on a card. Every founder is an original
//    parody character; the real person lives only on the linked Hall of Fame
//    web page, which is addressed by the CARD's slug, never by a person's name.
//  * All names, rule wording and flavour lines are original.
//
// Card ids are opaque ("c01".."c70") on purpose. Public state refers to cards
// by `key` (the slug of the card's name) in the log, and by id only while the
// card sits in a public zone (discard pile, Exit areas, a pending play). A
// test searches every browser's view for ids it must not know; opaque ids
// make that search exact.

const BASE = 'https://venturemaker.org/ventureboom';

/** kebab-case of a card name: "It's-Like-X-for-Y Yuri" -> "its-like-x-for-y-yuri". */
export function slug(name) {
  return String(name).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The six founder sets. `icon` is Emoji 11 or older (see scripts/check-emoji.mjs). */
export const SETS = {
  inventors: { id: 'inventors', name: 'Inventors', nickname: 'The Garage Tinkerers', gag: 'Everything smells like solder; nothing has a case yet', icon: '\u{1F527}', color: '#c2582a' },
  innovators: { id: 'innovators', name: 'Innovators', nickname: 'The Disruptors', gag: 'Currently disrupting brunch', icon: '\u{1F4A1}', color: '#6f4fd0' },
  operators: { id: 'operators', name: 'Operators', nickname: 'The Spreadsheet Whisperers', gag: 'Color-coded their own wedding', icon: '\u{1F4CA}', color: '#1f8a76' },
  investors: { id: 'investors', name: 'Investors', nickname: 'The Vest Army', gag: 'Fleece vest, no socks, strong opinions', icon: '\u{1F4B0}', color: '#2f6fbd' },
  hustlers: { id: 'hustlers', name: 'Hustlers', nickname: 'The Hype Machines', gag: 'Has pitched you twice during this sentence', icon: '\u{1F4E3}', color: '#c23a73' },
  connectors: { id: 'connectors', name: 'Connectors', nickname: 'The Coffee Chatters', gag: 'Knows a guy. Knows the guy.', icon: '☕', color: '#8f6a1f' },
};
export const SET_IDS = Object.keys(SETS);

/** Card types: label, icon, colour band, rule text (full, and a short line that fits a hand card). */
export const TYPES = {
  boom: { label: 'BOOM!', icon: '\u{1F4A5}', color: '#c63b28', rule: 'Reveal it the moment you draw it. No Pivot in hand? You are bankrupt and the round ends.', short: 'No Pivot? Bankrupt.' },
  pivot: { label: 'Pivot', icon: '\u{1F504}', color: '#2e8f52', rule: 'Cancels a BOOM. Secretly slide the BOOM back anywhere in the deck. Ends your turn.', short: 'Cancels a BOOM.' },
  pass: { label: 'Hard Pass', icon: '\u{1F6AB}', color: '#a8324f', rule: 'Stops any action except a BOOM or a Pivot. Play it any time, even off-turn. A Hard Pass can be Hard Passed.', short: 'Stops any action.' },
  hostile: { label: 'Hostile Takeover', icon: '\u{1F988}', color: '#5d43ad', rule: 'End your turn without drawing. The next player takes 2 turns. Stacks: pass it on and it grows by 2.', short: 'Skip your draw. Next player: 2 turns.' },
  ooo: { label: 'Out of Office', icon: '\u{1F334}', color: '#22789f', rule: 'End one turn without drawing.', short: 'End a turn without drawing.' },
  research: { label: 'Market Research', icon: '\u{1F50D}', color: '#2b7f6e', rule: 'Secretly look at the top 3 cards of the draw pile. They stay in order.', short: 'Peek at the top 3 cards.' },
  reorg: { label: 'Reorg', icon: '\u{1F500}', color: '#a86b18', rule: 'Shuffle the draw pile.', short: 'Shuffle the draw pile.' },
  mentor: { label: 'Ask a Mentor', icon: '\u{1F393}', color: '#3d59b8', rule: 'Pick a player. They give you one card of their choice.', short: 'A player gives you a card.' },
  founder: { label: 'Founder', icon: '\u{1F464}', color: '#5b6478', rule: 'No power alone. Pair two from a set to Poach, three to Acqui-hire, or bank a set as an Exit.', short: 'Collect the set.' },
  unicorn: { label: 'Unicorn', icon: '\u{1F984}', color: '#b0841f', rule: 'Wild. Counts as any founder in any set.', short: 'Wild: any founder, any set.' },
};

// The rulebook's Business Dynamics table: the real business move behind each mechanic.
const DYN = {
  'server-fire': 'Operational outage risk',
  'cofounder-breakup': 'Founder conflict',
  lawsuit: 'Legal and IP risk',
  'bubble-pops': 'Market cycles and hype',
  runway: 'Burn rate and runway',
  pivot: 'The pivot',
  'hard-pass': 'Investor rejection',
  'hostile-takeover': 'Hostile acquisitions',
  'out-of-office': 'Strategic patience',
  'market-research': 'Customer discovery',
  reorg: 'Restructuring',
  mentor: 'Mentorship',
  unicorn: 'Valuation and hype',
  poach: 'Talent wars',
  'acqui-hire': 'Buying teams, not products',
  portfolio: 'Diversification and the power law',
  exits: 'Acquisitions and IPOs',
  'default-alive': 'Default alive',
};
const dyn = (s) => ({ dynamic: DYN[s], link: `${BASE}/dynamics/${s}` });

/** Dynamics that belong to a move rather than a card (combos, Exits, the survival bonus). */
export const DYNAMICS = {
  poach: { name: 'Poach', ...dyn('poach') },
  acquihire: { name: 'Acqui-hire', ...dyn('acqui-hire') },
  review: { name: 'Portfolio Review', ...dyn('portfolio') },
  exits: { name: 'Exits', ...dyn('exits') },
  survival: { name: 'Survival bonus', ...dyn('default-alive') },
};

const BOOMS = [
  ['Server Fire', 'server-fire', 'Have you tried turning it off and... oh. It is off.'],
  ['Co-Founder Breakup', 'cofounder-breakup', 'They got the logo. You got the stapler.'],
  ['The Lawsuit', 'lawsuit', 'Turns out "borrowed" is not a legal term.'],
  ['The Bubble Pops', 'bubble-pops', 'Everything was worth a billion. Was.'],
  ['Runway Ran Out', 'runway', 'The plane was fine. The runway was made of money.'],
];

const PIVOT_LINES = [
  "We're an AI company now.",
  'It was always a B2B play.',
  'Pivot to video.',
  "Actually, it's a platform.",
  'We call it a strategic realignment.',
  'Same product, new logo.',
  "We're pre-revenue by choice.",
];

const PASS_LINES = [
  "It's a no from me.",
  "We'll circle back. (We won't.)",
  'Love the energy. Hate the idea.',
  'Not a fit for our thesis. Our thesis is "no".',
  'Per my last email: no.',
];
const HOSTILE_LINES = [
  "Nothing personal. It's just all of your business.",
  'We admire what you built. We will take it from here.',
  'Congratulations on your new owners.',
  'The offer is generous. The offer is also not optional.',
];
const OOO_LINES = [
  'I am away with limited access to consequences.',
  'Back Monday. Which Monday is confidential.',
  'For urgent matters, please contact literally anyone else.',
  'Currently on a beach, thinking about synergy.',
];
const RESEARCH_LINES = [
  'We surveyed three people. Two were my mum.',
  'The focus group focused mostly on the snacks.',
  'Nine out of ten customers did not open the email.',
  'Our data says people like things that are good.',
  'Peeked at the competition. They are peeking back.',
];
const REORG_LINES = [
  'New org chart. Same chairs.',
  'Everyone now reports to someone surprised to hear it.',
  'We moved the boxes. The lines are still confused.',
  'Your new team is your old team, sideways.',
];
const MENTOR_LINES = [
  'Got a minute? Great. Got a card?',
  'In my day we pivoted uphill, both ways.',
  'Free advice, and worth every penny.',
  'Let me tell you about the time I almost bought the internet.',
];
const UNICORN_LINES = [
  'Valued at a billion. Revenue: vibes.',
  'Mythical, magical, mostly marketing.',
];

// [name, flavour]. The Gantt Chart Gary line is the owner's; the rest follow its voice.
const FOUNDERS = {
  inventors: [
    ['Duct Tape Dana', 'Fixed the prototype, the chair and this sentence with one roll.'],
    ['Prototype Pete', 'Version 47 only caught fire a little. Eyebrows are overrated.'],
    ['Patent Pending Priya', 'Filed a patent on filing patents. It is pending.'],
    ['Sir Solders-a-Lot', 'Knighted for bravery near a hot iron. Smells faintly of flux.'],
    ['Widget Wendy', 'Built a gadget to find her other gadgets. It is lost too.'],
  ],
  innovators: [
    ['Disrupto the Great', 'Disrupted brunch. It is now called "lunch, but earlier".'],
    ['Blockchain Brad', 'Put a blockchain on a toaster. The toast is now permanent.'],
    ['Moonshot Molly', 'Her five-year plan has one step. It is the moon.'],
    ['Forever-Beta Bea', 'Launching any day now. Has said so every day for six years.'],
    ["It's-Like-X-for-Y Yuri", "It's like a sandwich, but for meetings. Investors nodded."],
  ],
  operators: [
    ['Gantt Chart Gary', "Scheduled this card being played. It's 4 minutes late."],
    ['Process Patty', 'Has a seven-step process for writing a seven-step process.'],
    ['KPI Kevin', 'Tracks his high-fives. Up 12% quarter over quarter.'],
    ['SOP Sofia', 'Wrote the manual for making coffee. Chapter 4 is the mug.'],
    ['Actually-Ships-It Ashok', 'While you were reading this card, he shipped it.'],
  ],
  investors: [
    ['Term Sheet Terry', 'Reads the fine print for fun. Brings a highlighter to birthday cards.'],
    ['Due Diligence Dee', 'Asked this card for three references. Two called back.'],
    ['Angel Annie', 'Wrote a cheque on a napkin. The napkin now has a board seat.'],
    ['Cap Table Carl', 'Owns 2% of this joke and would like to discuss dilution.'],
    ['Keep-Me-Posted Phil', 'Loves it. Not investing. Keep him posted.'],
  ],
  hustlers: [
    ['Cold Call Carla', 'Called you before you owned a phone. Left a voicemail anyway.'],
    ['Hashtag Hank', '#Blessed #Grinding #ForgotWhatWeSell'],
    ['Pitch Deck Penny', 'Slide 3 is the hockey stick. So are slides 4 through 19.'],
    ['Closer Clyde', 'Sold a doorbell to a tent. Upsold the chime.'],
    ['Swag Bag Sam', 'No product yet, but the hoodies are incredible.'],
  ],
  connectors: [
    ['Warm Intro Walt', 'Knows a guy. That guy knows a guy. You will love them both.'],
    ['Name-Drop Nina', 'As she was telling someone very famous only yesterday...'],
    ['Conference Badge Bob', 'Wearing nine lanyards. Not sure which conference this is.'],
    ['Rolodex Rita', "Has your number. Also your dentist's. Also your dentist's dog's."],
    ["Let's-Grab-Coffee Lou", 'Fourteen coffees booked today. Vibrating slightly.'],
  ],
};

function build() {
  const out = [];
  let n = 0;
  const add = (card) => { n += 1; out.push({ id: `c${String(n).padStart(2, '0')}`, ...card }); };
  const typed = (type, name, flavor, slugName) => add({
    type, name, key: slug(name), rule: TYPES[type].rule, short: TYPES[type].short, flavor, icon: TYPES[type].icon, ...dyn(slugName),
  });
  for (const [name, s, flavor] of BOOMS) typed('boom', name, flavor, s);
  for (const line of PIVOT_LINES) typed('pivot', 'Pivot', `"${line}"`, 'pivot');
  for (const line of PASS_LINES) typed('pass', 'Hard Pass', line, 'hard-pass');
  for (const line of HOSTILE_LINES) typed('hostile', 'Hostile Takeover', line, 'hostile-takeover');
  for (const line of OOO_LINES) typed('ooo', 'Out of Office', line, 'out-of-office');
  for (const line of RESEARCH_LINES) typed('research', 'Market Research', line, 'market-research');
  for (const line of REORG_LINES) typed('reorg', 'Reorg', line, 'reorg');
  for (const line of MENTOR_LINES) typed('mentor', 'Ask a Mentor', line, 'mentor');
  for (const set of SET_IDS) {
    for (const [name, flavor] of FOUNDERS[set]) {
      add({
        type: 'founder', name, key: slug(name), set, rule: TYPES.founder.rule, short: SETS[set].name, flavor, icon: SETS[set].icon,
        // Founder cards have no row of their own in the Business Dynamics
        // table: their Hall of Fame page covers the three founder dynamics.
        dynamic: [DYN.poach, DYN['acqui-hire'], DYN.exits].join(' / '),
        link: `${BASE}/hof/${slug(name)}`,
      });
    }
  }
  for (const line of UNICORN_LINES) typed('unicorn', 'Unicorn', line, 'unicorn');
  return out;
}

/** The whole deck, 70 cards. */
export const CARDS = build();
/** id -> card. */
export const CARD = Object.fromEntries(CARDS.map((c) => [c.id, c]));
/** key (slug of the name) -> the first card with that name, for showing a card the log names. */
export const BY_KEY = {};
for (const c of CARDS) if (!BY_KEY[c.key]) BY_KEY[c.key] = c;

/** Card names a player may call for an Acqui-hire: anything that can be in a hand. */
export const NAMEABLE = [...new Set(CARDS.filter((c) => c.type !== 'boom').map((c) => c.key))];

export const typeOf = (id) => (CARD[id] ? CARD[id].type : null);
export const keyOf = (id) => (CARD[id] ? CARD[id].key : null);
export const WORDMARK = 'VentureBoom™';
export const MAKER_LINE = 'a VentureMaker™ learning game';
export const HOME_LINK = BASE;
