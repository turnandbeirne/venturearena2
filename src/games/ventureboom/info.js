// VentureBoom(TM): what the table's Progress, Key and "Cards seen" tabs show.
// Pure data and pure functions of what every browser already has. Nothing in
// here reads a hand or the draw pile: G.players and G.secret are stripped
// before the state reaches a browser, and a spectator gets the same answers.
import { CARDS, CARD, SETS, SET_IDS, TYPES, DYNAMICS, BY_KEY } from './cards.js';
import { STORIES, SET_TRAITS, STORY_NOTE } from './hall-of-fame/stories.js';
import { EXIT_NAMES, REACT_MS, CHOICE_MS, BETWEEN_MS, HOLD_MS } from './rules.js';

const EXIT_LINE = 'Seed (3 of a set) $3M, Series A (4) $6M, Dream Team (all 5) $10M, Full-Stack Company (one from each of the six sets) $15M.';
const money = (n) => `$${n}M`;
const num = (v) => (Number.isFinite(v) ? v : 0);

/** How far along the game is, and what each seat has banked. */
export function progress(G) {
  const n = num(G.n);
  const rounds = Math.max(1, num(G.rounds));
  const round = Math.min(rounds, Math.max(1, num(G.round)));
  const seats = Array.from({ length: n }, (_, s) => s);
  const exits = (s) => (Array.isArray(G.exits) && Array.isArray(G.exits[s]) ? G.exits[s] : []);
  const stat = (s) => (Array.isArray(G.stats) && G.stats[s]) || {};
  const notes = [];
  if (!G.over) notes.push(`${num(G.deckCount)} card${num(G.deckCount) === 1 ? '' : 's'} left in the draw pile, ${Math.max(0, n - 1)} of them BOOMs at the start of each quarter.`);
  if (G.hot) notes.push('Hot Market: every Exit is worth double.');
  else if (G.hotMarket && !G.over) notes.push(`Hot Market starts in quarter ${Math.max(1, rounds - 2)}: Exits are worth double for the last three quarters.`);
  return {
    stage: { label: G.over ? `All ${rounds} quarters played` : `Quarter ${round} of ${rounds}`, done: G.over ? rounds : round - 1, of: rounds, caption: G.over ? null : `${round - 1} of ${rounds} quarters finished` },
    columns: ['Valuation', 'Exits this quarter', 'Cards in hand', 'Bankruptcies', 'BOOMs survived'],
    rows: seats.map((s) => [
      money(num(Array.isArray(G.scores) ? G.scores[s] : 0)),
      exits(s).length ? `${exits(s).length} (${money(exits(s).reduce((a, e) => a + num(e.value), 0))})` : '0',
      num(Array.isArray(G.counts) ? G.counts[s] : 0),
      num(Array.isArray(G.bankruptcies) ? G.bankruptcies[s] : 0),
      num(stat(s).boomsSurvived),
    ]),
    notes,
  };
}

/** The order the kinds are listed in, everywhere. */
const KIND_ORDER = ['boom', 'pivot', 'pass', 'hostile', 'ooo', 'research', 'reorg', 'mentor', 'founder', 'unicorn'];

/**
 * VentureBoom has no dice: its luck is the draw pile. This is the same kind of
 * record for a card game: how many of each kind are face up on the table this
 * quarter (the discard pile and everyone's Exits), against how many are in
 * play. What is not face up is in a hand or still in the pile.
 */
export function rolls(G) {
  const n = num(G.n);
  const inPlay = {};
  for (const c of CARDS) {
    if (c.type === 'boom') continue;
    if (G.kids && c.type === 'hostile') continue;
    inPlay[c.type] = (inPlay[c.type] || 0) + 1;
  }
  inPlay.boom = Math.max(0, n - 1);
  const seen = {};
  const count = (id) => { const c = CARD[id]; if (c) seen[c.type] = (seen[c.type] || 0) + 1; };
  for (const id of Array.isArray(G.discard) ? G.discard : []) count(id);
  for (const list of Array.isArray(G.exits) ? G.exits : []) for (const e of list || []) for (const id of e.cards || []) count(id);
  const kinds = KIND_ORDER.filter((t) => inPlay[t]);
  const total = kinds.reduce((a, t) => a + (seen[t] || 0), 0);
  return [{
    id: 'seen', title: 'Cards face up this quarter', unit: 'cards', total,
    note: 'Counted from the discard pile and the Exits on the table. Everything else is in a hand or still in the draw pile. A BOOM that was dodged with a Pivot goes back into the pile, so it does not show here.',
    bars: kinds.map((t) => ({ label: t === 'founder' ? 'Founders' : TYPES[t].label, value: Math.min(seen[t] || 0, inPlay[t]), of: inPlay[t] })),
  }];
}
export const rollsLabel = 'Cards seen';

// ---- the Key ------------------------------------------------------------------------
const copies = (type) => CARDS.filter((c) => c.type === type).length;
const story = (k) => { const s = STORIES[k]; return s ? { trait: s.trait, lesson: s.lesson, story: { who: s.who, text: s.story } } : {}; };

/** One entry per card NAME (the seven Pivots are one entry). */
function cardItem(c, extra = {}) {
  return { id: c.key, name: c.name, icon: c.icon, art: c.key, power: c.rule, flavor: c.flavor, dynamic: c.dynamic, ...story(c.key), ...extra };
}
function typeItem(type, extra = {}) {
  const c = CARDS.find((x) => x.type === type);
  const n = copies(type);
  return cardItem(c, { count: `${n} in the deck`, flavor: null, ...extra });
}

export const key = {
  intro: `Seventy cards. ${copies('founder')} are founders in six sets of five, the rest bend the rules, and the BOOMs end the quarter for whoever cannot dodge one. Every card stands for a real business move, and each has a true story behind it.`,
  note: STORY_NOTE,
  groups: [
    {
      id: 'booms', name: 'BOOMs', icon: TYPES.boom.icon,
      blurb: `The five ways a startup dies. ${TYPES.boom.rule} One fewer than the number of players is shuffled into the draw pile each quarter.`,
      items: CARDS.filter((c) => c.type === 'boom').map((c) => cardItem(c)),
    },
    {
      id: 'saves', name: 'Saves and stops', icon: TYPES.pivot.icon,
      blurb: 'The two cards you play in answer to something. Everyone starts each quarter holding one Pivot.',
      items: [typeItem('pivot'), typeItem('pass')],
    },
    {
      id: 'actions', name: 'Action cards', icon: TYPES.research.icon,
      blurb: 'Played on your own turn, before you draw. Any of them can be stopped by a Hard Pass.',
      items: ['hostile', 'ooo', 'research', 'reorg', 'mentor'].map((t) => typeItem(t)),
    },
    ...SET_IDS.map((id) => ({
      id, name: SETS[id].name, icon: SETS[id].icon, color: SETS[id].color,
      blurb: `${SETS[id].nickname}. ${SET_TRAITS[id].line} ${TYPES.founder.rule} Running gag: ${SETS[id].gag.toLowerCase()}.`,
      items: CARDS.filter((c) => c.type === 'founder' && c.set === id).map((c) => cardItem(c, { power: `One of the five ${SETS[id].name}. Collect the set.`, dynamic: null })),
    })),
    {
      id: 'wild', name: 'Wild', icon: TYPES.unicorn.icon,
      blurb: 'Stands in for any founder you are missing.',
      items: [typeItem('unicorn')],
    },
    {
      id: 'moves', name: 'What founders are for', icon: '\u{1F91D}',
      blurb: 'Founder cards do nothing alone. These are the five things a group of them can do.',
      items: [
        { id: 'exits', name: 'Exit', icon: '\u{1F3C6}', art: null, power: `Bank founders from your hand for points. ${EXIT_LINE} Cards still in your hand when the quarter ends score nothing.`, dynamic: DYNAMICS.exits.dynamic, ...story('exits') },
        { id: 'poach', name: 'Poach', icon: '\u{1F3A3}', art: null, power: 'Play two founders from one set: take a random card from another player\'s hand.', dynamic: DYNAMICS.poach.dynamic, ...story('poach') },
        { id: 'acquihire', name: 'Acqui-hire', icon: '\u{1F9F2}', art: null, power: 'Play three founders from one set: name a card and a player. If they hold it, it is yours.', dynamic: DYNAMICS.acquihire.dynamic, ...story('acquihire') },
        { id: 'review', name: 'Portfolio Review', icon: '\u{1F5C2}\u{FE0F}', art: null, power: 'Play five different cards: take any one card from the discard pile.', dynamic: DYNAMICS.review.dynamic, ...story('review') },
        { id: 'survival', name: 'Survival bonus', icon: '\u{1F331}', art: null, power: 'When someone goes bankrupt, every other player scores $1M just for still being in business.', dynamic: DYNAMICS.survival.dynamic, ...story('survival') },
      ],
    },
  ],
};

/** The Key entry a card's "?" opens: its own for a founder or a BOOM, its kind's otherwise. */
export function keyIdFor(card) {
  if (!card) return null;
  return BY_KEY[card.key] ? card.key : null;
}

// ---- what happened, in the table's words ---------------------------------------------
// One sentence per log entry, and a second that says what it means for the
// table. The board's announcer and the drawer's "What happened" list both
// read these, so a move is never worded two ways. `nm(seat)` gives the name
// to use for a seat ("You" for the reader's own).
const cardName = (k) => (BY_KEY[k] ? BY_KEY[k].name : k);

export function describe(e, nm) {
  switch (e.t) {
    case 'deal': return `Quarter ${e.round} dealt. ${nm(e.first)} to start.${e.hot ? ' Hot Market: Exits pay double.' : ''}`;
    case 'play': return `${nm(e.p)} played ${cardName(e.k)}${e.k === 'ask-a-mentor' ? ` on ${nm(e.to)}` : ''}`;
    case 'combo': return e.k === 'poach' ? `${nm(e.p)} played a Poach on ${nm(e.to)}` : e.k === 'acquihire' ? `${nm(e.p)} called an Acqui-hire on ${nm(e.to)} for ${cardName(e.named)}` : `${nm(e.p)} called a Portfolio Review`;
    case 'offer': return `${nm(e.p)} laid down a ${EXIT_NAMES[e.k]} (${money(e.value)})`;
    case 'pass': return `${nm(e.p)} played a Hard Pass!`;
    case 'cancel': return e.kind === 'exit' ? 'The deal fell through: its cards go to the discard pile' : 'Stopped by a Hard Pass';
    case 'exit': return `${nm(e.p)} banked a ${EXIT_NAMES[e.k]}: +${money(e.value)}`;
    case 'attack': return `Hostile Takeover: ${nm(e.to)} must take ${e.turns} turns`;
    case 'skip': return `${nm(e.p)} went Out of Office: no draw`;
    case 'peek': return `${nm(e.p)} looked at the top ${e.c} card${e.c === 1 ? '' : 's'}`;
    case 'shuffle': return `${nm(e.p)} shuffled the draw pile`;
    case 'ask': return `${nm(e.to)} must hand ${nm(e.p)} a card`;
    case 'gave': return e.ok ? `${nm(e.p)} handed ${nm(e.to)} a card` : `${nm(e.p)} had no card to give`;
    case 'steal': return e.ok ? `${nm(e.p)} poached a card from ${nm(e.from)}` : `${nm(e.from)} had nothing to poach`;
    case 'hire': return e.ok ? `${nm(e.from)} handed over ${cardName(e.named)}` : `${nm(e.from)} had no ${cardName(e.named)}`;
    case 'review': return `${nm(e.p)} searched the discard pile`;
    case 'took': return `${nm(e.p)} took ${cardName(e.k)} from the discard pile`;
    case 'draw': return `${nm(e.p)} drew a card`;
    case 'boom': return `${nm(e.p)} drew a BOOM: ${cardName(e.k)}!`;
    case 'pivot': return `${nm(e.p)} pivoted and survived`;
    case 'placed': return `${nm(e.p)} slid the BOOM back into the pile`;
    case 'bust': return `${nm(e.p)} went bankrupt`;
    case 'round': return `Quarter ${e.round} closed`;
    case 'refill': return 'The discards were shuffled into the draw pile';
    default: return null;
  }
}

/** What the entry means for the table: the rule behind it, in a line. Null when the sentence says it all. */
export function explain(e) {
  const type = e.k && BY_KEY[e.k] ? BY_KEY[e.k].type : null;
  switch (e.t) {
    case 'play': return type ? `${TYPES[type].rule} Anyone can stop it with a Hard Pass.` : null;
    case 'combo': return e.k === 'poach' ? 'Two founders from one set: take a random card from that player, unless someone plays a Hard Pass.'
      : e.k === 'acquihire' ? 'Three founders from one set: if that player holds the named card, it changes hands. A Hard Pass stops it.'
        : 'Five different cards: take any one card from the discard pile, unless someone plays a Hard Pass.';
    case 'offer': return 'An Exit banks founders for points. It goes through unless someone plays a Hard Pass.';
    case 'pass': return 'A Hard Pass stops the action. Another Hard Pass on top of it puts the action back on.';
    case 'cancel': return e.kind === 'exit' ? 'Nothing was scored, and the founders are gone from that hand.' : 'The card is spent and nothing happens.';
    case 'exit': return 'Banked for good: it counts in the final valuation whatever happens next.';
    case 'attack': return 'The player who played it skipped their own draw. Play another Hostile Takeover to pass the turns on, plus two.';
    case 'skip': return 'Not drawing means not risking a BOOM this turn.';
    case 'peek': return 'Only they saw the cards. The order of the pile did not change.';
    case 'shuffle': return 'Anything anyone knew about the order of the pile is now out of date.';
    case 'ask': return 'They choose which card to give.';
    case 'steal': return e.ok ? 'The card was picked at random. Only the two of them know which.' : null;
    case 'hire': return e.ok ? 'They guessed right.' : 'A wrong guess: the three founders are spent for nothing.';
    case 'boom': return 'A Pivot in hand cancels it. No Pivot means bankruptcy.';
    case 'pivot': return 'The Pivot is spent, and they slide the BOOM back into the pile wherever they like.';
    case 'placed': return 'Only they know where it is.';
    case 'bust': return 'The quarter ends here. Everyone else scores $1M for surviving, and all hands are thrown in.';
    case 'deal': return 'Everyone has eight cards, one of them a Pivot.';
    default: return null;
  }
}

/**
 * How long an entry stays on the board's announcer at the Steady pace: the
 * same time the server holds the robots back after it (rules.js HOLD_MS).
 */
export const holdOf = (e) => HOLD_MS[e.t] || 1500;

/**
 * Entries the announcer leaves to the panel that is already on screen: a card,
 * combo or Exit waiting for Hard Passes is shown there with its explanation,
 * and so is a choice somebody is making. They are all in the "Moves" list.
 */
export const SHOWN_BY_PANEL = ['play', 'combo', 'offer', 'ask', 'review', 'round'];

/** The pauses the table runs on, before the table's pace stretches them (shared/pace.js). */
export const WINDOWS = { react: REACT_MS, choice: CHOICE_MS, between: BETWEEN_MS };
