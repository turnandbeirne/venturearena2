// VentureBoom(TM), a VentureMaker(TM) learning game: pure rules.
// No React, no DOM, no clock, no Math.random. The owner's rulebook is the
// specification; every place a tabletop rule needed a digital reading is
// marked "Digital reading" below.
//
// Hidden information is the whole game, so the state is split three ways:
//   G.players[seat]  private to that seat: hand, Market Research memory, and a
//                    private note (which card moved, when only two people know)
//   G.secret         nobody's browser gets it: the draw pile and the box
//   everything else  public mirrors: hand sizes, deck size, discard pile, Exits
// The log and every public field name a card by its `key` (its name), never by
// the id of a card sitting in a hand or the deck. Ids appear publicly only
// while the card itself is face up (discard pile, Exit areas, a pending play).
//
// One definition of "legal": isLegal(). The move validators call it, and
// legalActions() / selectionActions() (the bot and the board) are built on the
// same helpers, reading ONLY what that seat's browser can see.
import { defineGame, refuse, pushLog, countMove, finish, placementsFromScores, isHouse, INVALID_MOVE } from '../kit.js';
import { CARDS, CARD, SET_IDS, NAMEABLE } from './cards.js';

// The bot and the board import card data from here, so a game's client and
// bot depend on one module (HOUSE-RULES section 1).
export { CARDS, CARD, SETS, SET_IDS, TYPES, BY_KEY, NAMEABLE, DYNAMICS, WORDMARK, MAKER_LINE, HOME_LINK } from './cards.js';

export const EXIT_VALUES = { seed: 3, seriesA: 6, dream: 10, fullstack: 15 };
export const EXIT_SIZES = { seed: 3, seriesA: 4, dream: 5, fullstack: 6 };
export const EXIT_NAMES = { seed: 'Seed Exit', seriesA: 'Series A Exit', dream: 'Dream Team', fullstack: 'Full-Stack Company' };
export const COMBO_SIZES = { poach: 2, acquihire: 3, review: 5 };
export const COMBO_NAMES = { poach: 'Poach', acquihire: 'Acqui-hire', review: 'Portfolio Review' };
export const SURVIVAL_BONUS = 1;
export const HAND_DEAL = 7;
/** Card types played on their own, on your turn. Pivot and Hard Pass are reactions; founders and Unicorns only go in sets. */
export const PLAYABLE = ['hostile', 'ooo', 'research', 'reorg', 'mentor'];
/** A round that somehow never draws a BOOM still ends (house rule 9). */
export const ROUND_TURN_CAP = 120;
/** And so does a whole game. Far above any real game (about 12 x 120 turns of a few moves each). */
export const MERCY_MOVES = 40000;
/** How long the house waits before it answers for people who have not. */
export const REACT_MS = 9000;
export const CHOICE_MS = 20000;
export const BETWEEN_MS = 7000;

// ---- settings ---------------------------------------------------------------
/** 12 rounds is the standard game, 4 is "Fiscal Year". 1 and 2 exist for tests only. */
export function normalizeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const rounds = [1, 2, 4, 12].includes(Number(src.rounds)) ? Number(src.rounds) : 12;
  return { ...src, rounds, hotMarket: src.hotMarket === true, kids: src.kids === true };
}

// ---- small helpers ----------------------------------------------------------
const typeOf = (id) => (CARD[id] ? CARD[id].type : null);
const keyOf = (id) => (CARD[id] ? CARD[id].key : null);
const seatsOf = (G) => Array.from({ length: G.n }, (_, i) => i);
const others = (G, seat) => seatsOf(G).filter((s) => s !== seat);
const nextSeat = (G, seat) => (Number(seat) + 1) % G.n;
const handOf = (G, seat) => {
  const me = G.players ? G.players[String(seat)] : null;
  return me && Array.isArray(me.hand) ? me.hand : null;
};
/** True in the pause after a round ends and before the next is dealt. */
export const isBetweenRounds = (G) => !!G && !G.over && !!G.summary;
const freeTurn = (G, seat) => !G.over && !G.resolving && !G.pending && G.turnP !== null && G.turnP !== undefined && String(G.turnP) === String(seat);

/** What an Exit is worth right now (Hot Market doubles it in the last three rounds). */
export function exitValue(kind, G) {
  const base = EXIT_VALUES[kind] || 0;
  return G && G.hot ? base * 2 : base;
}

function groupHand(hand) {
  const bySet = Object.fromEntries(SET_IDS.map((s) => [s, []]));
  const wild = [];
  for (const id of hand || []) {
    const c = CARD[id];
    if (!c) continue;
    if (c.type === 'founder') bySet[c.set].push(id);
    else if (c.type === 'unicorn') wild.push(id);
  }
  return { bySet, wild };
}

/**
 * What exactly these cards can be laid down as. Unicorns are wild: they count
 * as any founder in any set. Three of a set is both a Seed Exit and an
 * Acqui-hire; five of a set is both a Dream Team and a Portfolio Review.
 * Returns [{ type: 'combo' | 'exit', kind, set }].
 */
export function describeSelection(ids) {
  const out = [];
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 6) return out;
  if (new Set(ids).size !== ids.length) return out;
  const cards = ids.map((id) => CARD[id]);
  if (cards.some((c) => !c)) return out;
  const n = cards.length;
  const founders = cards.filter((c) => c.type === 'founder');
  const wilds = cards.filter((c) => c.type === 'unicorn').length;
  const allSetCards = founders.length + wilds === n;
  const sets = [...new Set(founders.map((c) => c.set))];
  const set = sets.length === 1 ? sets[0] : null;
  if (allSetCards && sets.length <= 1) {
    if (n === 2) out.push({ type: 'combo', kind: 'poach', set });
    if (n === 3) { out.push({ type: 'exit', kind: 'seed', set }); out.push({ type: 'combo', kind: 'acquihire', set }); }
    if (n === 4) out.push({ type: 'exit', kind: 'seriesA', set });
    if (n === 5) out.push({ type: 'exit', kind: 'dream', set });
  }
  // One from each of the six sets: the real founders must all differ in set, wilds fill the gaps.
  if (n === 6 && allSetCards && sets.length === founders.length) out.push({ type: 'exit', kind: 'fullstack', set: null });
  if (n === 5 && new Set(cards.map((c) => c.key)).size === 5) out.push({ type: 'combo', kind: 'review', set: null });
  return out;
}

function setOptions(hand, sizes) {
  const { bySet, wild } = groupHand(hand);
  const out = [];
  for (const set of SET_IDS) {
    const nat = bySet[set];
    if (!nat.length) continue;
    for (const [kind, size] of sizes) {
      const useNat = Math.min(nat.length, size);
      const needWild = size - useNat;
      if (needWild > wild.length) continue;
      out.push({ kind, set, cards: [...nat.slice(0, useNat), ...wild.slice(0, needWild)], wilds: needWild });
    }
  }
  return { out, bySet, wild };
}

/** Exits this hand can bank, best first. One suggestion per set and size, real founders before Unicorns. */
export function exitOptions(hand) {
  const { out, bySet, wild } = setOptions(hand, [['dream', 5], ['seriesA', 4], ['seed', 3]]);
  const present = SET_IDS.filter((s) => bySet[s].length);
  if (present.length + wild.length >= 6) {
    const needWild = 6 - present.length;
    out.push({ kind: 'fullstack', set: null, cards: [...present.map((s) => bySet[s][0]), ...wild.slice(0, needWild)], wilds: needWild });
  }
  return out.sort((a, b) => (EXIT_VALUES[b.kind] - EXIT_VALUES[a.kind]) || (a.wilds - b.wilds));
}

/** Combos this hand can spend. Portfolio Review suggests the first five different names in hand order. */
export function comboOptions(hand) {
  const { out, wild } = setOptions(hand, [['poach', 2], ['acquihire', 3]]);
  if (wild.length >= 2) out.push({ kind: 'poach', set: null, cards: wild.slice(0, 2), wilds: 2 });
  const seen = new Set();
  const five = [];
  for (const id of hand || []) {
    const k = keyOf(id);
    if (!k || seen.has(k)) continue;
    seen.add(k); five.push(id);
    if (five.length === 5) break;
  }
  if (five.length === 5) out.push({ kind: 'review', set: null, cards: five, wilds: 0 });
  return out;
}

/** Players this seat may aim a card at: anyone else who holds at least one card (hand sizes are public). */
export function targetsFor(G, seat) {
  const counts = Array.isArray(G.counts) ? G.counts : [];
  return others(G, seat).filter((s) => (counts[s] || 0) > 0);
}

const ownsAll = (hand, ids) => Array.isArray(ids) && new Set(ids).size === ids.length && ids.every((id) => hand.includes(id));

/**
 * The one definition of legal. Reads only that seat's own hand and the public
 * fields, so it gives the same answer on the server's full state and on the
 * stripped view a browser or a bot holds.
 */
export function isLegal(G, seat, move, args = []) {
  if (!G || G.over) return false;
  const hand = handOf(G, seat);
  if (!hand) return false; // spectators and the house seat hold no hand
  const p = G.pending;
  const waiting = Array.isArray(G.waiting) ? G.waiting : [];
  switch (move) {
    // ready and react name the exact question they answer (round; window id and
    // Hard Pass count). Several people answer at once, so these two moves are
    // accepted against a state that has moved on (see ignoreStaleStateID below);
    // the token stops a late answer landing on the NEXT question.
    case 'ready': return isBetweenRounds(G) && args[0] === G.round;
    case 'react': return !!p && p.stage === 'react' && waiting.includes(seat) && typeof args[0] === 'boolean' && args[1] === p.id && args[2] === p.passes && (!args[0] || hand.some((id) => typeOf(id) === 'pass'));
    case 'give': return !!p && p.stage === 'give' && waiting.includes(seat) && hand.includes(args[0]);
    case 'place': return !!p && p.stage === 'place' && waiting.includes(seat) && Number.isInteger(args[0]) && args[0] >= 0 && args[0] <= G.deckCount;
    case 'pick': return !!p && p.stage === 'pick' && waiting.includes(seat) && (G.discard || []).includes(args[0]);
    default: break;
  }
  if (!freeTurn(G, seat)) return false;
  switch (move) {
    case 'draw': return true;
    case 'play': {
      const [id, target] = args;
      if (!hand.includes(id) || !PLAYABLE.includes(typeOf(id))) return false;
      if (typeOf(id) === 'mentor') return targetsFor(G, seat).includes(target);
      return target === undefined || target === null;
    }
    case 'combo': {
      const [kind, ids, target, named] = args;
      if (!ownsAll(hand, ids)) return false;
      if (!describeSelection(ids).some((o) => o.type === 'combo' && o.kind === kind)) return false;
      if (kind === 'review') return (target === undefined || target === null) && (named === undefined || named === null);
      if (!targetsFor(G, seat).includes(target)) return false;
      if (kind === 'acquihire') return NAMEABLE.includes(named);
      return named === undefined || named === null;
    }
    case 'exit': {
      const [kind, ids] = args;
      return ownsAll(hand, ids) && describeSelection(ids).some((o) => o.type === 'exit' && o.kind === kind);
    }
    default: return false;
  }
}

/**
 * Everything this seat may do right now, as { move, args } entries that each
 * pass isLegal(). Sets are offered as suggestions (one per set and size); a
 * player may also pick the exact cards, which selectionActions() checks.
 * An Acqui-hire entry carries `names`: any of them may replace args[3].
 */
export function legalActions(G, seat) {
  const out = [];
  if (!G || G.over) return out;
  const hand = handOf(G, seat);
  if (!hand) return out;
  if (isBetweenRounds(G)) return [{ move: 'ready', args: [G.round] }];
  const p = G.pending;
  if (p) {
    if (!(G.waiting || []).includes(seat)) return out;
    if (p.stage === 'react') {
      out.push({ move: 'react', args: [false, p.id, p.passes] });
      if (hand.some((id) => typeOf(id) === 'pass')) out.push({ move: 'react', args: [true, p.id, p.passes] });
    } else if (p.stage === 'give') {
      for (const id of hand) out.push({ move: 'give', args: [id] });
    } else if (p.stage === 'place') {
      for (let pos = 0; pos <= G.deckCount; pos++) out.push({ move: 'place', args: [pos] });
    } else if (p.stage === 'pick') {
      for (const id of G.discard || []) out.push({ move: 'pick', args: [id] });
    }
    return out;
  }
  if (!freeTurn(G, seat)) return out;
  out.push({ move: 'draw', args: [] });
  const targets = targetsFor(G, seat);
  for (const id of hand) {
    const type = typeOf(id);
    if (!PLAYABLE.includes(type)) continue;
    if (type === 'mentor') for (const t of targets) out.push({ move: 'play', args: [id, t], type });
    else out.push({ move: 'play', args: [id], type });
  }
  for (const o of exitOptions(hand)) out.push({ move: 'exit', args: [o.kind, o.cards], kind: o.kind, set: o.set, value: exitValue(o.kind, G), wilds: o.wilds });
  for (const o of comboOptions(hand)) {
    if (o.kind === 'review') out.push({ move: 'combo', args: ['review', o.cards], kind: 'review', set: null, wilds: 0 });
    else if (o.kind === 'poach') for (const t of targets) out.push({ move: 'combo', args: ['poach', o.cards, t], kind: 'poach', set: o.set, wilds: o.wilds });
    else for (const t of targets) out.push({ move: 'combo', args: ['acquihire', o.cards, t, NAMEABLE[0]], kind: 'acquihire', set: o.set, wilds: o.wilds, names: NAMEABLE });
  }
  return out;
}

/**
 * What the cards a player has tapped can do, for the board's action bar.
 * Returns [{ move: 'play' | 'combo' | 'exit', kind, value?, set?, needsTarget, needsName, targets }].
 */
export function selectionActions(G, seat, ids) {
  const out = [];
  const hand = handOf(G, seat);
  if (!G || !hand || !Array.isArray(ids) || !ids.length || !freeTurn(G, seat) || !ownsAll(hand, ids)) return out;
  const targets = targetsFor(G, seat);
  if (ids.length === 1) {
    const type = typeOf(ids[0]);
    if (PLAYABLE.includes(type) && (type !== 'mentor' || targets.length)) out.push({ move: 'play', kind: type, needsTarget: type === 'mentor', needsName: false, targets });
    return out;
  }
  for (const o of describeSelection(ids)) {
    if (o.type === 'exit') out.push({ move: 'exit', kind: o.kind, set: o.set, value: exitValue(o.kind, G), needsTarget: false, needsName: false, targets: [] });
    else if (o.kind === 'review') out.push({ move: 'combo', kind: 'review', set: null, needsTarget: false, needsName: false, targets: [] });
    else if (targets.length) out.push({ move: 'combo', kind: o.kind, set: o.set, needsTarget: true, needsName: o.kind === 'acquihire', targets });
  }
  return out;
}

// ---- state changes (server only: these read G.secret and every hand) --------
function sync(G) {
  for (const s of seatsOf(G)) G.counts[s] = G.players[String(s)].hand.length;
  G.deckCount = G.secret.deck.length;
}

function takeFromHand(G, seat, ids) {
  const me = G.players[String(seat)];
  me.hand = me.hand.filter((id) => !ids.includes(id));
}

/**
 * A private line for one seat: the only place a hidden card's name is written.
 * It carries the card's name (`k`), not its id: the card may move on to
 * someone else's hand later, and an id must never outlive the right to see it.
 */
function note(G, seat, data) {
  const me = G.players[String(seat)];
  me.noteN = (me.noteN || 0) + 1;
  me.note = { n: me.noteN, ...data };
}

function clearPending(G) {
  G.pending = null;
  G.waiting = [];
  G.resolving = false;
  G.tick += 1;
}

/** Open a Hard Pass window: every other seat is asked, so nobody learns who holds one. */
function openWindow(G, seat, pending) {
  G.pendN += 1;
  G.pending = { id: G.pendN, stage: 'react', by: seat, target: null, named: null, set: null, value: null, k: null, cards: [], shown: [], passes: 0, passers: [], ...pending };
  G.waiting = others(G, seat);
  G.resolving = true;
  G.tick += 1;
}

function setStage(G, stage, waiting) {
  G.pending.stage = stage;
  G.waiting = waiting;
  G.resolving = true;
  G.tick += 1;
}

/** Everyone forgets what they knew about the top of the deck (after a shuffle or a new deal). */
function forgetDeck(G) {
  for (const s of seatsOf(G)) { const me = G.players[String(s)]; me.peek = null; me.boomAt = null; me.stale = false; }
}

/**
 * Deal a round, exactly as the rulebook's Setup: BOOMs and Pivots out, one
 * Pivot each, leftover Pivots shuffled in, seven cards each, then BOOMs equal
 * to players minus one shuffled in. Top of the draw pile is the END of the array.
 *
 * Digital reading (Kids' edition, "a bankrupt player keeps their hand"): their
 * cards are set aside, everyone gets the normal deal, and the kept cards are
 * handed back on top of it. If setting them aside would leave fewer cards in
 * the draw pile than there are players, they are reshuffled and that player
 * gets a normal deal only.
 */
function dealRound(G, random, first, keep) {
  const n = G.n;
  G.round += 1;
  G.hot = !!G.hotMarket && G.round > G.rounds - 3;
  const usable = CARDS.filter((c) => !(G.kids && c.type === 'hostile'));
  const box = CARDS.filter((c) => G.kids && c.type === 'hostile').map((c) => c.id);
  let kept = keep && keep.cards.length ? keep.cards.slice() : [];
  const basePool = usable.filter((c) => c.type !== 'boom' && c.type !== 'pivot').map((c) => c.id);
  const allPivots = usable.filter((c) => c.type === 'pivot').map((c) => c.id);
  const leftAfterDeal = (held) => basePool.filter((id) => !held.includes(id)).length + allPivots.filter((id) => !held.includes(id)).length - n * (HAND_DEAL + 1);
  if (kept.length && (leftAfterDeal(kept) < n || allPivots.filter((id) => !kept.includes(id)).length < n)) kept = [];
  const pivots = random.Shuffle(allPivots.filter((id) => !kept.includes(id)));
  const hands = seatsOf(G).map(() => [pivots.pop()]);
  let rest = random.Shuffle(basePool.filter((id) => !kept.includes(id)).concat(pivots));
  for (let i = 0; i < HAND_DEAL; i++) for (const s of seatsOf(G)) hands[s].push(rest.pop());
  const booms = random.Shuffle(usable.filter((c) => c.type === 'boom').map((c) => c.id));
  rest = random.Shuffle(rest.concat(booms.slice(0, n - 1)));
  box.push(...booms.slice(n - 1));
  if (kept.length) hands[keep.seat].push(...kept);
  for (const s of seatsOf(G)) G.players[String(s)].hand = hands[s];
  forgetDeck(G);
  G.secret.deck = rest;
  G.secret.box = box;
  G.discard = [];
  G.exits = seatsOf(G).map(() => []);
  G.roundGain = seatsOf(G).map(() => 0);
  G.roundTurns = 0;
  G.starter = first;
  G.turnP = String(first);
  G.turnsLeft = 1;
  G.attacked = false;
  G.pending = null;
  G.waiting = [];
  G.summary = null;
  G.resolving = false;
  G.keepSeat = null;
  G.tick += 1;
  sync(G);
  pushLog(G, { t: 'deal', round: G.round, first, hot: G.hot, kept: kept.length ? keep.seat : null });
}

function finishGame(G, reason) {
  // Rulebook: highest valuation; ties go to fewer bankruptcies, then to the most Dream Team and Full-Stack Exits.
  const tiebreak = (a, b) => (G.bankruptcies[a] - G.bankruptcies[b]) || (G.bigExits[b] - G.bigExits[a]);
  finish(G, placementsFromScores(G.scores, tiebreak), { scores: G.scores.slice(), reason });
}

/** The round is over: one bankruptcy (or the turn cap), survival bonus for everyone else, then the pause. */
function endRound(G, bankrupt, boomId) {
  clearPending(G);
  const gains = G.roundGain.slice();
  if (bankrupt !== null) { G.bankruptcies[bankrupt] += 1; G.stats[bankrupt].bankruptcies += 1; }
  for (const s of seatsOf(G)) {
    if (s === bankrupt) continue;
    G.scores[s] += SURVIVAL_BONUS;
    gains[s] += SURVIVAL_BONUS;
  }
  G.summary = { round: G.round, bankrupt, boomCard: boomId ? keyOf(boomId) : null, gains, scores: G.scores.slice(), reason: bankrupt === null ? 'cap' : 'boom' };
  pushLog(G, { t: 'round', ...G.summary });
  if (G.round === Math.ceil(G.rounds / 2)) G.midRanks = placementsFromScores(G.scores);
  // Rulebook: the player to the left of whoever went bankrupt starts the next round.
  G.nextFirst = nextSeat(G, bankrupt !== null ? bankrupt : G.starter);
  G.keepSeat = G.kids && bankrupt !== null ? bankrupt : null;
  G.turnP = null;
  G.turnsLeft = 0;
  G.attacked = false;
  G.resolving = true; // between rounds: only ready() and the house may act
  G.tick += 1;
  sync(G);
  if (G.round >= G.rounds) finishGame(G, 'rounds');
}

function nextRound(G, random) {
  const keep = G.keepSeat !== null && G.keepSeat !== undefined ? { seat: G.keepSeat, cards: G.players[String(G.keepSeat)].hand.slice() } : null;
  dealRound(G, random, G.nextFirst, keep);
}

/** One of the turns the current player owes is finished. */
function endTurn(G) {
  G.roundTurns += 1;
  if (G.roundTurns >= ROUND_TURN_CAP) { endRound(G, null, null); return; }
  G.turnsLeft -= 1;
  if (G.turnsLeft <= 0) { G.turnP = String(nextSeat(G, G.turnP)); G.turnsLeft = 1; G.attacked = false; }
}

/** The window closed: an odd number of Hard Passes cancels, otherwise the action takes effect. */
function resolve(G, random) {
  const p = G.pending;
  const by = p.by;
  if (p.passes % 2 === 1) {
    // "The deal fell through": a cancelled Exit's cards go to the discard pile.
    if (p.cards.length) G.discard.push(...p.cards);
    if (p.kind === 'exit') G.stats[by].dealsLost += 1;
    pushLog(G, { t: 'cancel', p: by, kind: p.kind, k: p.what, passes: p.passes });
    clearPending(G);
    return;
  }
  if (p.kind === 'exit') {
    G.exits[by].push({ kind: p.what, cards: p.cards.slice(), value: p.value, set: p.set });
    G.scores[by] += p.value;
    G.roundGain[by] += p.value;
    const st = G.stats[by];
    st.exits += 1; st.exitValue += p.value;
    if (p.what === 'seed') st.seedValue += p.value; else st.bigValue += p.value;
    if (p.what === 'dream' || p.what === 'fullstack') { G.bigExits[by] += 1; st.bigExits += 1; }
    pushLog(G, { t: 'exit', p: by, k: p.what, set: p.set, value: p.value, with: p.shown });
    clearPending(G);
    return;
  }
  switch (p.what) {
    case 'hostile': {
      // Rulebook: "Next player takes 2 turns. Stacks (+2 each time it's passed on)."
      // Digital reading: a player who is themselves under a takeover passes on
      // the turns they still owe plus 2 (2, then 4, then 6 when passed straight on).
      const turns = (G.attacked ? G.turnsLeft : 0) + 2;
      const to = nextSeat(G, by);
      clearPending(G);
      pushLog(G, { t: 'attack', p: by, to, turns });
      G.roundTurns += 1;
      if (G.roundTurns >= ROUND_TURN_CAP) { endRound(G, null, null); return; }
      G.turnP = String(to); G.turnsLeft = turns; G.attacked = true;
      return;
    }
    case 'ooo':
      clearPending(G);
      pushLog(G, { t: 'skip', p: by });
      endTurn(G);
      return;
    case 'research': {
      const me = G.players[String(by)];
      me.peek = G.secret.deck.slice(-3).reverse(); // first = the next card drawn
      me.stale = false;
      pushLog(G, { t: 'peek', p: by, c: me.peek.length });
      clearPending(G);
      return;
    }
    case 'reorg':
      G.secret.deck = random.Shuffle(G.secret.deck);
      forgetDeck(G);
      pushLog(G, { t: 'shuffle', p: by });
      clearPending(G);
      return;
    case 'mentor':
      if (!G.players[String(p.target)].hand.length) { pushLog(G, { t: 'gave', p: p.target, to: by, ok: false }); clearPending(G); return; }
      pushLog(G, { t: 'ask', p: by, to: p.target });
      setStage(G, 'give', [p.target]);
      return;
    case 'poach': {
      const from = G.players[String(p.target)];
      if (!from.hand.length) { pushLog(G, { t: 'steal', p: by, from: p.target, ok: false }); clearPending(G); return; }
      const id = from.hand[random.Die(from.hand.length) - 1];
      takeFromHand(G, p.target, [id]);
      G.players[String(by)].hand.push(id);
      // Which card moved is known only to the two players involved.
      note(G, by, { t: 'got', k: keyOf(id), from: p.target, how: 'poach' });
      note(G, p.target, { t: 'lost', k: keyOf(id), to: by, how: 'poach' });
      pushLog(G, { t: 'steal', p: by, from: p.target, ok: true });
      clearPending(G);
      sync(G);
      return;
    }
    case 'acquihire': {
      // The card was named out loud, so whether it moved is public.
      const id = G.players[String(p.target)].hand.find((x) => keyOf(x) === p.named);
      if (id) { takeFromHand(G, p.target, [id]); G.players[String(by)].hand.push(id); note(G, by, { t: 'got', k: keyOf(id), from: p.target, how: 'acquihire' }); }
      pushLog(G, { t: 'hire', p: by, from: p.target, named: p.named, ok: !!id });
      clearPending(G);
      sync(G);
      return;
    }
    case 'review':
      if (!G.discard.length) { clearPending(G); return; }
      pushLog(G, { t: 'review', p: by });
      setStage(G, 'pick', [by]);
      return;
    default:
      clearPending(G);
  }
}

function doGive(G, id) {
  const p = G.pending;
  takeFromHand(G, p.target, [id]);
  G.players[String(p.by)].hand.push(id);
  note(G, p.by, { t: 'got', k: keyOf(id), from: p.target, how: 'mentor' });
  note(G, p.target, { t: 'lost', k: keyOf(id), to: p.by, how: 'mentor' });
  pushLog(G, { t: 'gave', p: p.target, to: p.by, ok: true });
  clearPending(G);
  sync(G);
}

function doPlace(G, pos) {
  const p = G.pending;
  const seat = p.by;
  const [boom] = p.cards;
  const deck = G.secret.deck;
  deck.splice(deck.length - pos, 0, boom); // pos = how many cards sit above it
  // Only the player who slid it back knows where it is. Everyone else's
  // memory of the top of the deck may now be wrong, wherever it went: flag
  // them all, so the flag itself says nothing about the position.
  for (const s of seatsOf(G)) {
    const me = G.players[String(s)];
    if (s === seat) me.boomAt = pos; else me.stale = true;
  }
  pushLog(G, { t: 'placed', p: seat });
  clearPending(G);
  sync(G);
  endTurn(G); // a Pivot ends the turn
}

function doPick(G, id) {
  const by = G.pending.by;
  G.discard.splice(G.discard.indexOf(id), 1);
  G.players[String(by)].hand.push(id);
  pushLog(G, { t: 'took', p: by, k: keyOf(id) }); // the discard pile is face up, so this is public
  clearPending(G);
  sync(G);
}

/** Count the move; true when the game was just ended by the mercy limit. */
function mercy(G) {
  if (countMove(G) <= MERCY_MOVES) return false;
  finishGame(G, 'mercy');
  return true;
}

// ---- setup and moves --------------------------------------------------------
function setup({ random, n }, setupData) {
  const st = normalizeSettings(setupData && setupData.settings);
  const zeros = () => Array.from({ length: n }, () => 0);
  const G = {
    n,
    turnP: '0', turnsLeft: 1, attacked: false,
    round: 0, rounds: st.rounds, hotMarket: st.hotMarket, hot: false, kids: st.kids,
    players: {}, secret: { deck: [], box: [] },
    counts: zeros(), deckCount: 0, discard: [], exits: Array.from({ length: n }, () => []),
    scores: zeros(), bankruptcies: zeros(), bigExits: zeros(), roundGain: zeros(),
    pending: null, waiting: [], summary: null, resolving: false,
    roundTurns: 0, starter: 0, nextFirst: 0, keepSeat: null, midRanks: null, pendN: 0, tick: 0,
    stats: Array.from({ length: n }, () => ({ draws: 0, hardPasses: 0, mentorAsks: 0, poaches: 0, hires: 0, reviews: 0, boomsSurvived: 0, bankruptcies: 0, exits: 0, bigExits: 0, exitValue: 0, seedValue: 0, bigValue: 0, dealsLost: 0 })),
  };
  for (let s = 0; s < n; s++) G.players[String(s)] = { hand: [], peek: null, stale: false, boomAt: null, note: null, noteN: 0, risky: 0 };
  dealRound(G, random, 0, null); // Round 1: seat 0 goes first
  return G;
}

const moves = {
  /** Play one action card (Hostile Takeover, Out of Office, Market Research, Reorg, Ask a Mentor + target). */
  play: ({ G, playerID }, id, target) => {
    if (refuse(G, playerID)) return INVALID_MOVE;
    const seat = Number(playerID);
    if (!isLegal(G, seat, 'play', [id, target])) return INVALID_MOVE;
    if (mercy(G)) return undefined;
    const type = typeOf(id);
    takeFromHand(G, seat, [id]);
    G.discard.push(id);
    if (type === 'mentor') G.stats[seat].mentorAsks += 1;
    const to = type === 'mentor' ? target : type === 'hostile' ? nextSeat(G, seat) : null;
    pushLog(G, { t: 'play', p: seat, k: keyOf(id), to });
    openWindow(G, seat, { kind: 'card', what: type, k: keyOf(id), target: to, shown: [keyOf(id)] });
    sync(G);
    return undefined;
  },

  /** Spend founders: Poach (2 of a set), Acqui-hire (3 of a set, naming a card), Portfolio Review (5 different names). */
  combo: ({ G, playerID }, kind, ids, target, named) => {
    if (refuse(G, playerID)) return INVALID_MOVE;
    const seat = Number(playerID);
    if (!isLegal(G, seat, 'combo', [kind, ids, target, named])) return INVALID_MOVE;
    if (mercy(G)) return undefined;
    takeFromHand(G, seat, ids);
    G.discard.push(...ids);
    const st = G.stats[seat];
    if (kind === 'poach') st.poaches += 1; else if (kind === 'acquihire') st.hires += 1; else st.reviews += 1;
    const shown = ids.map(keyOf);
    const to = kind === 'review' ? null : target;
    pushLog(G, { t: 'combo', p: seat, k: kind, to, named: kind === 'acquihire' ? named : null, with: shown });
    openWindow(G, seat, { kind: 'combo', what: kind, target: to, named: kind === 'acquihire' ? named : null, shown });
    sync(G);
    return undefined;
  },

  /** Lay a set down as an Exit. It scores when the Hard Pass window closes without cancelling it. */
  exit: ({ G, playerID }, kind, ids) => {
    if (refuse(G, playerID)) return INVALID_MOVE;
    const seat = Number(playerID);
    if (!isLegal(G, seat, 'exit', [kind, ids])) return INVALID_MOVE;
    if (mercy(G)) return undefined;
    const set = (describeSelection(ids).find((o) => o.type === 'exit' && o.kind === kind) || {}).set || null;
    takeFromHand(G, seat, ids);
    const value = exitValue(kind, G);
    const shown = ids.map(keyOf);
    pushLog(G, { t: 'offer', p: seat, k: kind, set, value, with: shown });
    openWindow(G, seat, { kind: 'exit', what: kind, set, value, cards: ids.slice(), shown });
    sync(G);
    return undefined;
  },

  /** Draw the top card: this is how a turn ends. */
  draw: ({ G, playerID, random }) => {
    if (refuse(G, playerID)) return INVALID_MOVE;
    const seat = Number(playerID);
    if (!isLegal(G, seat, 'draw', [])) return INVALID_MOVE;
    if (mercy(G)) return undefined;
    const me = G.players[String(seat)];
    if (!G.secret.deck.length && G.discard.length) {
      // Cannot normally happen (the BOOMs stay in the pile), but a pile that runs dry is refilled from the discards.
      G.secret.deck = random.Shuffle(G.discard);
      G.discard = [];
      forgetDeck(G);
      pushLog(G, { t: 'refill' });
    }
    if (!G.secret.deck.length) { endRound(G, null, null); return undefined; }
    const id = G.secret.deck.pop();
    const st = G.stats[seat];
    const pivot = me.hand.find((x) => typeOf(x) === 'pivot');
    st.draws += 1;
    // Private on purpose: a public count of "drew with no Pivot" would tell the
    // table who is holding one. G.stats is public; this lives with the hand.
    if (!pivot) me.risky = (me.risky || 0) + 1;
    // The top card is gone: everyone's memory of the pile moves up by one.
    for (const s of seatsOf(G)) {
      const o = G.players[String(s)];
      if (o.peek) { o.peek = o.peek.filter((x) => x !== id); if (!o.peek.length) o.peek = null; }
      if (o.boomAt !== null && o.boomAt !== undefined) o.boomAt = o.boomAt > 0 ? o.boomAt - 1 : null;
    }
    if (typeOf(id) !== 'boom') {
      me.hand.push(id);
      note(G, seat, { t: 'drew', k: keyOf(id) });
      pushLog(G, { t: 'draw', p: seat });
      sync(G);
      endTurn(G);
      return undefined;
    }
    pushLog(G, { t: 'boom', p: seat, k: keyOf(id) });
    if (!pivot) {
      // Bankrupt. The BOOM stays face up on the discard pile until the next deal.
      G.discard.push(id);
      pushLog(G, { t: 'bust', p: seat, k: keyOf(id) });
      sync(G);
      endRound(G, seat, id);
      return undefined;
    }
    // Digital reading: the Pivot is spent automatically (there is never a
    // reason to hold it back), then the drawer secretly chooses where the
    // BOOM goes. The position is a move argument, redacted from the log.
    takeFromHand(G, seat, [pivot]);
    G.discard.push(pivot);
    st.boomsSurvived += 1;
    pushLog(G, { t: 'pivot', p: seat, k: keyOf(id) });
    G.pendN += 1;
    G.pending = { id: G.pendN, stage: 'place', kind: 'boom', what: 'boom', k: keyOf(id), by: seat, target: null, named: null, set: null, value: null, cards: [id], shown: [keyOf(id)], passes: 0, passers: [] };
    G.waiting = [seat];
    G.resolving = true;
    G.tick += 1;
    sync(G);
    return undefined;
  },

  /** Answer a Hard Pass window: true plays a Hard Pass, false lets the action go. `id` and `passes` name the window. */
  react: ({ G, playerID, random }, yes, id, passes) => {
    if (refuse(G, playerID, { anySeat: true, whileResolving: true })) return INVALID_MOVE;
    const seat = Number(playerID);
    if (!isLegal(G, seat, 'react', [yes, id, passes])) return INVALID_MOVE;
    if (mercy(G)) return undefined;
    const p = G.pending;
    if (yes) {
      const card = G.players[String(seat)].hand.find((x) => typeOf(x) === 'pass');
      takeFromHand(G, seat, [card]);
      G.discard.push(card);
      G.stats[seat].hardPasses += 1;
      p.passes += 1;
      p.passers.push(seat);
      pushLog(G, { t: 'pass', p: seat, by: p.by, kind: p.kind, k: p.what, passes: p.passes });
      // A Hard Pass can itself be Hard Passed: a fresh window for everyone but the seat that just played one.
      G.waiting = others(G, seat);
      G.tick += 1;
      sync(G);
      return undefined;
    }
    G.waiting = G.waiting.filter((s) => s !== seat);
    if (!G.waiting.length) resolve(G, random);
    sync(G);
    return undefined;
  },

  /** Ask a Mentor: the player who was asked chooses the card to hand over. */
  give: ({ G, playerID }, id) => {
    if (refuse(G, playerID, { anySeat: true, whileResolving: true })) return INVALID_MOVE;
    if (!isLegal(G, Number(playerID), 'give', [id])) return INVALID_MOVE;
    if (mercy(G)) return undefined;
    doGive(G, id);
    return undefined;
  },

  /** After a Pivot: slide the BOOM back with `pos` cards above it (0 = top, deckCount = bottom). */
  place: ({ G, playerID }, pos) => {
    if (refuse(G, playerID, { anySeat: true, whileResolving: true })) return INVALID_MOVE;
    if (!isLegal(G, Number(playerID), 'place', [pos])) return INVALID_MOVE;
    if (mercy(G)) return undefined;
    doPlace(G, pos);
    return undefined;
  },

  /** Portfolio Review: take any card from the discard pile. */
  pick: ({ G, playerID }, id) => {
    if (refuse(G, playerID, { anySeat: true, whileResolving: true })) return INVALID_MOVE;
    if (!isLegal(G, Number(playerID), 'pick', [id])) return INVALID_MOVE;
    if (mercy(G)) return undefined;
    doPick(G, id);
    return undefined;
  },

  /** Skip the pause between rounds: the first seated player to tap Continue deals the next round. */
  ready: ({ G, playerID, random }, round) => {
    if (refuse(G, playerID, { anySeat: true, whileResolving: true })) return INVALID_MOVE;
    if (!isLegal(G, Number(playerID), 'ready', [round])) return INVALID_MOVE;
    nextRound(G, random);
    return undefined;
  },

  /**
   * The server's own seat: answers for people who ran out of time (they let
   * the action go; a choice they owed is made at random) and deals the next
   * round after the pause. `tick` must match, so a late timer cannot answer a
   * question that has already moved on.
   */
  houseTick: ({ G, playerID, random }, tick) => {
    if (refuse(G, playerID, { anySeat: true, whileResolving: true })) return INVALID_MOVE;
    if (!isHouse(G, playerID) || tick !== G.tick) return INVALID_MOVE;
    if (isBetweenRounds(G)) { nextRound(G, random); return undefined; }
    const p = G.pending;
    if (!p || !G.waiting.length) return INVALID_MOVE;
    if (p.stage === 'react') {
      G.waiting = [];
      resolve(G, random);
      sync(G);
    } else if (p.stage === 'give') {
      const hand = G.players[String(p.target)].hand;
      doGive(G, hand[random.Die(hand.length) - 1]);
    } else if (p.stage === 'place') {
      doPlace(G, random.Die(G.secret.deck.length + 1) - 1);
    } else if (p.stage === 'pick') {
      doPick(G, G.discard[random.Die(G.discard.length) - 1]);
    } else return INVALID_MOVE;
    return undefined;
  },
};

export const ventureBoom = defineGame({ name: 'ventureboom', minPlayers: 2, maxPlayers: 6, house: true, secret: true, setup, moves });

// boardgame.io drops a browser's move when the state has advanced since that
// browser last heard from the server. In a Hard Pass window every seat answers
// at the same moment, so all but the first answer would be dropped and the
// table would sit until the house timer. These two moves carry their own token
// (see isLegal), which makes it safe to accept them against a newer state.
for (const name of ['react', 'ready']) ventureBoom.moves[name].ignoreStaleStateID = true;

/** What the server's own seat should do, and how long to wait first. */
export function housekeeping(G) {
  if (!G || G.over) return null;
  if (isBetweenRounds(G)) return { move: 'houseTick', args: [G.tick], afterMs: BETWEEN_MS };
  if (G.pending && Array.isArray(G.waiting) && G.waiting.length) {
    return { move: 'houseTick', args: [G.tick], afterMs: G.pending.stage === 'react' ? REACT_MS : CHOICE_MS };
  }
  return null;
}

// ---- pace ---------------------------------------------------------------------
// How long the thing that just happened should stay on screen before a bot
// does the next thing, at the table's Steady pace (the bot runner scales it:
// shared/pace.js). People are never made to wait; this only holds robots back
// so that a person can read what was done. The board's announcer shows each
// entry for the same time (info.js holdOf), so a run of robot turns arrives at
// the pace it is read: the table never gets ahead of the words on it.
export const HOLD_MS = {
  announce: 2200, // a card, combo or Exit has just been put down: let the table read it, and what it does, before the robots answer
  draw: 1200, deal: 1500,
  boom: 1900, pivot: 1500, placed: 1400, bust: 2600,
  exit: 1900, cancel: 1900, pass: 1700,
  attack: 1900, skip: 1500, peek: 1700, shuffle: 1600,
  gave: 1700, steal: 1900, hire: 2000, took: 1900, refill: 1200,
};
export function pauseAfter(G) {
  if (!G || G.over || isBetweenRounds(G)) return 0;
  const p = G.pending;
  if (p) {
    // Only the first answer waits: once someone has answered, the rest follow at once.
    const untouched = p.stage === 'react' && Array.isArray(G.waiting) && G.waiting.length === Math.max(0, G.n - 1);
    return untouched ? HOLD_MS.announce : 0;
  }
  const log = Array.isArray(G.log) ? G.log : [];
  const last = log.length ? log[log.length - 1] : null;
  return last && HOLD_MS[last.t] ? HOLD_MS[last.t] : 0;
}

// ---- what the arena learns --------------------------------------------------
const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));

/** How this seat played, for the debrief and the play-style profile (server/arena/play.js). */
export function telemetry(G, seat) {
  const st = (Array.isArray(G.stats) ? G.stats[seat] : null) || {};
  const num = (v) => (typeof v === 'number' ? v : 0);
  const draws = num(st.draws);
  // Counted beside the hand, not in the public stats (see draw): present on the server's full state only.
  const mine = G.players && G.players[String(seat)] ? G.players[String(seat)] : {};
  const risky = num(mine.risky);
  const deals = num(st.hardPasses) + num(st.mentorAsks) + num(st.poaches) + num(st.hires);
  const rounds = Math.max(1, num(G.round));
  const out = {
    metrics: {
      score: Array.isArray(G.scores) ? num(G.scores[seat]) : 0,
      exits: num(st.exits), bigExits: num(st.bigExits), exitValue: num(st.exitValue), dealsLost: num(st.dealsLost),
      bankruptcies: Array.isArray(G.bankruptcies) ? num(G.bankruptcies[seat]) : 0,
      hardPasses: num(st.hardPasses), mentorAsks: num(st.mentorAsks), poaches: num(st.poaches), acquihires: num(st.hires),
      boomsSurvived: num(st.boomsSurvived), draws, riskyDraws: risky, rounds,
    },
    skillTags: ['risk', 'portfolio thinking', 'deal making'],
    signals: {
      // How often they kept drawing with no Pivot to catch a BOOM.
      risk: draws ? clamp((100 * risky) / draws) : 50,
      // Hard Passes, mentor asks and founder raids per round.
      negotiation: clamp(20 + 80 * Math.min(1, deals / (rounds * 1.5))),
      // Share of banked value that came from Exits bigger than a Seed.
      horizon: num(st.exitValue) ? clamp((100 * num(st.bigValue)) / num(st.exitValue)) : 50,
    },
  };
  if (Array.isArray(G.midRanks) && typeof G.midRanks[seat] === 'number') out.midRank = G.midRanks[seat];
  return out;
}

/** One to four plain sentences for the debrief. */
export function observations(metrics, placement, n) {
  const m = metrics || {};
  const out = [];
  if (m.exits > 0) out.push(`Banked ${m.exits} Exit${m.exits === 1 ? '' : 's'} worth $${m.exitValue}M${m.bigExits ? `, ${m.bigExits} of them a Dream Team or Full-Stack Company` : ''}.`);
  else out.push('Banked no Exits: every point came from outlasting someone else.');
  if (m.bankruptcies > 0) out.push(`Went bankrupt ${m.bankruptcies === 1 ? 'once' : m.bankruptcies === 2 ? 'twice' : `${m.bankruptcies} times`}${m.boomsSurvived ? `, and pivoted out of ${m.boomsSurvived} BOOM${m.boomsSurvived === 1 ? '' : 's'}` : ''}.`);
  else if (m.rounds > 1) out.push(`Never went bankrupt in ${m.rounds} quarters${m.boomsSurvived ? `, pivoting out of ${m.boomsSurvived} BOOM${m.boomsSurvived === 1 ? '' : 's'}` : ''}.`);
  if (m.draws >= 6 && m.riskyDraws / m.draws >= 0.5) out.push(`Drew ${m.riskyDraws} of ${m.draws} cards with no Pivot in hand: a taste for risk.`);
  else if (m.dealsLost > 0) out.push(`Lost ${m.dealsLost} Exit${m.dealsLost === 1 ? '' : 's'} to a Hard Pass. Timing a deal matters as much as building it.`);
  else if (m.hardPasses > 0) out.push(`Played ${m.hardPasses} Hard Pass${m.hardPasses === 1 ? '' : 'es'} to stop a rival.`);
  if (placement === 1 && n > 1) out.push('Finished with the highest valuation at the table.');
  return out.slice(0, 4);
}
