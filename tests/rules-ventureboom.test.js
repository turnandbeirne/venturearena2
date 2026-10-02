// VentureBoom rules. Three kinds of test:
//  * the pure helpers (what a set of cards is, what it is worth)
//  * single moves on a table arranged by hand, to pin each rule down
//  * whole bot-vs-bot games, checking the invariants after EVERY step:
//    no card is ever created or lost, the public mirrors match the truth,
//    and no browser's view ever contains a card it is not allowed to know.
//
// rules.js has no test-only back door. A deterministic table is built by
// wrapping the game's own setup (see rigged()): the moves are the real ones.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { createMatch, playout, actingSeats } from '../src/games/sim.js';
import {
  ventureBoom, legalActions, isLegal, selectionActions, describeSelection, exitOptions, comboOptions, exitValue,
  housekeeping, telemetry, observations, normalizeSettings, isBetweenRounds,
  EXIT_VALUES, ROUND_TURN_CAP, REACT_MS, BETWEEN_MS,
} from '../src/games/ventureboom/rules.js';
import { bot } from '../src/games/ventureboom/bot.js';
import { CARDS, CARD, SETS, SET_IDS, NAMEABLE, slug } from '../src/games/ventureboom/cards.js';
import meta from '../src/games/ventureboom/meta.js';

const of = (type) => CARDS.filter((c) => c.type === type).map((c) => c.id);
const founders = (set) => CARDS.filter((c) => c.set === set).map((c) => c.id);
const byName = (name) => CARDS.find((c) => c.name === name).id;
const BOOMS = of('boom');
const PIVOTS = of('pivot');
const PASSES = of('pass');
const HOSTILE = of('hostile');
const UNICORNS = of('unicorn');
const INV = founders('inventors');
const INN = founders('innovators');
const OPS = founders('operators');
const ID_RE = /"c\d\d"/g;

const setupData = (settings = {}) => ({ arena: true, seats: [], settings: normalizeSettings({ size: 4, fillBots: true, botLevel: 2, ...settings }), seed: 1 });

/**
 * Lay the table out by hand: `hands[seat]` are exact hands, `top` is the draw
 * pile from the top down. Everything else goes underneath, with the round's
 * BOOMs (players minus one in total) at the very bottom unless named in `top`.
 */
function arrange(G, hands, top = []) {
  const n = G.n;
  const used = new Set([...hands.flat(), ...top]);
  const boomsInDeck = top.filter((id) => CARD[id].type === 'boom');
  for (const id of BOOMS) if (boomsInDeck.length < n - 1 && !boomsInDeck.includes(id)) boomsInDeck.push(id);
  const box = BOOMS.filter((id) => !boomsInDeck.includes(id));
  if (G.kids) box.push(...HOSTILE);
  const rest = CARDS.filter((c) => c.type !== 'boom' && !used.has(c.id) && !box.includes(c.id)).map((c) => c.id);
  G.secret.deck = [...boomsInDeck.filter((id) => !top.includes(id)), ...rest, ...top.slice().reverse()];
  G.secret.box = box;
  for (let s = 0; s < n; s++) { G.players[String(s)].hand = (hands[s] || []).slice(); G.counts[s] = G.players[String(s)].hand.length; }
  G.deckCount = G.secret.deck.length;
}

/** The real game with a hand-arranged first deal. */
function rigged(n, settings, rig) {
  const game = { ...ventureBoom, setup: (ctx, data) => { const G = ventureBoom.setup(ctx, data); rig(G); return G; } };
  return createMatch(game, n, setupData(settings));
}

/** Everybody still being asked lets the action go. */
function letGo(m) {
  let guard = 0;
  while (m.G.pending && m.G.pending.stage === 'react' && m.G.waiting.length && guard++ < 20) {
    const seat = m.G.waiting[0];
    expect(m.move(seat, 'react', false, m.G.pending.id, m.G.pending.passes)).toBe(true);
  }
}
const pass = (m, seat) => m.move(seat, 'react', true, m.G.pending.id, m.G.pending.passes);
const house = (m) => { const chore = housekeeping(m.G); return m.move(m.house(), chore.move, ...chore.args); };
const handOf = (m, seat) => m.G.players[String(seat)].hand;
const safeTop = (count, avoid = []) => CARDS.filter((c) => ['research', 'reorg', 'ooo'].includes(c.type) && !avoid.includes(c.id)).slice(0, count).map((c) => c.id);

/** Every card is somewhere, exactly once. */
function allCards(G) {
  const out = [...G.secret.deck, ...G.secret.box, ...G.discard];
  for (let s = 0; s < G.n; s++) { out.push(...G.players[String(s)].hand); for (const e of G.exits[s]) out.push(...e.cards); }
  if (G.pending) out.push(...G.pending.cards);
  return out;
}

/** Ids a seat's browser must never receive: other hands and the draw pile, less what Market Research showed it. */
function forbiddenFor(G, seat) {
  const out = new Set(G.secret.deck);
  for (let s = 0; s < G.n; s++) if (s !== seat) for (const id of G.players[String(s)].hand) out.add(id);
  if (seat !== null) for (const id of G.players[String(seat)].peek || []) out.delete(id);
  return out;
}
function leaks(m, seat) {
  const view = m.view(seat);
  const found = JSON.stringify(view).match(ID_RE) || [];
  const forbidden = forbiddenFor(m.G, seat);
  return [...new Set(found.map((x) => x.slice(1, -1)).filter((id) => forbidden.has(id)))];
}

function checkInvariants(m, prev, { views = true } = {}) {
  const G = m.G;
  const n = G.n;
  const cards = allCards(G);
  expect(cards.length, 'card count').toBe(70);
  expect(new Set(cards).size, 'no duplicate cards').toBe(70);
  for (let s = 0; s < n; s++) expect(G.counts[s], `counts[${s}]`).toBe(G.players[String(s)].hand.length);
  expect(G.deckCount).toBe(G.secret.deck.length);
  for (let s = 0; s < n; s++) expect(G.scores[s], 'scores never decrease').toBeGreaterThanOrEqual(prev.scores[s]);
  // BOOMs: players minus one are in play, the rest in the box; none is ever in a hand.
  const inPlay = [...G.secret.deck, ...G.discard, ...(G.pending ? G.pending.cards : [])].filter((id) => CARD[id].type === 'boom').length;
  expect(inPlay, 'BOOMs in play').toBe(n - 1);
  for (let s = 0; s < n; s++) expect(G.players[String(s)].hand.some((id) => CARD[id].type === 'boom')).toBe(false);
  // Somebody can always act, and exactly the right people.
  if (G.over) { expect(actingSeats(G)).toEqual([]); } else if (isBetweenRounds(G)) {
    expect(G.turnP).toBe(null); expect(G.waiting).toEqual([]); expect(G.resolving).toBe(true); expect(G.pending).toBe(null);
    expect(housekeeping(G)).toMatchObject({ move: 'houseTick' });
  } else if (G.pending) {
    expect(G.waiting.length, 'a pending action waits on someone').toBeGreaterThan(0);
    expect(G.resolving).toBe(true);
    for (const s of G.waiting) { expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(n); }
  } else {
    expect(G.waiting).toEqual([]); expect(G.resolving).toBe(false);
    expect(Number(G.turnP)).toBeGreaterThanOrEqual(0); expect(Number(G.turnP)).toBeLessThan(n);
    expect(G.turnsLeft).toBeGreaterThanOrEqual(1);
  }
  // The log names cards, never card ids.
  expect(JSON.stringify(G.log).match(ID_RE), 'no card id in the log').toBe(null);
  expect(G.log.length).toBeLessThanOrEqual(80);
  if (views) {
    for (let s = 0; s < n; s++) {
      const v = m.view(s);
      expect(Object.keys(v.players)).toEqual([String(s)]);
      expect(v.secret).toBeUndefined();
      expect(leaks(m, s), `seat ${s} was sent hidden cards`).toEqual([]);
    }
    const w = m.view(null);
    expect(w.players).toEqual({});
    expect(leaks(m, null), 'spectator was sent hidden cards').toEqual([]);
  }
  // What a seat is offered is exactly what the validator accepts.
  for (const s of actingSeats(G)) {
    const view = m.view(s);
    const acts = legalActions(view, s);
    expect(acts.length, `seat ${s} owes an action and has one`).toBeGreaterThan(0);
    for (const a of acts) expect(isLegal(view, s, a.move, a.args), `${a.move} ${JSON.stringify(a.args)}`).toBe(true);
  }
  prev.scores = G.scores.slice();
}

function fullGame(numSeats, settings, level = 2, opts = {}) {
  const prev = { scores: Array(numSeats).fill(0) };
  const seen = {};
  const m = playout({
    game: ventureBoom, bot: (a) => bot({ ...a, level }), housekeeping, numSeats, setupData: setupData({ size: numSeats, ...settings }),
    onStep: (mm, act) => { seen[act.move] = (seen[act.move] || 0) + 1; if (act.move === 'combo' || act.move === 'exit') seen[act.args[0]] = (seen[act.args[0]] || 0) + 1; checkInvariants(mm, prev, opts); },
  });
  return { m, seen };
}

function expectFinished(m, n, rounds) {
  const over = m.G.over;
  expect(over, 'game ended').toBeTruthy();
  expect(over.reason).toBe('rounds');
  expect(m.G.round).toBe(rounds);
  expect(over.placements).toHaveLength(n);
  expect(Math.min(...over.placements)).toBe(1);
  for (const p of over.placements) { expect(p).toBeGreaterThanOrEqual(1); expect(p).toBeLessThanOrEqual(n); }
  expect(over.scores).toEqual(m.G.scores);
  // A better placement never has a lower score.
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (over.placements[a] < over.placements[b]) expect(m.G.scores[a]).toBeGreaterThanOrEqual(m.G.scores[b]);
  // One bankruptcy (at most) per round.
  expect(m.G.bankruptcies.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(rounds);
  for (let s = 0; s < n; s++) {
    const t = telemetry(m.G, s);
    expect(t.metrics.score).toBe(m.G.scores[s]);
    for (const v of Object.values(t.signals)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    expect(t.midRank).toBeGreaterThanOrEqual(1);
    const obs = observations(t.metrics, over.placements[s], n);
    expect(obs.length).toBeGreaterThanOrEqual(1); expect(obs.length).toBeLessThanOrEqual(4);
  }
}

// ---------------------------------------------------------------------------
describe('ventureboom: the deck', () => {
  it('is the 70 cards of the rulebook', () => {
    expect(CARDS).toHaveLength(70);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(70);
    const count = (type) => of(type).length;
    expect({ boom: count('boom'), pivot: count('pivot'), pass: count('pass'), hostile: count('hostile'), ooo: count('ooo'), research: count('research'), reorg: count('reorg'), mentor: count('mentor'), founder: count('founder'), unicorn: count('unicorn') })
      .toEqual({ boom: 5, pivot: 7, pass: 5, hostile: 4, ooo: 4, research: 5, reorg: 4, mentor: 4, founder: 30, unicorn: 2 });
    expect(SET_IDS).toHaveLength(6);
    for (const set of SET_IDS) expect(founders(set)).toHaveLength(5);
    expect(new Set(of('founder').map((id) => CARD[id].name)).size).toBe(30);
    expect(of('boom').map((id) => CARD[id].name).sort()).toEqual(['Co-Founder Breakup', 'Runway Ran Out', 'Server Fire', 'The Bubble Pops', 'The Lawsuit']);
    expect(new Set(of('pivot').map((id) => CARD[id].flavor)).size).toBe(7);
  });

  it('gives every card rule text, a flavour line, a business dynamic and a link', () => {
    for (const c of CARDS) {
      for (const f of ['id', 'type', 'name', 'key', 'rule', 'flavor', 'dynamic', 'link', 'icon']) expect(typeof c[f] === 'string' && c[f].length > 0, `${c.name}.${f}`).toBe(true);
      if (c.type === 'founder') expect(c.link).toBe(`https://venturemaker.org/ventureboom/hof/${c.key}`);
      else expect(c.link.startsWith('https://venturemaker.org/ventureboom/dynamics/')).toBe(true);
    }
    expect(CARD[byName('Prototype Pete')].link).toBe('https://venturemaker.org/ventureboom/hof/prototype-pete');
    expect(slug("It's-Like-X-for-Y Yuri")).toBe('its-like-x-for-y-yuri');
    expect(CARD[byName('Runway Ran Out')].link).toBe('https://venturemaker.org/ventureboom/dynamics/runway');
    expect(CARD[of('mentor')[0]].link).toBe('https://venturemaker.org/ventureboom/dynamics/mentor');
    expect(CARD[byName('Gantt Chart Gary')].flavor).toBe("Scheduled this card being played. It's 4 minutes late.");
    expect(new Set(of('founder').map((id) => CARD[id].flavor)).size).toBe(30);
    expect(NAMEABLE).toHaveLength(38); // 30 founders + Unicorn + 7 kinds of action card
    for (const set of SET_IDS) expect(SETS[set].nickname.length).toBeGreaterThan(0);
  });

  it('prints no real entrepreneur and borrows no other game\'s name anywhere in the game folder', () => {
    const dir = path.resolve('src/games/ventureboom');
    const real = ['Wright', 'Dyson', 'Edison', 'Wozniak', 'Cochrane', 'Jobs', 'Buterin', 'Musk', 'Hastings', 'Chesky', 'Henry Ford', 'Kroc', 'Grove', 'Walton', 'Bezos', 'Buffett', 'Munger', 'Conway', 'Doriot', 'Thiel', 'Mary Kay', 'Vaynerchuk', 'Blakely', 'Lauder', 'Walker', 'Hoffman', 'Huffington', 'Wurman', 'Zuckerberg', 'Schultz', 'Tesla', 'Gates'];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue; // art/ holds pictures, checked in tests/ventureboom-art.test.js
      const file = entry.name;
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const name of real) expect(new RegExp(`\\b${name}\\b`).test(text), `${file} mentions ${name}`).toBe(false);
      expect(/exploding\s*kittens/i.test(text), `${file} names another game`).toBe(false);
      expect(new RegExp('[\\u2013\\u2014]').test(text), `${file} uses an en or em dash`).toBe(false);
    }
  });
});

describe('ventureboom: the deal', () => {
  for (let n = 2; n <= 6; n++) {
    it(`${n} seats: 8 cards each with a Pivot, ${n - 1} BOOMs in the pile`, () => {
      const m = createMatch(ventureBoom, n, setupData({ size: n }));
      const G = m.G;
      expect(G.n).toBe(n); expect(G.round).toBe(1); expect(G.rounds).toBe(12); expect(G.turnP).toBe('0'); expect(G.turnsLeft).toBe(1);
      for (let s = 0; s < n; s++) {
        const hand = handOf(m, s);
        expect(hand).toHaveLength(8);
        expect(hand.filter((id) => CARD[id].type === 'pivot').length).toBeGreaterThanOrEqual(1);
        expect(hand.some((id) => CARD[id].type === 'boom')).toBe(false);
        expect(G.counts[s]).toBe(8);
      }
      expect(G.secret.deck.filter((id) => CARD[id].type === 'boom')).toHaveLength(n - 1);
      expect(G.secret.box.filter((id) => CARD[id].type === 'boom')).toHaveLength(5 - (n - 1));
      expect(G.secret.deck).toHaveLength(70 - 5 - 8 * n + (n - 1));
      expect(G.deckCount).toBe(G.secret.deck.length);
      checkInvariants(m, { scores: Array(n).fill(0) });
    });
  }

  it('kids\' edition leaves the Hostile Takeovers in the box', () => {
    const m = createMatch(ventureBoom, 4, setupData({ kids: true }));
    expect(m.G.kids).toBe(true);
    expect(HOSTILE.every((id) => m.G.secret.box.includes(id))).toBe(true);
    expect(m.G.secret.deck).toHaveLength(70 - 4 - 5 - 32 + 3);
  });

  it('normalizes settings and keeps the generic fields', () => {
    expect(normalizeSettings({ size: 3, fillBots: false, botLevel: 3 })).toEqual({ size: 3, fillBots: false, botLevel: 3, rounds: 12, hotMarket: false, kids: false });
    expect(normalizeSettings({ rounds: 4, hotMarket: true, kids: true })).toMatchObject({ rounds: 4, hotMarket: true, kids: true });
    expect(normalizeSettings({ rounds: 7, hotMarket: 'yes' })).toMatchObject({ rounds: 12, hotMarket: false });
    expect(normalizeSettings({ rounds: 1 }).rounds).toBe(1);
    expect(normalizeSettings({ rounds: 2 }).rounds).toBe(2);
    expect(normalizeSettings(undefined)).toEqual({ rounds: 12, hotMarket: false, kids: false });
  });
});

describe('ventureboom: hidden information', () => {
  it('a fresh deal sends each browser its own hand and nothing else', () => {
    for (let n = 2; n <= 6; n++) {
      const m = createMatch(ventureBoom, n, setupData({ size: n }));
      for (let s = 0; s < n; s++) {
        const view = m.view(s);
        expect(Object.keys(view.players)).toEqual([String(s)]);
        expect(view.secret).toBeUndefined();
        expect(view.players[String(s)].hand).toEqual(handOf(m, s));
        const sent = new Set((JSON.stringify(view).match(ID_RE) || []).map((x) => x.slice(1, -1)));
        expect([...sent].sort()).toEqual([...handOf(m, s)].sort()); // exactly its own 8 cards
      }
      const watcher = m.view(null);
      expect(watcher.players).toEqual({});
      expect(watcher.secret).toBeUndefined();
      expect(JSON.stringify(watcher).match(ID_RE)).toBe(null);
      // the house seat's view is stripped too
      expect(JSON.stringify(m.view(n)).match(ID_RE)).toBe(null);
    }
  });

  it('where a BOOM was slid back is invisible to everyone else', () => {
    const play = (pos) => {
      const m = rigged(3, {}, (G) => arrange(G, [[PIVOTS[0], INV[0]], [PIVOTS[1]], [PIVOTS[2]]], [BOOMS[0]]));
      expect(m.move(0, 'draw')).toBe(true);
      expect(m.G.pending).toMatchObject({ stage: 'place', by: 0 });
      expect(m.G.waiting).toEqual([0]);
      expect(m.move(1, 'place', 0)).toBe(false);
      expect(m.move(0, 'place', -1)).toBe(false);
      expect(m.move(0, 'place', m.G.deckCount + 1)).toBe(false);
      expect(m.move(0, 'place', pos)).toBe(true);
      return m;
    };
    const a = play(0);
    const b = play(9);
    expect(a.G.secret.deck[a.G.secret.deck.length - 1]).toBe(BOOMS[0]);
    expect(b.G.secret.deck[b.G.secret.deck.length - 10]).toBe(BOOMS[0]);
    expect(JSON.stringify(a.view(1))).toBe(JSON.stringify(b.view(1)));
    expect(JSON.stringify(a.view(null))).toBe(JSON.stringify(b.view(null)));
    expect(a.view(0).players['0'].boomAt).toBe(0);
    expect(b.view(0).players['0'].boomAt).toBe(9);
    // the move's argument is redacted from boardgame.io's own log
    for (const name of Object.keys(ventureBoom.moves)) { expect(ventureBoom.moves[name].redact).toBe(true); expect(ventureBoom.moves[name].client).toBe(false); }
    expect(ventureBoom.moves.react.ignoreStaleStateID).toBe(true);
    expect(ventureBoom.moves.ready.ignoreStaleStateID).toBe(true);
    expect(ventureBoom.moves.draw.ignoreStaleStateID).toBeUndefined();
  });

  it('drawing with or without a Pivot in hand looks the same to everyone else', () => {
    const top = safeTop(2);
    const play = (hidden) => {
      const m = rigged(3, {}, (G) => arrange(G, [[hidden, OPS[0]], [PIVOTS[1]], [PIVOTS[2]]], top));
      expect(m.move(0, 'draw')).toBe(true);
      return m;
    };
    const withPivot = play(PIVOTS[0]);
    const without = play(INV[0]);
    expect(JSON.stringify(withPivot.view(1))).toBe(JSON.stringify(without.view(1)));
    expect(JSON.stringify(withPivot.view(null))).toBe(JSON.stringify(without.view(null)));
    // ...while the server still measures the risk the player took
    expect(telemetry(withPivot.G, 0).signals.risk).toBe(0);
    expect(telemetry(without.G, 0).signals.risk).toBe(100);
    expect(telemetry(without.G, 0).metrics).toMatchObject({ draws: 1, riskyDraws: 1 });
  });

  it('Market Research is seen by one seat only, and a moved card is named only to the two involved', () => {
    const research = of('research')[0];
    const mentor = of('mentor')[0];
    const top = [INN[0], INN[1], INN[2]];
    const m = rigged(3, {}, (G) => arrange(G, [[research, mentor], [OPS[0]], [OPS[1], OPS[2]]], top));
    expect(m.move(0, 'play', research)).toBe(true);
    letGo(m);
    expect(m.view(0).players['0'].peek).toEqual(top);
    expect(leaks(m, 1)).toEqual([]);
    expect(JSON.stringify(m.view(1))).not.toContain(top[0]);
    // Ask a Mentor: seat 1 must give its only card
    expect(m.move(0, 'play', mentor, 1)).toBe(true);
    letGo(m);
    expect(m.G.pending).toMatchObject({ stage: 'give', by: 0, target: 1 });
    expect(m.G.waiting).toEqual([1]);
    expect(m.move(0, 'give', OPS[0])).toBe(false);
    expect(m.move(1, 'give', OPS[1])).toBe(false);
    expect(m.move(1, 'give', OPS[0])).toBe(true);
    expect(handOf(m, 0)).toEqual([OPS[0]]);
    expect(m.view(0).players['0'].note).toMatchObject({ t: 'got', k: CARD[OPS[0]].key, from: 1 });
    expect(m.view(1).players['1'].note).toMatchObject({ t: 'lost', k: CARD[OPS[0]].key, to: 0 });
    const third = JSON.stringify(m.view(2));
    expect(third).not.toContain(OPS[0]);
    expect(third).not.toContain(CARD[OPS[0]].key);
    expect(m.G.pending).toBe(null);
    expect(m.G.turnP).toBe('0');
  });
});

describe('ventureboom: sets, combos and Exits (pure helpers)', () => {
  const kinds = (ids) => describeSelection(ids).map((o) => `${o.type}:${o.kind}`).sort();
  it('recognises each combo and Exit', () => {
    expect(kinds([INV[0], INV[1]])).toEqual(['combo:poach']);
    expect(kinds([INV[0], INN[0]])).toEqual([]);
    expect(kinds([INV[0], INV[1], INV[2]])).toEqual(['combo:acquihire', 'exit:seed']);
    expect(kinds([INV[0], INV[1], INV[2], INV[3]])).toEqual(['exit:seriesA']);
    expect(kinds(INV)).toEqual(['combo:review', 'exit:dream']);
    expect(kinds(SET_IDS.map((s) => founders(s)[0]))).toEqual(['exit:fullstack']);
    expect(kinds([INV[0], INV[1], INN[0], OPS[0], founders('investors')[0], founders('hustlers')[0]])).toEqual([]);
    expect(kinds([INV[0], PIVOTS[0], PASSES[0], HOSTILE[0], UNICORNS[0]])).toEqual(['combo:review']);
    expect(kinds([INV[0], PIVOTS[0], PIVOTS[1], HOSTILE[0], UNICORNS[0]])).toEqual([]); // two Pivots: not five different names
    expect(kinds([INV[0], INV[0]])).toEqual([]);
    expect(kinds([PIVOTS[0], PIVOTS[1]])).toEqual([]);
    expect(kinds(['nope', INV[0]])).toEqual([]);
  });

  it('treats Unicorns as any founder in any set', () => {
    expect(kinds([INV[0], UNICORNS[0]])).toEqual(['combo:poach']);
    expect(kinds([UNICORNS[0], UNICORNS[1]])).toEqual(['combo:poach']);
    expect(kinds([INV[0], INV[1], UNICORNS[0]])).toEqual(['combo:acquihire', 'exit:seed']);
    expect(kinds([INV[0], UNICORNS[0], UNICORNS[1]])).toEqual(['combo:acquihire', 'exit:seed']);
    expect(kinds([INV[0], INV[1], INV[2], UNICORNS[0], UNICORNS[1]])).toEqual(['exit:dream']);
    expect(kinds([INV[0], INN[0], UNICORNS[0]])).toEqual([]);
    expect(kinds([INV[0], INN[0], OPS[0], founders('investors')[0], UNICORNS[0], UNICORNS[1]])).toEqual(['exit:fullstack']);
    expect(describeSelection([INV[0], INV[1], UNICORNS[0]])[0].set).toBe('inventors');
  });

  it('suggests the Exits and combos a hand holds, best first', () => {
    const hand = [...INV.slice(0, 4), INN[0], INN[1], UNICORNS[0], PIVOTS[0]];
    const exits = exitOptions(hand);
    expect(exits[0]).toMatchObject({ kind: 'dream', set: 'inventors', wilds: 1 });
    expect(exits.map((o) => o.kind)).toEqual(['dream', 'seriesA', 'seed', 'seed']);
    for (const o of exits) expect(describeSelection(o.cards).some((d) => d.type === 'exit' && d.kind === o.kind)).toBe(true);
    for (const o of comboOptions(hand)) expect(describeSelection(o.cards).some((d) => d.type === 'combo' && d.kind === o.kind)).toBe(true);
    expect(comboOptions(hand).map((o) => o.kind).sort()).toEqual(['acquihire', 'acquihire', 'poach', 'poach', 'review']);
    expect(exitOptions([INV[0], INV[1], PIVOTS[0]])).toEqual([]);
    const six = SET_IDS.slice(0, 5).map((s) => founders(s)[0]).concat(UNICORNS[0]);
    expect(exitOptions(six)[0]).toMatchObject({ kind: 'fullstack', wilds: 1 });
  });

  it('values Exits as the rulebook table, doubled in a Hot Market round', () => {
    expect(EXIT_VALUES).toEqual({ seed: 3, seriesA: 6, dream: 10, fullstack: 15 });
    expect(['seed', 'seriesA', 'dream', 'fullstack'].map((k) => exitValue(k, { hot: false }))).toEqual([3, 6, 10, 15]);
    expect(['seed', 'seriesA', 'dream', 'fullstack'].map((k) => exitValue(k, { hot: true }))).toEqual([6, 12, 20, 30]);
  });
});

describe('ventureboom: a turn', () => {
  it('play any number of cards, then draw to end the turn', () => {
    const [r1, r2] = of('research');
    const top = safeTop(4, [r1, r2]);
    const m = rigged(3, {}, (G) => arrange(G, [[r1, r2, PIVOTS[0], PASSES[0], INV[0]], [PIVOTS[1]], [PIVOTS[2]]], top));
    expect(m.move(1, 'draw')).toBe(false); // not their turn
    expect(m.move(0, 'play', PIVOTS[0])).toBe(false); // a Pivot is not played from the hand
    expect(m.move(0, 'play', PASSES[0])).toBe(false); // nor is a Hard Pass
    expect(m.move(0, 'play', INV[0])).toBe(false); // a founder has no power alone
    expect(m.move(0, 'play', top[0])).toBe(false); // not in hand
    expect(m.move(0, 'play', r1)).toBe(true);
    expect(m.move(0, 'draw')).toBe(false); // the play resolves first
    expect(m.move(0, 'play', r2)).toBe(false);
    letGo(m);
    expect(m.move(0, 'play', r2)).toBe(true);
    letGo(m);
    expect(m.G.turnP).toBe('0');
    expect(m.move(0, 'draw')).toBe(true);
    expect(handOf(m, 0)).toContain(top[0]);
    expect(m.G.turnP).toBe('1');
    expect(m.view(0).players['0'].note).toMatchObject({ t: 'drew', k: CARD[top[0]].key });
    expect(m.view(0).players['0'].peek).toEqual(top.slice(1, 3)); // what was seen moves up as the pile is drawn
    expect(m.G.discard).toEqual([r1, r2]);
  });

  it('Out of Office ends one turn without drawing', () => {
    const ooo = of('ooo')[0];
    const m = rigged(2, {}, (G) => arrange(G, [[ooo], [PIVOTS[1]]]));
    const deck = m.G.deckCount;
    expect(m.move(0, 'play', ooo)).toBe(true);
    letGo(m);
    expect(m.G.turnP).toBe('1');
    expect(m.G.deckCount).toBe(deck);
    expect(handOf(m, 0)).toEqual([]);
  });

  it('Hostile Takeover gives the next player 2 turns and stacks by 2 each time it is passed on', () => {
    const top = safeTop(6);
    const m = rigged(4, {}, (G) => arrange(G, [[HOSTILE[0]], [HOSTILE[1]], [HOSTILE[2]], [PIVOTS[0]]], top));
    const deck = m.G.deckCount;
    expect(m.move(0, 'play', HOSTILE[0])).toBe(true);
    expect(m.G.pending).toMatchObject({ what: 'hostile', by: 0, target: 1 });
    letGo(m);
    expect(m.G).toMatchObject({ turnP: '1', turnsLeft: 2, attacked: true });
    expect(m.G.deckCount).toBe(deck); // no draw
    expect(m.move(1, 'play', HOSTILE[1])).toBe(true); letGo(m);
    expect(m.G).toMatchObject({ turnP: '2', turnsLeft: 4 });
    expect(m.move(2, 'play', HOSTILE[2])).toBe(true); letGo(m);
    expect(m.G).toMatchObject({ turnP: '3', turnsLeft: 6 });
    for (let left = 5; left >= 1; left--) { expect(m.move(3, 'draw')).toBe(true); expect(m.G).toMatchObject({ turnP: '3', turnsLeft: left }); }
    expect(m.move(3, 'draw')).toBe(true);
    expect(m.G).toMatchObject({ turnP: '0', turnsLeft: 1, attacked: false });
  });

  it('a takeover passed on after taking one of the two turns hands over the turn still owed plus 2', () => {
    const ooo = of('ooo')[0];
    const m = rigged(3, {}, (G) => arrange(G, [[HOSTILE[0]], [HOSTILE[1], ooo], [PIVOTS[0]]], safeTop(3, [ooo])));
    m.move(0, 'play', HOSTILE[0]); letGo(m);
    expect(m.G).toMatchObject({ turnP: '1', turnsLeft: 2 });
    expect(m.move(1, 'play', ooo)).toBe(true); letGo(m); // Out of Office ends ONE of the turns owed
    expect(m.G).toMatchObject({ turnP: '1', turnsLeft: 1, attacked: true });
    expect(m.move(1, 'play', HOSTILE[1])).toBe(true); letGo(m);
    expect(m.G).toMatchObject({ turnP: '2', turnsLeft: 3 });
  });

  it('Reorg shuffles the same cards and wipes what anyone knew about the top', () => {
    const reorg = of('reorg')[0];
    const research = of('research')[0];
    const m = rigged(2, {}, (G) => arrange(G, [[research, reorg], [PIVOTS[1]]]));
    m.move(0, 'play', research); letGo(m);
    expect(m.view(0).players['0'].peek).toHaveLength(3);
    const before = [...m.G.secret.deck].sort();
    m.move(0, 'play', reorg); letGo(m);
    expect([...m.G.secret.deck].sort()).toEqual(before);
    expect(m.view(0).players['0'].peek).toBe(null);
  });
});

describe('ventureboom: Hard Pass', () => {
  const table = () => rigged(3, {}, (G) => arrange(G, [[...INV.slice(0, 3), PASSES[0], PASSES[1]], [PASSES[2], PASSES[3]], [PIVOTS[0]]]));

  it('everyone else is asked, and an Exit nobody stops scores at once', () => {
    const m = table();
    expect(m.move(0, 'exit', 'seriesA', INV.slice(0, 3))).toBe(false);
    expect(m.move(0, 'exit', 'seed', [INV[0], INV[1], INV[3]])).toBe(false); // not all in hand
    expect(m.move(0, 'exit', 'seed', INV.slice(0, 3))).toBe(true);
    expect(m.G.pending).toMatchObject({ stage: 'react', kind: 'exit', what: 'seed', by: 0, value: 3, passes: 0 });
    expect(m.G.waiting).toEqual([1, 2]);
    expect(m.G.resolving).toBe(true);
    expect(m.G.scores).toEqual([0, 0, 0]);
    expect(m.move(0, 'react', false, m.G.pending.id, 0)).toBe(false); // the player who acted is not asked
    expect(m.move(2, 'react', true, m.G.pending.id, 0)).toBe(false); // holds no Hard Pass
    expect(m.move(1, 'react', false, m.G.pending.id + 1, 0)).toBe(false); // wrong window
    expect(m.move(1, 'react', false, m.G.pending.id, 1)).toBe(false); // wrong Hard Pass count
    expect(m.move(1, 'react', false)).toBe(false); // an answer must say what it answers
    expect(m.move(1, 'react', false, m.G.pending.id, 0)).toBe(true);
    expect(m.G.waiting).toEqual([2]);
    expect(m.move(1, 'react', false, m.G.pending.id, 0)).toBe(false); // already answered
    expect(m.move(2, 'react', false, m.G.pending.id, 0)).toBe(true);
    expect(m.G.pending).toBe(null);
    expect(m.G.scores).toEqual([3, 0, 0]);
    expect(m.G.exits[0]).toEqual([{ kind: 'seed', cards: INV.slice(0, 3), value: 3, set: 'inventors' }]);
    expect(m.G.turnP).toBe('0'); // still their turn
    expect(m.G.resolving).toBe(false);
  });

  it('one Hard Pass cancels: the deal falls through and its cards are discarded', () => {
    const m = table();
    m.move(0, 'exit', 'seed', INV.slice(0, 3));
    expect(pass(m, 1)).toBe(true);
    expect(m.G.pending.passes).toBe(1);
    expect(m.G.waiting).toEqual([0, 2]); // a new window for everyone but the seat that passed
    expect(m.G.discard).toEqual([PASSES[2]]);
    letGo(m);
    expect(m.G.scores).toEqual([0, 0, 0]);
    expect(m.G.exits[0]).toEqual([]);
    expect(m.G.discard).toEqual([PASSES[2], ...INV.slice(0, 3)]);
    expect(m.G.stats[0].dealsLost).toBe(1);
    expect(m.G.stats[1].hardPasses).toBe(1);
  });

  it('a Hard Pass can be Hard Passed: two put the Exit back on, three cancel it again', () => {
    const two = table();
    two.move(0, 'exit', 'seed', INV.slice(0, 3));
    pass(two, 1);
    expect(pass(two, 0)).toBe(true); // the player who acted answers back
    expect(two.G.waiting).toEqual([1, 2]);
    letGo(two);
    expect(two.G.scores).toEqual([3, 0, 0]);

    const three = table();
    three.move(0, 'exit', 'seed', INV.slice(0, 3));
    pass(three, 1); pass(three, 0);
    expect(pass(three, 1)).toBe(true);
    expect(three.G.pending.passes).toBe(3);
    letGo(three);
    expect(three.G.scores).toEqual([0, 0, 0]);
    expect(three.G.discard).toHaveLength(6);

    const four = table();
    four.move(0, 'exit', 'seed', INV.slice(0, 3));
    pass(four, 1); pass(four, 0); pass(four, 1); pass(four, 0);
    letGo(four);
    expect(four.G.scores).toEqual([3, 0, 0]);
  });

  it('a Hard Passed action card does nothing, and the turn carries on', () => {
    const m = rigged(3, {}, (G) => arrange(G, [[HOSTILE[0], PIVOTS[0]], [PASSES[0]], [PIVOTS[1]]]));
    m.move(0, 'play', HOSTILE[0]);
    pass(m, 1); letGo(m);
    expect(m.G).toMatchObject({ turnP: '0', turnsLeft: 1, attacked: false, pending: null });
    expect(m.G.discard).toEqual([HOSTILE[0], PASSES[0]]);
  });

  it('a BOOM and a Pivot cannot be Hard Passed', () => {
    const m = rigged(3, {}, (G) => arrange(G, [[PIVOTS[0]], [PASSES[0]], [PASSES[1]]], [BOOMS[0]]));
    m.move(0, 'draw');
    expect(m.G.pending.stage).toBe('place');
    expect(m.G.waiting).toEqual([0]);
    expect(legalActions(m.view(1), 1)).toEqual([]);
    expect(m.move(1, 'react', true, m.G.pending.id, 0)).toBe(false);
  });

  it('the house lets an unanswered window go, and refuses a stale timer', () => {
    const m = table();
    m.move(0, 'exit', 'seed', INV.slice(0, 3));
    const chore = housekeeping(m.G);
    expect(chore).toMatchObject({ move: 'houseTick', afterMs: REACT_MS });
    expect(m.move(1, 'houseTick', ...chore.args)).toBe(false); // only the server's seat
    m.move(1, 'react', false, m.G.pending.id, 0);
    expect(pass(m, 2)).toBe(false);
    const stale = chore.args[0] - 1;
    expect(m.move(m.house(), 'houseTick', stale)).toBe(false);
    expect(m.move(m.house(), 'houseTick', ...housekeeping(m.G).args)).toBe(true);
    expect(m.G.scores).toEqual([3, 0, 0]);
    expect(housekeeping(m.G)).toBe(null);
    expect(m.move(m.house(), 'draw')).toBe(false);
  });
});

describe('ventureboom: combos', () => {
  it('Poach takes a random card from the chosen player', () => {
    const m = rigged(3, {}, (G) => arrange(G, [[INV[0], INV[1]], [OPS[0]], []]));
    expect(m.move(0, 'combo', 'poach', [INV[0], INV[1]], 2)).toBe(false); // nothing to take there
    expect(m.move(0, 'combo', 'poach', [INV[0], INV[1]], 0)).toBe(false);
    expect(m.move(0, 'combo', 'poach', [INV[0], INV[1]])).toBe(false);
    expect(m.move(0, 'combo', 'poach', [INV[0], INV[1]], 1)).toBe(true);
    letGo(m);
    expect(handOf(m, 0)).toEqual([OPS[0]]);
    expect(handOf(m, 1)).toEqual([]);
    expect(m.G.counts).toEqual([1, 0, 0]);
    expect(m.G.discard).toEqual([INV[0], INV[1]]);
    expect(JSON.stringify(m.view(2))).not.toContain(CARD[OPS[0]].key);
  });

  it('Acqui-hire names a card: a hit moves it, a miss moves nothing', () => {
    const hit = rigged(2, {}, (G) => arrange(G, [INV.slice(0, 3), [PIVOTS[0], OPS[0]]]));
    expect(hit.move(0, 'combo', 'acquihire', INV.slice(0, 3), 1)).toBe(false); // must name a card
    expect(hit.move(0, 'combo', 'acquihire', INV.slice(0, 3), 1, 'server-fire')).toBe(false); // a BOOM is never in a hand
    expect(hit.move(0, 'combo', 'acquihire', INV.slice(0, 3), 1, 'pivot')).toBe(true);
    expect(hit.G.pending).toMatchObject({ what: 'acquihire', target: 1, named: 'pivot' });
    letGo(hit);
    expect(handOf(hit, 0)).toEqual([PIVOTS[0]]);
    expect(handOf(hit, 1)).toEqual([OPS[0]]);
    expect(hit.G.log.find((e) => e.t === 'hire')).toMatchObject({ ok: true, named: 'pivot' });

    const miss = rigged(2, {}, (G) => arrange(G, [INV.slice(0, 3), [PIVOTS[0], OPS[0]]]));
    miss.move(0, 'combo', 'acquihire', INV.slice(0, 3), 1, 'unicorn'); letGo(miss);
    expect(handOf(miss, 0)).toEqual([]);
    expect(handOf(miss, 1)).toEqual([PIVOTS[0], OPS[0]]);
    expect(miss.G.log.find((e) => e.t === 'hire')).toMatchObject({ ok: false });
  });

  it('Portfolio Review takes any card from the discard pile', () => {
    const five = [INV[0], INN[0], PASSES[0], of('reorg')[0], UNICORNS[0]];
    const m = rigged(2, {}, (G) => { arrange(G, [five, [PIVOTS[0]]]); G.secret.deck = G.secret.deck.filter((id) => id !== PIVOTS[3]); G.discard = [PIVOTS[3]]; G.deckCount = G.secret.deck.length; });
    expect(m.move(0, 'combo', 'review', five.slice(0, 4))).toBe(false);
    expect(m.move(0, 'combo', 'review', five, 1)).toBe(false);
    expect(m.move(0, 'combo', 'review', five)).toBe(true);
    letGo(m);
    expect(m.G.pending).toMatchObject({ stage: 'pick', by: 0 });
    expect(m.G.waiting).toEqual([0]);
    expect(m.move(1, 'pick', PIVOTS[3])).toBe(false);
    expect(m.move(0, 'pick', PIVOTS[0])).toBe(false); // not in the pile
    expect(m.move(0, 'pick', PIVOTS[3])).toBe(true);
    expect(handOf(m, 0)).toEqual([PIVOTS[3]]);
    expect(m.G.discard).toEqual(five);
    expect(m.G.turnP).toBe('0');
  });

  it('the house makes a choice at random for a player who does not', () => {
    const mentor = of('mentor')[0];
    const m = rigged(2, {}, (G) => arrange(G, [[mentor], [OPS[0], OPS[1]]]));
    m.move(0, 'play', mentor, 1); letGo(m);
    expect(m.G.pending.stage).toBe('give');
    expect(house(m)).toBe(true);
    expect(handOf(m, 0)).toHaveLength(1);
    expect(handOf(m, 1)).toHaveLength(1);
    expect(m.G.pending).toBe(null);

    const b = rigged(2, {}, (G) => arrange(G, [[PIVOTS[0]], [PIVOTS[1]]], [BOOMS[0]]));
    b.move(0, 'draw');
    expect(house(b)).toBe(true);
    expect(b.G.secret.deck).toContain(BOOMS[0]);
    expect(b.G.turnP).toBe('1');
  });
});

describe('ventureboom: Exits', () => {
  it('scores every tier, several in one turn, and counts the big ones for the tiebreak', () => {
    const fullstack = SET_IDS.map((s) => founders(s)[4]);
    const hand = [...INV.slice(0, 3), ...INN.slice(0, 4), ...OPS.slice(0, 4), UNICORNS[0], ...fullstack.filter((id) => !OPS.includes(id) && !INV.includes(id) && !INN.includes(id))];
    const m = rigged(2, {}, (G) => arrange(G, [[...hand, INV[4], INN[4], OPS[4]], [PIVOTS[0]]]));
    expect(m.move(0, 'exit', 'seed', INV.slice(0, 3))).toBe(true); letGo(m);
    expect(m.move(0, 'exit', 'seriesA', INN.slice(0, 4))).toBe(true); letGo(m);
    expect(m.move(0, 'exit', 'dream', [...OPS.slice(0, 4), UNICORNS[0]])).toBe(true); letGo(m);
    expect(m.move(0, 'exit', 'fullstack', fullstack)).toBe(true); letGo(m);
    expect(m.G.scores[0]).toBe(3 + 6 + 10 + 15);
    expect(m.G.bigExits[0]).toBe(2);
    expect(m.G.exits[0].map((e) => e.kind)).toEqual(['seed', 'seriesA', 'dream', 'fullstack']);
    expect(handOf(m, 0)).toEqual([]);
    const t = telemetry(m.G, 0);
    expect(t.metrics).toMatchObject({ exits: 4, bigExits: 2, exitValue: 34, score: 34 });
    expect(t.signals.horizon).toBe(Math.round((100 * 31) / 34));
    expect(observations(t.metrics, 1, 2)[0]).toBe('Banked 4 Exits worth $34M, 2 of them a Dream Team or Full-Stack Company.');
  });

  it('Hot Market doubles Exit values in the last three rounds only', () => {
    const early = rigged(2, { rounds: 4, hotMarket: true }, (G) => arrange(G, [INV.slice(0, 3), [PIVOTS[0]]]));
    expect(early.G.hot).toBe(false);
    early.move(0, 'exit', 'seed', INV.slice(0, 3)); letGo(early);
    expect(early.G.scores[0]).toBe(3);

    const late = rigged(2, { rounds: 2, hotMarket: true }, (G) => arrange(G, [INV.slice(0, 3), [PIVOTS[0]]]));
    expect(late.G.hot).toBe(true);
    expect(selectionActions(late.view(0), 0, INV.slice(0, 3)).find((a) => a.move === 'exit').value).toBe(6);
    late.move(0, 'exit', 'seed', INV.slice(0, 3)); letGo(late);
    expect(late.G.scores[0]).toBe(6);

    const off = createMatch(ventureBoom, 2, setupData({ rounds: 2 }));
    expect(off.G.hot).toBe(false);
    // 12 rounds: hot from round 10
    const long = createMatch(ventureBoom, 2, setupData({ hotMarket: true }));
    expect(long.G.hot).toBe(false);
    expect(long.G.rounds - 3).toBe(9);
  });
});

describe('ventureboom: BOOMs, rounds and winning', () => {
  it('a Pivot is spent automatically, the BOOM goes back where the drawer chooses, and the turn ends', () => {
    const top = [BOOMS[0], ...safeTop(3)];
    const m = rigged(3, {}, (G) => arrange(G, [[PIVOTS[0], PIVOTS[1]], [PIVOTS[2]], [PIVOTS[3]]], top));
    expect(m.move(0, 'draw')).toBe(true);
    expect(handOf(m, 0)).toEqual([PIVOTS[1]]); // one Pivot spent
    expect(m.G.discard).toEqual([PIVOTS[0]]);
    expect(m.G.pending).toMatchObject({ stage: 'place', k: 'server-fire', cards: [BOOMS[0]] });
    expect(m.G.round).toBe(1);
    expect(legalActions(m.view(0), 0).map((a) => a.args[0])).toEqual(Array.from({ length: m.G.deckCount + 1 }, (_, i) => i));
    expect(m.move(0, 'place', 1)).toBe(true); // one card above it
    expect(m.G.turnP).toBe('1');
    expect(m.G.stats[0].boomsSurvived).toBe(1);
    expect(m.move(1, 'draw')).toBe(true); // the safe card on top
    expect(m.G.turnP).toBe('2');
    expect(m.move(2, 'draw')).toBe(true); // the BOOM
    expect(m.G.pending).toMatchObject({ stage: 'place', by: 2 });
  });

  it('no Pivot: bankrupt, everyone else takes the survival bonus, and the next round starts to the left', () => {
    const m = rigged(4, {}, (G) => { arrange(G, [[...INV.slice(0, 3), PIVOTS[0]], [OPS[0], OPS[1]], [PIVOTS[1]], [PIVOTS[2]]], [of('research')[0], BOOMS[1]]); });
    m.move(0, 'exit', 'seed', INV.slice(0, 3)); letGo(m);
    m.move(0, 'draw');
    expect(m.move(1, 'draw')).toBe(true); // The BOOM, with no Pivot in hand
    expect(m.G.bankruptcies).toEqual([0, 1, 0, 0]);
    expect(m.G.scores).toEqual([4, 0, 1, 1]); // earlier Exit still counts; survivors +$1M
    expect(m.G.summary).toMatchObject({ round: 1, bankrupt: 1, boomCard: CARD[BOOMS[1]].key, gains: [4, 0, 1, 1], scores: [4, 0, 1, 1] });
    expect(isBetweenRounds(m.G)).toBe(true);
    expect(m.G.turnP).toBe(null);
    expect(actingSeats(m.G)).toEqual([]);
    expect(m.move(2, 'draw')).toBe(false);
    expect(m.move(0, 'ready', 2)).toBe(false); // wrong round
    expect(legalActions(m.view(3), 3)).toEqual([{ move: 'ready', args: [1] }]);
    expect(housekeeping(m.G)).toMatchObject({ move: 'houseTick', afterMs: BETWEEN_MS });
    expect(house(m)).toBe(true);
    expect(m.G.round).toBe(2);
    expect(m.G.turnP).toBe('2'); // the seat after the one who went bankrupt
    expect(m.G.summary).toBe(null);
    expect(m.G.exits).toEqual([[], [], [], []]);
    expect(m.G.discard).toEqual([]);
    for (let s = 0; s < 4; s++) expect(handOf(m, s)).toHaveLength(8); // hands are lost and re-dealt
    expect(m.G.scores).toEqual([4, 0, 1, 1]);
    checkInvariants(m, { scores: [4, 0, 1, 1] });
  });

  it('any seated player can skip the pause with ready()', () => {
    const m = rigged(2, {}, (G) => arrange(G, [[OPS[0]], [PIVOTS[0]]], [BOOMS[0]]));
    m.move(0, 'draw');
    expect(isBetweenRounds(m.G)).toBe(true);
    expect(m.move(m.house(), 'ready', 1)).toBe(false); // the house is not a player
    expect(m.move(1, 'ready', 1)).toBe(true);
    expect(m.G.round).toBe(2);
    expect(m.G.turnP).toBe('1');
    expect(m.move(0, 'ready', 1)).toBe(false);
  });

  it('kids\' edition: the bankrupt player keeps their hand on top of the new deal', () => {
    const kept = [OPS[0], OPS[1], INV[0]];
    const m = rigged(3, { kids: true }, (G) => arrange(G, [kept, [PIVOTS[0]], [PIVOTS[1]]], [BOOMS[0]]));
    m.move(0, 'draw');
    expect(m.G.bankruptcies).toEqual([1, 0, 0]);
    house(m);
    expect(handOf(m, 0)).toHaveLength(11);
    for (const id of kept) expect(handOf(m, 0)).toContain(id);
    expect(handOf(m, 1)).toHaveLength(8);
    expect(handOf(m, 0).filter((id) => CARD[id].type === 'pivot').length).toBeGreaterThanOrEqual(1);
    expect(m.G.log[m.G.log.length - 1]).toMatchObject({ t: 'deal', round: 2, kept: 0 });
    checkInvariants(m, { scores: [0, 0, 0] });

    // too many cards to set aside: a normal deal instead
    const many = CARDS.filter((c) => c.type === 'founder').map((c) => c.id).slice(0, 26);
    const big = rigged(6, { kids: true }, (G) => arrange(G, [many, [PIVOTS[0]], [PIVOTS[1]], [PIVOTS[2]], [PIVOTS[3]], [PIVOTS[4]]], [BOOMS[0]]));
    big.move(0, 'draw'); house(big);
    expect(handOf(big, 0)).toHaveLength(8);
    checkInvariants(big, { scores: Array(6).fill(0) });

    const standard = rigged(3, {}, (G) => arrange(G, [kept, [PIVOTS[0]], [PIVOTS[1]]], [BOOMS[0]]));
    standard.move(0, 'draw'); house(standard);
    expect(handOf(standard, 0)).toHaveLength(8);
  });

  it('after the last round the highest valuation wins; ties go to fewer bankruptcies, then more big Exits', () => {
    const end = (scores, bankruptcies, bigExits) => {
      const n = scores.length;
      const m = rigged(n, { rounds: 1 }, (G) => {
        arrange(G, Array.from({ length: n }, (_, s) => (s === n - 1 ? [OPS[0]] : [PIVOTS[s]])), [BOOMS[0]]);
        G.scores = scores.slice(); G.bankruptcies = bankruptcies.slice(); G.bigExits = bigExits.slice(); G.turnP = String(n - 1);
      });
      expect(m.move(n - 1, 'draw')).toBe(true); // the last seat goes bankrupt and the game ends
      expect(m.G.over.reason).toBe('rounds');
      expect(isBetweenRounds(m.G)).toBe(false);
      expect(housekeeping(m.G)).toBe(null);
      expect(legalActions(m.view(0), 0)).toEqual([]);
      return m.G.over;
    };
    expect(end([10, 7, 3, 0], [0, 0, 0, 0], [0, 0, 0, 0]).placements).toEqual([1, 2, 3, 4]);
    expect(end([10, 10, 10, 4], [1, 0, 0, 0], [0, 0, 0, 0]).placements).toEqual([3, 1, 1, 4]); // fewer bankruptcies
    expect(end([10, 10, 10, 4], [1, 0, 0, 0], [0, 1, 0, 0]).placements).toEqual([3, 1, 2, 4]); // then more Dream Team / Full-Stack Exits
    expect(end([10, 10, 10, 4], [1, 1, 1, 0], [2, 0, 1, 0]).placements).toEqual([1, 3, 2, 4]);
    expect(end([5, 5, 0], [2, 2, 0], [1, 1, 0])).toMatchObject({ placements: [1, 1, 3], scores: [6, 6, 0] }); // still tied: shared
    expect(end([0, 9], [0, 0], [0, 0]).placements).toEqual([2, 1]); // 1 survival point is not enough
  });

  it('a round that never ends is stopped by the turn cap: no bankruptcy, everyone takes the bonus', () => {
    const m = rigged(3, {}, (G) => { arrange(G, [[PIVOTS[0]], [PIVOTS[1]], [PIVOTS[2]]], safeTop(2)); G.roundTurns = ROUND_TURN_CAP - 1; });
    expect(m.move(0, 'draw')).toBe(true);
    expect(m.G.summary).toMatchObject({ bankrupt: null, reason: 'cap', gains: [1, 1, 1] });
    expect(m.G.bankruptcies).toEqual([0, 0, 0]);
    expect(m.G.scores).toEqual([1, 1, 1]);
    house(m);
    expect(m.G.turnP).toBe('1'); // nobody went bankrupt: the seat after the last starter
  });

  it('a draw pile that runs dry is refilled from the discards', () => {
    const m = rigged(2, {}, (G) => { arrange(G, [[PIVOTS[0]], [PIVOTS[1]]]); G.discard = G.secret.deck.filter((id) => CARD[id].type !== 'boom'); G.secret.box.push(...G.secret.deck.filter((id) => CARD[id].type === 'boom')); G.secret.deck = []; G.deckCount = 0; });
    const pile = m.G.discard.length;
    expect(m.move(0, 'draw')).toBe(true);
    expect(m.G.discard).toEqual([]);
    expect(m.G.deckCount).toBe(pile - 1);
    expect(handOf(m, 0)).toHaveLength(2);
  });
});

describe('ventureboom: the bot', () => {
  it('banks its best Exit, answers a window, and never needs a hidden card', () => {
    const m = rigged(3, {}, (G) => arrange(G, [[...INV, PIVOTS[0]], [PASSES[0], PIVOTS[1]], [PIVOTS[2]]]));
    const first = bot({ G: m.view(0), seat: 0, level: 2 });
    expect(first.move).toBe('exit');
    expect(first.args[0]).toBe('dream');
    expect(m.move(0, first.move, ...first.args)).toBe(true);
    const sharp = bot({ G: m.view(1), seat: 1, level: 3 }); // holds a Hard Pass, faces a $10M Exit
    expect(sharp).toEqual({ move: 'react', args: [true, m.G.pending.id, 0] });
    const empty = bot({ G: m.view(2), seat: 2, level: 3 }); // no Hard Pass: lets it go
    expect(empty).toEqual({ move: 'react', args: [false, m.G.pending.id, 0] });
    expect(bot({ G: m.view(0), seat: 0, level: 2 })).toBe(null); // not asked: nothing to do
    expect(bot({ G: m.view(null), seat: 0, level: 2 })).toBe(null); // a view with no hand
  });

  it('acts on what Market Research showed it', () => {
    const research = of('research')[0];
    const ooo = of('ooo')[0];
    const m = rigged(4, {}, (G) => arrange(G, [[research, ooo], [PIVOTS[1]], [PIVOTS[2]], [PIVOTS[3]]], [BOOMS[0], ...safeTop(2, [research, ooo])]));
    m.move(0, 'play', research); letGo(m);
    expect(CARD[m.view(0).players['0'].peek[0]].type).toBe('boom');
    expect(bot({ G: m.view(0), seat: 0, level: 2 })).toEqual({ move: 'play', args: [ooo] }); // no Pivot, BOOM on top: step aside
  });
});

describe('ventureboom: full games, bot against bot', () => {
  for (let n = 2; n <= 6; n++) {
    it(`${n} seats, 12 rounds: every game reaches a result with the invariants intact at every step`, () => {
      const seen = {};
      for (let run = 0; run < 3; run++) {
        const g = fullGame(n, { rounds: 12 }, 2, { views: run === 0 });
        expectFinished(g.m, n, 12);
        for (const [k, v] of Object.entries(g.seen)) seen[k] = (seen[k] || 0) + v;
      }
      for (const move of ['draw', 'react', 'houseTick', 'exit']) expect(seen[move], `${move} was exercised`).toBeGreaterThan(0);
    });
  }

  it('loose (level 1) and sharp (level 3) bots also finish, and between them use every kind of move', () => {
    const seen = {};
    for (const [n, level] of [[2, 1], [4, 1], [6, 1], [3, 3], [4, 3], [5, 3], [3, 1], [5, 1]]) {
      const g = fullGame(n, { rounds: 12 }, level, { views: false });
      expectFinished(g.m, n, 12);
      for (const [k, v] of Object.entries(g.seen)) seen[k] = (seen[k] || 0) + v;
    }
    for (const move of ['draw', 'play', 'combo', 'exit', 'react', 'give', 'place', 'houseTick', 'poach', 'seed']) expect(seen[move], `${move} was exercised`).toBeGreaterThan(0);
  });

  it('Fiscal Year, Hot Market and the kids\' edition play through', () => {
    const fiscal = fullGame(4, { rounds: 4, hotMarket: true }, 2);
    expectFinished(fiscal.m, 4, 4);
    expect(fiscal.m.G.hot).toBe(true);
    const kids = fullGame(5, { rounds: 4, kids: true }, 2);
    expectFinished(kids.m, 5, 4);
    expect(HOSTILE.every((id) => kids.m.G.secret.box.includes(id))).toBe(true);
    const kidsLong = fullGame(3, { rounds: 12, kids: true, hotMarket: true }, 1, { views: false });
    expectFinished(kidsLong.m, 3, 12);
    const one = fullGame(2, { rounds: 1 }, 2);
    expectFinished(one.m, 2, 1);
  });
});

describe('ventureboom: what the arena is told', () => {
  it('meta has the shape the lobby, the how-to panel and the SEO page need', () => {
    expect(meta).toMatchObject({ id: 'ventureboom', name: 'VentureBoom', family: 'venturemaker', brand: 'VentureBoom™', seats: { min: 2, max: 6, defaultSize: 4 }, minutes: '15-40', paceSec: 10, hasSettings: true });
    expect(meta.skills).toEqual(['deal making', 'risk', 'portfolio thinking']);
    expect(meta.howTo.length).toBeGreaterThanOrEqual(5); expect(meta.howTo.length).toBeLessThanOrEqual(7);
    expect(meta.rulesText.length).toBeGreaterThanOrEqual(6);
    for (const s of meta.rulesText) { expect(typeof s.h).toBe('string'); expect(s.p.length).toBeGreaterThan(40); }
    expect(meta.reflection).toContain('Which entrepreneur type did you find hardest to collect, and who do you know like that?');
    expect(meta.reflection).toContain('When did you know the boom was coming, and what did you do about it?');
    expect(meta.reflection.length).toBeGreaterThanOrEqual(3); expect(meta.reflection.length).toBeLessThanOrEqual(4);
    for (const f of ['title', 'description', 'intro']) expect(meta.seo[f].length).toBeGreaterThan(20);
    expect(meta.seo.strategy.length).toBeGreaterThanOrEqual(3);
    expect(ventureBoom.name).toBe('ventureboom');
    expect(ventureBoom.arena).toEqual({ house: true, seatsMin: 2, seatsMax: 6 });
  });

  it('telemetry and observations describe a seat without throwing on any state', () => {
    const m = createMatch(ventureBoom, 3, setupData({ size: 3 }));
    const t = telemetry(m.G, 0);
    expect(t.skillTags).toEqual(['risk', 'portfolio thinking', 'deal making']);
    expect(t.signals).toEqual({ risk: 50, negotiation: 20, horizon: 50 });
    expect(t.midRank).toBeUndefined();
    expect(() => telemetry({}, 0)).not.toThrow();
    expect(observations({ exits: 3, exitValue: 19, bigExits: 1, bankruptcies: 2, boomsSurvived: 0, rounds: 12, draws: 40, riskyDraws: 5, dealsLost: 0, hardPasses: 0 }, 2, 4))
      .toEqual(['Banked 3 Exits worth $19M, 1 of them a Dream Team or Full-Stack Company.', 'Went bankrupt twice.']);
    expect(observations({}, 1, 4)[0]).toBe('Banked no Exits: every point came from outlasting someone else.');
  });
});
