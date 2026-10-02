// HOUSE-RULES.md section 2, enforced: every game in the registry is registered
// in EVERY place it has to be. Add a game to GAMES and this file tells you
// what is still missing. It knows nothing about any particular game.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { GAMES, GAME_ORDER, getGame, listMeta } from '../src/games/registry.js';
import { BOARDS } from '../src/games/boards.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gamesDir = path.join(root, 'src', 'games');
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const ids = Object.keys(GAMES);

describe('the registry as a whole', () => {
  it('has at least one game', () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it('game names are unique', () => {
    const names = ids.map((id) => GAMES[id].meta && GAMES[id].meta.name);
    expect(new Set(names).size, `duplicate name in ${JSON.stringify(names)}`).toBe(names.length);
    const lower = names.map((n) => String(n).trim().toLowerCase());
    expect(new Set(lower).size, 'two names differ only by case or spacing').toBe(lower.length);
  });

  it('no two games share a boardgame.io name (it is the socket namespace)', () => {
    const names = ids.map((id) => GAMES[id].rules && GAMES[id].rules.name);
    expect(new Set(names).size, `duplicate boardgame.io name in ${JSON.stringify(names)}`).toBe(names.length);
  });

  it('GAME_ORDER lists every registered game exactly once and nothing else', () => {
    expect(new Set(GAME_ORDER).size, 'an id appears twice in GAME_ORDER').toBe(GAME_ORDER.length);
    for (const id of GAME_ORDER) expect(ids, `GAME_ORDER has "${id}", which is not in GAMES`).toContain(id);
    for (const id of ids) expect(GAME_ORDER, `"${id}" is in GAMES but not in GAME_ORDER: it would be hidden from the lobby`).toContain(id);
    expect(listMeta().map((m) => m.id)).toEqual(GAME_ORDER);
  });

  it('getGame finds registered games only', () => {
    for (const id of ids) expect(getGame(id)).toBe(GAMES[id]);
    for (const id of ['nope', '', '__proto__', 'constructor', 'toString', undefined, null]) expect(getGame(id)).toBe(null);
  });
});

for (const id of ids) {
  describe(`registration: ${id}`, () => {
    const g = GAMES[id];
    const meta = g.meta || {};
    const dir = path.join(gamesDir, id);

    it('step 1: rules built with defineGame, a bot, metadata', () => {
      expect(g.rules, 'rules').toBeTruthy();
      expect(text(g.rules.name), 'rules.name (the boardgame.io game name)').toBe(true);
      expect(g.rules.name, 'the boardgame.io name is a socket namespace: letters, digits, - and _ only').toMatch(/^[A-Za-z0-9_-]+$/);
      expect(g.rules.arena, 'rules.arena: build the game with defineGame() from kit.js').toBeTruthy();
      expect(typeof g.rules.arena.house).toBe('boolean');
      expect(typeof g.rules.setup, 'rules.setup').toBe('function');
      expect(Object.keys(g.rules.moves || {}).length, 'rules.moves').toBeGreaterThan(0);
      for (const [name, mv] of Object.entries(g.rules.moves)) expect(mv && mv.client, `move "${name}" must be client: false (defineGame does this)`).toBe(false);
      expect(typeof g.bot, 'bot').toBe('function');
      expect(g.meta, 'meta').toBeTruthy();
      for (const key of ['telemetry', 'housekeeping', 'normalizeSettings', 'onLeave', 'observations', 'playStyle', 'botLineup', 'testSetup']) {
        if (g[key] !== undefined) expect(typeof g[key], `${key}, when present, is a function`).toBe('function');
      }
      if (g.rules.arena.house) expect(typeof g.housekeeping, 'a game with a house seat needs housekeeping()').toBe('function');
    });

    it('meta: every required field is filled in', () => {
      expect(meta.id, 'meta.id must equal the registry key').toBe(id);
      expect(text(meta.name), 'meta.name').toBe(true);
      expect(['classic', 'venturemaker'], 'meta.family').toContain(meta.family);
      expect(text(meta.icon), 'meta.icon').toBe(true);
      expect(text(meta.tagline), 'meta.tagline').toBe(true);
      expect(Array.isArray(meta.skills) && meta.skills.length > 0 && meta.skills.every(text), 'meta.skills: a non-empty list of words').toBe(true);
      expect(meta.seats, 'meta.seats').toBeTruthy();
      expect(Number.isInteger(meta.seats.min) && meta.seats.min >= 1, 'meta.seats.min').toBe(true);
      expect(Number.isInteger(meta.seats.max) && meta.seats.max >= meta.seats.min, 'meta.seats.min <= meta.seats.max').toBe(true);
      expect(meta.seats.max, 'a table holds 7 people at most').toBeLessThanOrEqual(7);
      if (meta.seats.defaultSize !== undefined) {
        expect(meta.seats.defaultSize >= meta.seats.min && meta.seats.defaultSize <= meta.seats.max, 'meta.seats.defaultSize within min..max').toBe(true);
      }
      expect(text(String(meta.minutes ?? '')), 'meta.minutes').toBe(true);
      expect(Array.isArray(meta.howTo) && meta.howTo.length >= 3 && meta.howTo.every(text), 'meta.howTo: at least 3 steps').toBe(true);
      expect(text(meta.watchFor), 'meta.watchFor').toBe(true);
      expect(text(meta.lesson), 'meta.lesson').toBe(true);
      expect(Array.isArray(meta.reflection) && meta.reflection.length >= 2 && meta.reflection.every(text), 'meta.reflection: at least 2 questions').toBe(true);
      expect(meta.seo, 'meta.seo').toBeTruthy();
      expect(text(meta.seo.title), 'meta.seo.title').toBe(true);
      expect(text(meta.seo.description), 'meta.seo.description').toBe(true);
      expect(text(meta.seo.intro), 'meta.seo.intro').toBe(true);
    });

    it('the seats the lobby offers are seats the rules can play', () => {
      expect(meta.seats.min, 'meta.seats.min is below defineGame minPlayers').toBeGreaterThanOrEqual(g.rules.arena.seatsMin);
      expect(meta.seats.max, 'meta.seats.max is above defineGame maxPlayers').toBeLessThanOrEqual(g.rules.arena.seatsMax);
    });

    it('step 2: listed in GAME_ORDER', () => {
      expect(GAME_ORDER).toContain(id);
    });

    it('step 3: a lazy board loader in boards.js', () => {
      expect(Object.prototype.hasOwnProperty.call(BOARDS, id), `boards.js needs  ${id}: () => import('./${id}/client.js')`).toBe(true);
      expect(typeof BOARDS[id]).toBe('function'); // not called: it would load React
      const src = fs.readFileSync(path.join(gamesDir, 'boards.js'), 'utf8');
      expect(src, 'the loader must import this game\'s own client.js').toContain(`./${id}/client.js`);
    });

    it('the folder has rules.js, bot.js, meta.js, Board.jsx and client.js', () => {
      for (const file of ['rules.js', 'bot.js', 'meta.js', 'Board.jsx', 'client.js']) {
        expect(fs.existsSync(path.join(dir, file)), `src/games/${id}/${file}`).toBe(true);
      }
      const client = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');
      expect(client, 'client.js exports Board').toMatch(/\bBoard\b/);
      expect(client, 'client.js exports rules').toMatch(/\brules\b/);
    });

    it('step 7: its own rules test exists', () => {
      expect(fs.existsSync(path.join(root, 'tests', `rules-${id}.test.js`)), `tests/rules-${id}.test.js`).toBe(true);
    });
  });
}
