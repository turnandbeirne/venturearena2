// VentureBoom bot. It is handed exactly what a browser in its seat receives
// (its own hand, its own Market Research memory, the public table) and picks
// from the same legalActions() / isLegal() the move validators use, so it can
// never see a hidden card and never send a move the rules would refuse.
//
// level 1 plays loosely (banks anything, raids on a whim, rarely looks ahead)
// level 2 banks the best Exit, scouts a thin deck and dodges a BOOM it has seen
// level 3 also protects its Pivot, tracks who has already pivoted this round
//         and is quicker to Hard Pass a rival's deal
import { legalActions, isLegal, exitOptions, comboOptions, targetsFor, CARD } from './rules.js';

const rnd = (n) => Math.floor(Math.random() * n);
const chance = (p) => Math.random() < p;
const typeOf = (id) => (CARD[id] ? CARD[id].type : null);
const keyOf = (id) => (CARD[id] ? CARD[id].key : null);

const ACTION_WORTH = { pivot: 100, unicorn: 45, pass: 40, hostile: 30, ooo: 28, research: 15, reorg: 14, mentor: 12 };

/** How much the bot wants to keep a card, given the rest of its hand. */
function worth(id, hand) {
  const c = CARD[id];
  if (!c) return 0;
  if (c.type !== 'founder') return ACTION_WORTH[c.type] || 10;
  const same = hand.filter((x) => CARD[x] && CARD[x].type === 'founder' && CARD[x].set === c.set).length + (hand.includes(id) ? 0 : 1);
  const sets = new Set(hand.filter((x) => typeOf(x) === 'founder').map((x) => CARD[x].set)).size;
  return [0, 5, 13, 26, 34, 40][Math.min(same, 5)] + (sets >= 4 && same === 1 ? 6 : 0);
}

/** Seats that have already spent a Pivot this round (public: it is in the log). */
function pivotedThisRound(G) {
  const out = new Set();
  const log = Array.isArray(G.log) ? G.log : [];
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].t === 'deal') break;
    if (log[i].t === 'pivot') out.add(log[i].p);
  }
  return out;
}

/** Chance the next card is a BOOM, from what this seat knows. */
function danger(G, me, level) {
  if (level >= 2 && !me.stale) {
    if (me.boomAt === 0) return 1;
    if (me.peek && me.peek.length) return typeOf(me.peek[0]) === 'boom' ? 1 : 0;
  }
  // Every BOOM dealt into the round stays in the draw pile until the round ends.
  return Math.min(1, (G.n - 1) / Math.max(1, G.deckCount));
}

function react(G, seat, level, hand) {
  const p = G.pending;
  if (!hand.some((id) => typeOf(id) === 'pass')) return { move: 'react', args: [false, p.id, p.passes] };
  const stands = p.passes % 2 === 0; // as things are, the action will happen
  const hasPivot = hand.some((id) => typeOf(id) === 'pivot');
  let want = false; // do I want to flip the outcome?
  if (p.by === seat) {
    // My own play was Hard Passed: fight for a real deal, let small things go.
    want = !stands && level >= 2 && p.kind === 'exit' && p.value >= 6;
  } else if (stands) {
    if (p.kind === 'exit') want = level >= 3 ? p.value >= 6 : level === 2 ? p.value >= 10 : p.value >= 10 && chance(0.5);
    else if (p.what === 'hostile' && p.target === seat) want = level >= 2 && (!hasPivot || (G.attacked ? G.turnsLeft : 0) + 2 >= 4);
    else if (p.what === 'acquihire' && p.target === seat) want = level >= 2 && hand.some((id) => keyOf(id) === p.named && (ACTION_WORTH[typeOf(id)] || 0) >= 40);
    else if ((p.what === 'poach' || p.what === 'mentor') && p.target === seat) want = level >= 3 && hand.length <= 3 && hasPivot;
  }
  return { move: 'react', args: [want, p.id, p.passes] };
}

function give(hand) {
  const sorted = hand.slice().sort((a, b) => worth(a, hand) - worth(b, hand));
  return { move: 'give', args: [sorted[0]] };
}

function place(G, seat, level) {
  const deck = G.deckCount;
  if (level <= 1 || deck === 0) return { move: 'place', args: [rnd(deck + 1)] };
  // Still owe another turn after this one: keep the BOOM away from my own next draw.
  if (G.turnsLeft > 1) return { move: 'place', args: [Math.min(deck, 2 + rnd(Math.max(1, deck - 1)))] };
  if (level >= 3) {
    // On top if the next player has already burned a Pivot this round; otherwise just under the top.
    const next = (seat + 1) % G.n;
    return { move: 'place', args: [pivotedThisRound(G).has(next) ? 0 : Math.min(deck, rnd(2))] };
  }
  return { move: 'place', args: [Math.min(deck, rnd(3))] };
}

function pick(G, hand) {
  const pile = G.discard || [];
  const best = pile.slice().sort((a, b) => worth(b, hand) - worth(a, hand))[0];
  return { move: 'pick', args: [best] };
}

function turn(G, seat, level, hand, me) {
  const targets = targetsFor(G, seat);
  const hasPivot = hand.some((id) => typeOf(id) === 'pivot');
  const have = (type) => hand.find((id) => typeOf(id) === type);
  const risk = danger(G, me, level);
  const knows = level >= 2 && !me.stale && (me.boomAt === 0 || (me.peek && me.peek.length > 0));
  const fattest = targets.slice().sort((a, b) => G.counts[b] - G.counts[a])[0];

  // 1. Bank an Exit: hands are lost when the round ends, so value on the table beats value in hand.
  const exits = exitOptions(hand);
  if (exits.length) {
    const combos3 = comboOptions(hand).filter((o) => o.kind === 'acquihire');
    // Level 1 sometimes raids for a Pivot with a set it could have banked.
    if (level <= 1 && !hasPivot && combos3.length && fattest !== undefined && chance(0.2)) {
      return { move: 'combo', args: ['acquihire', combos3[0].cards, fattest, 'pivot'] };
    }
    return { move: 'exit', args: [exits[0].kind, exits[0].cards] };
  }

  // 2. A BOOM I know is on top: get out of the way if I can.
  const dodge = have('hostile') || have('ooo');
  if (knows && risk === 1) {
    if (dodge && (!hasPivot || level >= 3 || chance(0.6))) return { move: 'play', args: [dodge] };
    if (!hasPivot && have('reorg')) return { move: 'play', args: [have('reorg')] };
  }

  // 3. Scout a thin deck before drawing blind.
  if (have('research') && !knows) {
    const threshold = level >= 3 ? 0.15 : level === 2 ? 0.25 : 2;
    if (risk >= threshold || (level <= 1 && chance(0.3))) return { move: 'play', args: [have('research')] };
  }

  // 4. No Pivot and the odds are getting ugly: skip the draw, or hand a takeover on.
  if (!knows && dodge) {
    if (level >= 2 && G.attacked && G.turnsLeft >= 2 && have('hostile')) return { move: 'play', args: [have('hostile')] };
    if (level >= 2 && !hasPivot && risk >= 0.34) return { move: 'play', args: [dodge] };
    if (level <= 1 && chance(0.2)) return { move: 'play', args: [dodge] };
  }

  // 5. Ask a Mentor: free card from whoever holds the most.
  if (have('mentor') && fattest !== undefined && (!hasPivot || chance(level <= 1 ? 0.4 : 0.5))) {
    return { move: 'play', args: [have('mentor'), fattest] };
  }

  // 6. Portfolio Review to fish a Pivot out of the discard pile.
  const pivotInPile = (G.discard || []).some((id) => typeOf(id) === 'pivot');
  if (!hasPivot && pivotInPile && ((level >= 2 && risk >= 0.25) || (level <= 1 && chance(0.1)))) {
    const seen = new Set();
    const five = [];
    for (const id of hand.slice().sort((a, b) => worth(a, hand) - worth(b, hand))) {
      if (seen.has(keyOf(id)) || worth(id, hand) > 30) continue;
      seen.add(keyOf(id)); five.push(id);
      if (five.length === 5) break;
    }
    if (five.length === 5) return { move: 'combo', args: ['review', five] };
  }

  // 7. Poach with a pair that is unlikely to grow into an Exit before the round ends.
  if (fattest !== undefined) {
    const pairs = comboOptions(hand).filter((o) => o.kind === 'poach' && (level <= 1 || o.wilds === 0));
    const loose = level <= 1 ? chance(0.25) : risk >= 0.3 || (!hasPivot && risk >= 0.2);
    if (pairs.length && loose) return { move: 'combo', args: ['poach', pairs[0].cards, fattest] };
  }

  return { move: 'draw', args: [] };
}

export function bot({ G, seat, level = 2 }) {
  const acts = legalActions(G, seat);
  if (!acts.length) return null;
  const me = G.players[String(seat)];
  const hand = me.hand;
  let choice = null;
  const first = acts[0].move;
  if (first === 'ready') choice = acts[0];
  else if (first === 'react') choice = react(G, seat, level, hand);
  else if (first === 'give') choice = give(hand);
  else if (first === 'place') choice = place(G, seat, level);
  else if (first === 'pick') choice = pick(G, hand);
  else choice = turn(G, seat, level, hand, me);
  // Belt and braces: a heuristic that drifts out of step with the rules falls
  // back to something legal instead of freezing a table.
  if (choice && isLegal(G, seat, choice.move, choice.args)) return { move: choice.move, args: choice.args };
  const safe = acts.find((a) => a.move === 'draw') || acts[0];
  return { move: safe.move, args: safe.args };
}
