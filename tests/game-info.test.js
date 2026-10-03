// The table's info drawer: every game's Progress, Key and (where it has luck)
// Rolls, computed from what a browser is actually given. A view that throws
// here would be a blank tab at a live table.
import { describe, it, expect } from 'vitest';
import { GAMES, GAME_ORDER } from '../src/games/registry.js';
import { createMatch, playout } from '../src/games/sim.js';
import { recordRoll, rollCharts } from '../src/games/kit.js';
import { CARDS, BY_KEY, DYNAMICS } from '../src/games/ventureboom/cards.js';
import { STORIES, SET_TRAITS } from '../src/games/ventureboom/hall-of-fame/stories.js';
import { WEATHER_ORDER } from '../src/games/ventureflow/vf/data/gameConfig.js';

const INFO = Object.fromEntries(await Promise.all(GAME_ORDER.map(async (id) => [id, await import(`../src/games/${id}/info.js`)])));
const itemsOf = (key) => key.groups.flatMap((g) => g.items);

function checkProgress(p, n) {
  expect(p.stage.label).toEqual(expect.any(String));
  expect(p.stage.of).toBeGreaterThan(0);
  expect(p.stage.done).toBeGreaterThanOrEqual(0);
  expect(p.stage.done).toBeLessThanOrEqual(p.stage.of);
  expect(p.rows).toHaveLength(n);
  for (const row of p.rows) {
    expect(row).toHaveLength(p.columns.length);
    for (const v of row) { expect(['string', 'number']).toContain(typeof v); expect(String(v)).not.toMatch(/NaN|undefined|null/); }
  }
  for (const note of p.notes || []) expect(note).not.toMatch(/NaN|undefined|null/);
}

for (const id of GAME_ORDER) {
  const g = GAMES[id]; const info = INFO[id];
  describe(`game info: ${id}`, () => {
    it('has a key whose entries all say what the piece does', () => {
      const items = itemsOf(info.key);
      expect(items.length).toBeGreaterThan(3);
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size, 'entry ids are unique: the Key opens at one by id').toBe(ids.length);
      for (const i of items) {
        expect(i.name, i.id).toBeTruthy();
        expect(i.power && i.power.length, `${i.id} says what it does`).toBeGreaterThan(10);
        expect(i.power, i.id).not.toMatch(/—|undefined|NaN/);
      }
    });

    it('shows progress from a seat, from the stands, at the start and at the end', () => {
      const n = g.meta.seats.max;
      const setupData = g.testSetup ? g.testSetup(n) : undefined;
      const fresh = createMatch(g.rules, n, setupData);
      for (const seat of [0, null]) checkProgress(info.progress(fresh.view(seat)), n);
      const done = playout({ game: g.rules, bot: g.bot, housekeeping: g.housekeeping, numSeats: n, setupData });
      for (const seat of [0, n - 1, null]) {
        const p = info.progress(done.view(seat));
        checkProgress(p, n);
        if (info.rolls) for (const c of info.rolls(done.view(seat))) { expect(c.title).toBeTruthy(); for (const b of c.bars) expect(Number.isFinite(b.value)).toBe(true); }
      }
      expect(info.progress(fresh.view(0)).stage.done).toBeLessThanOrEqual(info.progress(done.view(0)).stage.done);
    });
  });
}

describe('VentureBoom key', () => {
  const items = itemsOf(INFO.ventureboom.key);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));

  it('has an entry, with a trait, a lesson and a true story, for every card in the deck and every move', () => {
    for (const c of CARDS) {
      const e = byId[c.key];
      expect(e, `${c.name} is in the Key`).toBeTruthy();
      expect(e.trait, `${c.name} trait`).toBeTruthy();
      expect(e.lesson, `${c.name} lesson`).toBeTruthy();
      expect(e.story && e.story.who, `${c.name} story heading`).toBeTruthy();
      expect(e.story.text.length, `${c.name} story`).toBeGreaterThan(120);
    }
    for (const move of Object.keys(DYNAMICS)) expect(byId[move] && byId[move].story, `${move} has a story`).toBeTruthy();
    // 13 card names that are not founders, 30 founders, 5 moves: 48
    expect(items).toHaveLength(Object.keys(BY_KEY).length + Object.keys(DYNAMICS).length);
  });

  it('has no story that belongs to no card, and one line for each founder set', () => {
    expect(Object.keys(STORIES).sort()).toEqual(items.map((i) => i.id).sort());
    expect(Object.keys(SET_TRAITS).sort()).toEqual(['connectors', 'hustlers', 'innovators', 'inventors', 'investors', 'operators']);
  });

  it('never puts words in a real person\'s mouth, and never puts a real story on a card', () => {
    // House rule (stories.js): facts in our own words. A story with quoted
    // speech in it is the easiest way to misquote someone.
    for (const [k, s] of Object.entries(STORIES)) {
      for (const text of [s.story, s.lesson, s.trait]) expect(text, k).not.toMatch(/[“”]|"[^"]+"/);
      expect(s.story, k).not.toMatch(/—/);
    }
    // The rulebook keeps real people off the cards: the card data itself is unchanged.
    for (const c of CARDS) expect(Object.keys(c)).not.toContain('story');
  });

  it('counts the cards face up this quarter from public zones only, never more than are in play', () => {
    const g = GAMES.ventureboom;
    const m = createMatch(g.rules, 4);
    const before = INFO.ventureboom.rolls(m.view(null))[0];
    expect(before.total).toBe(0);
    expect(before.bars.find((b) => b.label === 'BOOM!').of).toBe(3); // one fewer than the players
    expect(before.bars.reduce((a, b) => a + b.of, 0)).toBe(65 + 3);
    const done = playout({ game: g.rules, bot: g.bot, housekeeping: g.housekeeping, numSeats: 4 });
    const G = done.view(null);
    const c = INFO.ventureboom.rolls(G)[0];
    const faceUp = G.discard.length + G.exits.flat().reduce((a, e) => a + e.cards.length, 0);
    expect(c.total).toBe(faceUp);
    for (const b of c.bars) expect(b.value).toBeLessThanOrEqual(b.of);
    // A spectator and a player get the same picture: nothing in it comes from a hand.
    expect(INFO.ventureboom.rolls(done.view(0))).toEqual(INFO.ventureboom.rolls(G));
  });
});

describe('VentureFlow luck', () => {
  it('counts the weather of every finished month and every fortune card drawn', () => {
    const g = GAMES.ventureflow;
    const done = playout({ game: g.rules, bot: g.bot, housekeeping: g.housekeeping, numSeats: 2, setupData: g.testSetup ? g.testSetup(2) : undefined });
    const G = done.view(0);
    const [weather, fortune] = INFO.ventureflow.rolls(G);
    expect(weather.bars.map((b) => b.label)).toHaveLength(WEATHER_ORDER.length);
    expect(weather.total).toBeGreaterThan(0);
    expect(weather.total).toBe(Object.values(G.rolls.weather).reduce((a, b) => a + b, 0));
    expect(weather.note).toMatch(/every finished month/);
    const drawn = G.vf.players.reduce((a, p) => a + (p.fortuneCardHistory || []).length, 0);
    expect(fortune.total).toBe(drawn);
    expect(fortune.bars.map((b) => b.value).reduce((a, b) => a + b, 0)).toBe(drawn);
  });

  it('says so when a table started before the weather was being recorded', () => {
    const g = GAMES.ventureflow;
    const done = playout({ game: g.rules, bot: g.bot, housekeeping: g.housekeeping, numSeats: 2, setupData: g.testSetup ? g.testSetup(2) : undefined });
    const G = JSON.parse(JSON.stringify(done.view(0)));
    delete G.rolls; // a match created before this field existed
    const [weather] = INFO.ventureflow.rolls(G);
    expect(weather.total).toBe(0);
    expect(weather.bars).toHaveLength(WEATHER_ORDER.length);
    expect(weather.note).toMatch(/started before the weather was being recorded/);
  });
});

describe('dice record (kit)', () => {
  it('counts each outcome, survives a match that predates it, and never grows with the game', () => {
    const G = {}; // a match created before any game recorded rolls
    for (const v of [3, 3, 6, 1, 3]) recordRoll(G, 'd6', v);
    expect(G.rolls).toEqual({ d6: { 1: 1, 3: 3, 6: 1 } });
    for (let i = 0; i < 1000; i++) recordRoll(G, 'd6', 1 + (i % 6));
    expect(Object.keys(G.rolls.d6)).toHaveLength(6);
  });

  it('turns the record into a histogram: every face in order, with what a fair die would give', () => {
    const G = {};
    for (const v of [3, 3, 6, 1, 3, 2]) recordRoll(G, 'd6', v);
    const [c] = rollCharts(G);
    expect(c.total).toBe(6);
    expect(c.bars.map((b) => b.label)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(c.bars.map((b) => b.value)).toEqual([1, 1, 3, 0, 0, 1]);
    for (const b of c.bars) expect(b.expected).toBeCloseTo(1, 10);

    const two = {};
    for (const v of [7, 7, 2, 12, 8, 6]) recordRoll(two, '2d6', v);
    const [d] = rollCharts(two);
    expect(d.bars.map((b) => b.label)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(d.bars.reduce((a, b) => a + b.expected, 0)).toBeCloseTo(6, 10);
    expect(d.bars.find((b) => b.label === '7').expected).toBeCloseTo(1, 10); // 6 in 36
    expect(rollCharts({})).toEqual([]);
    expect(rollCharts(null)).toEqual([]);
  });
});

describe('VentureBoom: real people stay off the cards', () => {
  it('only the Key reads the Hall of Fame; the cards, rules, bot and board never do', async () => {
    const fs = await import('node:fs'); const path = await import('node:path');
    const dir = path.resolve('src/games/ventureboom');
    const readers = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.(js|jsx)$/.test(e.name))
      .filter((e) => /hall-of-fame/.test(fs.readFileSync(path.join(dir, e.name), 'utf8'))).map((e) => e.name);
    expect(readers).toEqual(['info.js']);
  });
});
