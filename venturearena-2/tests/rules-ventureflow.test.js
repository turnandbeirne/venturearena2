// VentureFlow on the arena: the server runs the engine. These tests pin the
// things the first online build got wrong or left to a browser: who may send
// which action (failure-table rows 3 and 6), robots and timers run by the
// house (row 7), one authoritative deterministic state (row 8), and the
// telemetry the debrief and the play-style read are built from.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createMatch, playout } from '../src/games/sim.js';
import {
  ventureFlow, housekeeping, normalizeSettings, botLineup, onLeave, telemetry, observations, playStyle,
  allowed, explain, stalledPlayer, hostSeat, playerIdOf, stepDelayMs, engineReadMode, PACE, MISSED_TURNS_STALL,
} from '../src/games/ventureflow/rules.js';
import { bot } from '../src/games/ventureflow/bot.js';
import meta from '../src/games/ventureflow/meta.js';
import * as catalog from '../src/games/ventureflow/settings.js';
import * as cfg from '../src/games/ventureflow/vf/data/gameConfig.js';
import { PLAY_SPEEDS, DEFAULT_PLAY_SPEED_ID } from '../src/games/ventureflow/vf/game/playSpeed.js';

const NOW = 1_800_000_000_000;

/** setupData the way tables.js start() builds it. kinds: 'p' = a person, 'r' = a robot, or a botSpec object. */
function data(kinds, settings = {}, seed = 4242) {
  return {
    arena: true, seed,
    settings: normalizeSettings({ turnTimer: false, ...settings }),
    seats: kinds.map((k, i) => (k === 'p'
      ? { name: `Person ${i + 1}`, avatar: '\u{1F98A}', bot: false, botSpec: null, color: 'gold' }
      : { name: 'Robot', avatar: '\u{1F916}', bot: true, botSpec: typeof k === 'object' ? k : { level: 2 }, color: 'teal' })),
  };
}
const make = (kinds, settings, seed) => createMatch(ventureFlow, kinds.length, data(kinds, settings, seed));
const act = (m, seat, action) => m.move(seat, 'act', action);
const house = (m, action) => m.move(m.house(), 'houseAct', action);
/** Do the house's next chore, whenever it would fall due. */
function chore(m, now = NOW) {
  const c = housekeeping(m.G, { now });
  if (!c) return null;
  if (!m.move(m.house(), c.move, ...c.args)) throw new Error(`house chore ${JSON.stringify(c.args)} was refused`);
  return c;
}
/** Let the house act until a person owes the table something (or the game ends). */
function settle(m, guard = 5000) {
  while (!m.G.over && m.G.turnP === null) { if (!chore(m) || --guard < 0) throw new Error('the house is stuck'); }
}
/** Everyone passes until the given status shows up. People answer their own cards and decline offers. */
function playUntil(m, test, guard = 20000) {
  while (!m.G.over && !test(m.G.vf)) {
    if (--guard < 0) throw new Error('never got there');
    const seat = m.G.turnP === null ? null : Number(m.G.turnP);
    if (seat === null) { chore(m); continue; }
    const vf = m.G.vf;
    if (vf.status === 'monthRecap') expect(act(m, seat, { type: 'ACK_FORTUNE_CARD' })).toBe(true);
    else if (vf.status === 'exitOffer') expect(act(m, seat, { type: 'RESOLVE_EXIT_OFFER', accept: false })).toBe(true);
    else expect(act(m, seat, { type: 'END_TURN' })).toBe(true);
  }
}
const strip = (G) => JSON.parse(JSON.stringify(G));

describe('ventureflow: the catalog and the page text match the game', () => {
  it('every id a host can pick is one the engine knows', () => {
    const ids = (list) => list.map((x) => x.id);
    expect(ids(catalog.SCENARIOS)).toEqual(ids(cfg.SCENARIOS));
    expect(ids(catalog.DIFFICULTIES)).toEqual(ids(cfg.DIFFICULTIES));
    expect(ids(catalog.WEATHER)).toEqual(ids(cfg.WEATHER_SEVERITIES));
    expect(ids(catalog.PERSONALITIES)).toEqual(['random', ...ids(cfg.BOT_PERSONALITIES)]);
    expect(ids(catalog.SKILLS)).toEqual(['random', ...ids(cfg.SKILL_LEVELS)]);
    for (const p of cfg.BOT_PERSONALITIES) {
      const mine = catalog.PERSONALITIES.find((x) => x.id === p.id);
      expect([mine.name, mine.avatar, mine.style]).toEqual([p.name, p.avatar, p.strategyId]);
    }
    expect(catalog.MAX_SEATS).toBe(cfg.MAX_PLAYERS);
  });

  it('the robots keep the pace the game used: the default "Steady" speed', () => {
    const steady = PLAY_SPEEDS.find((s) => s.id === DEFAULT_PLAY_SPEED_ID);
    expect(PACE.aiStepMs).toBe(steady.aiStepMs);
    expect(PACE.turnHandoffMs).toBe(steady.turnHandoffMs);
    expect(stepDelayMs(0)).toBe(950);
    expect(stepDelayMs(1)).toBe(779);
    expect(stepDelayMs(30)).toBe(285); // floored, never an instant burst
  });

  it('the rules page quotes the real numbers', () => {
    const text = JSON.stringify(meta);
    expect(meta.id).toBe('ventureflow');
    expect(meta.seats).toEqual({ min: 2, max: 4, defaultSize: 4 });
    expect(text).toContain(`${cfg.GAME_LENGTH_MONTHS} months`);
    expect(text).toContain(`$${cfg.BUSINESS_COST}`);
    expect(text).toContain(`$${cfg.SKILL_COST}`);
    expect(text).toContain(`$${cfg.BUSINESS_INCOME_MIN} to $${cfg.BUSINESS_INCOME_MAX}`);
    expect(text).toContain(`${cfg.TURN_TIME_SECONDS} seconds a turn, with ${cfg.TURN_EXTENSIONS_PER_PLAYER} extensions`);
    expect(text).toContain(`${cfg.SAME_TURN_SELL_PENALTY * 100}% less`);
    for (const a of cfg.ASSETS) expect(text).toContain(a.name);
    expect(meta.rulesText.length).toBeGreaterThanOrEqual(8);
    expect(meta.reflection).toHaveLength(3);
  });
});

describe('ventureflow: settings', () => {
  it('normalises to the classic preset and keeps the arena fields consistent', () => {
    const s = normalizeSettings({ size: 4, fillBots: true, botLevel: 2 });
    expect(s).toMatchObject({ preset: 'classic', scenarioId: 'classic', difficultyId: 'medium', weatherSeverityId: 'normal', turnTimer: true, bots: [], fillWithRobots: true, fillBots: true, size: 4, botLevel: 2 });
    expect(normalizeSettings(null)).toMatchObject({ preset: 'classic', size: 4, fillBots: true });
    expect(normalizeSettings(normalizeSettings(s))).toEqual(s);
  });

  it('never trusts an id, caps the line-up at 3, and relabels a changed preset as custom', () => {
    const s = normalizeSettings({ preset: 'shark', scenarioId: 'nope', difficultyId: 7, weatherSeverityId: 'severe', turnTimer: 0, size: 9,
      bots: [{ personalityId: 'mrb', skillLevelId: 'shark' }, { personalityId: 'hacker' }, null, { personalityId: 'leeroy' }, { personalityId: 'leeroy' }] });
    expect(s.scenarioId).toBe('classic');
    expect(s.difficultyId).toBe('medium');
    expect(s.weatherSeverityId).toBe('severe');
    expect(s.turnTimer).toBe(false);
    expect(s.size).toBe(4);
    expect(s.bots).toEqual([{ personalityId: 'mrb', skillLevelId: 'shark' }, { personalityId: 'random', skillLevelId: 'random' }, { personalityId: 'random', skillLevelId: 'random' }]);
    expect(s.preset).toBe('custom');
    expect(normalizeSettings({ ...catalog.PRESETS.shark.settings, preset: 'shark' }).preset).toBe('shark');
    expect(normalizeSettings({ ...catalog.PRESETS.casual.settings, preset: 'casual' })).toMatchObject({ preset: 'casual', turnTimer: false, difficultyId: 'easy' });
  });

  it('the table room\'s own "fill with bots" checkbox and ours are one switch', () => {
    const on = normalizeSettings({ fillWithRobots: true, fillBots: true, preset: 'classic' });
    const off = normalizeSettings({ ...on, fillBots: false }); // the generic checkbox only sends fillBots
    expect(off).toMatchObject({ fillBots: false, fillWithRobots: false, preset: 'custom' });
    expect(normalizeSettings({ fillWithRobots: false })).toMatchObject({ fillBots: false, fillWithRobots: false });
    expect(normalizeSettings({ ...off, fillBots: true, fillWithRobots: true })).toMatchObject({ fillBots: true, fillWithRobots: true });
  });

  it('the line-up fills empty chairs in the host\'s order, then surprises, never the same robot twice', () => {
    const s = normalizeSettings({ bots: [{ personalityId: 'mrgrinch', skillLevelId: 'shark' }, { personalityId: 'random', skillLevelId: 'rookie' }] });
    for (let round = 0; round < 40; round++) {
      const l = botLineup(s, 3);
      expect(l).toHaveLength(3);
      expect(l[0]).toEqual({ name: 'MrGrinch', avatar: '\u{1F384}', level: 3, personalityId: 'mrgrinch', skillLevelId: 'shark' });
      expect(l[1].skillLevelId).toBe('rookie');
      expect(l[1].level).toBe(1);
      expect(new Set(l.map((b) => b.personalityId)).size).toBe(3);
      for (const b of l) {
        expect(b.personalityId).not.toBe('random');
        expect(['rookie', 'sharp', 'shark']).toContain(b.skillLevelId);
        expect(cfg.getBotPersonality(b.personalityId).name).toBe(b.name);
      }
    }
    expect(botLineup(s, 1)).toHaveLength(1); // people took the other chairs: robots never block them
    expect(botLineup(s, 0)).toEqual([]);
    const fixed = botLineup(normalizeSettings({}), 3, () => 0); // a supplied RNG makes it repeatable
    expect(fixed.map((b) => b.personalityId)).toEqual(['leeroy', 'bossemby', 'mrb']);
  });
});

describe('ventureflow: setup', () => {
  it('builds the roster in seat order with the host\'s settings', () => {
    const lineup = [{ level: 3, personalityId: 'mrgrinch', skillLevelId: 'shark', name: 'MrGrinch' }, { level: 1, personalityId: 'moneymama', skillLevelId: 'rookie', name: 'MoneyMama' }];
    const m = make(['p', 'p', ...lineup], { difficultyId: 'hard', scenarioId: 'businessSprint', weatherSeverityId: 'rough', turnTimer: true });
    const vf = m.G.vf;
    expect(vf.players.map((p) => [p.id, p.type, p.name])).toEqual([
      ['p1', 'human', 'Person 1'], ['p2', 'human', 'Person 2'], ['ai1', 'ai', 'MrGrinch'], ['ai2', 'ai', 'MoneyMama'],
    ]);
    expect(vf.players[2]).toMatchObject({ personalityId: 'mrgrinch', skillLevelId: 'shark', strategyId: 'hoarder' });
    expect(vf.players[3]).toMatchObject({ personalityId: 'moneymama', skillLevelId: 'rookie' });
    expect(vf.players[0].avatar).toBe('\u{1F98A}');
    expect(vf).toMatchObject({ difficultyId: 'hard', scenarioId: 'businessSprint', weatherSeverityId: 'rough', status: 'playing', month: 1, totalMonths: 24 });
    expect(vf.turnTimer).toEqual({ seconds: 30 });
    expect(vf.players[0].cash).toBe(300);
    expect(vf.mode.type).toBe('online');
    expect(m.G.turnP).toBe('0');
    expect(m.G.house).toBe('4');
    expect(playerIdOf(m.G, 1)).toBe('p2');
    expect(hostSeat(m.G.vf)).toBe(0);
    expect(strip(m.G)).toEqual(JSON.parse(JSON.stringify(strip(m.G)))); // plain JSON all the way down
  });

  it('a seat flagged as a bot with no personality (the workbench) is still a robot the house plays', () => {
    const m = make(['r', 'p', 'r']);
    expect(m.G.vf.players.map((p) => p.type)).toEqual(['ai', 'human', 'ai']);
    expect(m.G.vf.players[0].skillLevelId).toBe('sharp'); // level 2
    expect(m.G.vf.players[0].personalityId).not.toBe(m.G.vf.players[2].personalityId);
    expect(m.G.turnP).toBe(null);
    expect(housekeeping(m.G, { now: NOW })).toMatchObject({ move: 'houseAct', args: [{ type: 'RUN_AI_STEP', playerId: 'ai1' }], afterMs: 950 });
  });

  it('works with no setup data at all (the registry playout)', () => {
    const m = createMatch(ventureFlow, 3, undefined);
    expect(m.G.vf.players.map((p) => p.type)).toEqual(['human', 'human', 'human']);
    expect(m.G.vf.players.map((p) => p.name)).toEqual(['Player 1', 'Player 2', 'Player 3']);
  });
});

describe('ventureflow: an action belongs to one seat', () => {
  // People in seats 0 and 1, a robot in seat 2. Seat 0 has the turn.
  const fresh = () => make(['p', 'p', 'r']);
  const TURN_ONLY = [
    { type: 'BUY_ASSET', assetId: 'piggy', qty: 2 },
    { type: 'START_BUSINESS', name: 'Test Pickle Shop' },
    { type: 'LEARN_SKILL' },
    { type: 'END_TURN' },
  ];

  for (const action of TURN_ONLY) {
    it(`${action.type}: the active seat yes; another seat, a spectator, a robot's seat and the house-as-a-person no`, () => {
      for (const [who, expected] of [[1, false], [2, false], [null, false], ['house', false], [0, true]]) {
        const m = fresh();
        const before = strip(m.G);
        const ok = who === 'house' ? m.move(m.house(), 'act', action) : who === null ? m.move('null', 'act', action) : act(m, who, action);
        expect(ok, `${action.type} by ${who}`).toBe(expected);
        if (!expected) expect(strip(m.G)).toEqual(before);
      }
    });
  }

  it('the player id always comes from the seat, never from the request', () => {
    const m = fresh();
    // Seat 1 tries to spend seat 0's money, on seat 0's turn.
    expect(act(m, 1, { type: 'BUY_ASSET', playerId: 'p1', assetId: 'piggy', qty: 1 })).toBe(false);
    // Seat 0 names seat 1 as the buyer: the purchase is still seat 0's own.
    expect(act(m, 0, { type: 'BUY_ASSET', playerId: 'p2', assetId: 'piggy', qty: 3 })).toBe(true);
    expect(m.G.vf.players[0].holdings.piggy).toBe(3);
    expect(m.G.vf.players[1].holdings.piggy).toBe(0);
    expect(m.G.vf.players[1].cash).toBe(500);
    // Nobody ends another seat's turn.
    expect(act(m, 1, { type: 'END_TURN', playerId: 'p1' })).toBe(false);
    expect(m.G.vf.activePlayerIndex).toBe(0);
  });

  it('SELL_ASSET, UPGRADE_BUSINESS and EXTEND_TURN follow the same rule', () => {
    const m = make(['p', 'p', 'r'], { turnTimer: true });
    expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'piggy', qty: 2 })).toBe(true);
    expect(act(m, 1, { type: 'SELL_ASSET', assetId: 'piggy', qty: 1 })).toBe(false);
    expect(act(m, 0, { type: 'SELL_ASSET', assetId: 'piggy', qty: 1 })).toBe(true);
    expect(act(m, 0, { type: 'START_BUSINESS' })).toBe(true);
    const biz = m.G.vf.players[0].businesses[0];
    expect(act(m, 1, { type: 'UPGRADE_BUSINESS', businessId: biz.id, trackId: 'marketing' })).toBe(false);
    expect(act(m, 0, { type: 'UPGRADE_BUSINESS', businessId: biz.id, trackId: 'marketing' })).toBe(true);
    expect(act(m, 0, { type: 'UPGRADE_BUSINESS', businessId: biz.id, trackId: '__proto__' })).toBe(false);
    // No clock is running until the house starts it.
    expect(act(m, 0, { type: 'EXTEND_TURN' })).toBe(false);
    expect(house(m, { type: 'START_TURN_TIMER', deadlineAt: NOW + 30000, now: NOW })).toBe(true);
    expect(act(m, 1, { type: 'EXTEND_TURN' })).toBe(false);
    // A browser's own idea of "now" cannot buy extra time: the extension counts from the deadline.
    expect(act(m, 0, { type: 'EXTEND_TURN', now: NOW + 9_999_999 })).toBe(true);
    expect(m.G.vf.turnDeadlineAt).toBe(NOW + 60000);
    expect(m.G.vf.players[0].turnExtensionsLeft).toBe(3);
  });

  it('refuses nonsense quantities and unknown assets', () => {
    const m = fresh();
    for (const qty of [0, -1, 1.5, '2', NaN, 1e9]) expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'piggy', qty })).toBe(false);
    expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'moon', qty: 1 })).toBe(false);
    expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'piggy' })).toBe(true); // qty defaults to 1
  });

  it('a purchase the engine rejects changes nothing, and the board can ask why first', () => {
    const m = fresh();
    const before = strip(m.G);
    const tooMany = { type: 'BUY_ASSET', assetId: 'treehouse', qty: 50 };
    expect(explain(m.view(0), 0, tooMany)).toBe('Not enough cash for Tree House.');
    expect(act(m, 0, tooMany)).toBe(false);
    expect(explain(m.view(0), 0, { type: 'SELL_ASSET', assetId: 'piggy', qty: 1 })).toMatch(/don't own/);
    expect(act(m, 0, { type: 'SELL_ASSET', assetId: 'piggy', qty: 1 })).toBe(false);
    expect(strip(m.G)).toEqual(before);
    expect(m.G.vf.lastError ?? null).toBe(null);
    expect(explain(m.view(0), 0, { type: 'BUY_ASSET', assetId: 'piggy', qty: 1 })).toBe(null);
    expect(explain(m.view(0), 0, { type: 'START_BUSINESS', name: 'porn palace' })).toBe('Please pick a different name.');
    expect(act(m, 0, { type: 'START_BUSINESS', name: 'porn palace' })).toBe(false);
  });

  it('chat speaks only as your own seat', () => {
    const m = fresh();
    // Seat 1 chats out of turn, claiming to be seat 0: it is posted as seat 1.
    expect(act(m, 1, { type: 'SEND_CHAT', playerId: 'p1', message: 'hello table', targetPlayerId: 'ai1' })).toBe(true);
    const line = m.G.vf.chat.find((c) => c.category === 'human');
    expect(line).toMatchObject({ speakerId: 'p2', speakerName: 'Person 2', message: 'hello table', targetPlayerId: 'ai1' });
    expect(act(m, 1, { type: 'SEND_CHAT', message: '   ' })).toBe(false);
    expect(act(m, 1, { type: 'SEND_CHAT', message: 'x'.repeat(500) })).toBe(true);
    expect(m.G.vf.chat.filter((c) => c.category === 'human').pop().message).toHaveLength(140);
    expect(m.move('null', 'act', { type: 'SEND_CHAT', message: 'spectator' })).toBe(false);
    expect(m.move(m.house(), 'act', { type: 'SEND_CHAT', message: 'house' })).toBe(false);
  });

  it('a browser can never send the server\'s own actions', () => {
    const m = fresh();
    for (const type of ['START_GAME', 'LOAD_GAME', 'NEW_GAME', 'RUN_AI_STEP', 'RUN_AI_TURN', 'START_TURN_TIMER', 'MARK_STALL', 'CLEAR_ERROR', 'ACK_FORTUNE_CARD', 'FINALIZE_GAME_OVER']) {
      expect(act(m, 0, { type, playerId: 'ai1', deadlineAt: NOW, seat: 0, state: {} }), type).toBe(false);
      expect(act(m, 1, { type, playerId: 'ai1', deadlineAt: NOW, seat: 0, state: {} }), type).toBe(false);
    }
    // ...and no seat can call the house move.
    expect(m.move(0, 'houseAct', { type: 'RUN_AI_STEP' })).toBe(false);
    expect(m.move(1, 'houseAct', { type: 'CONVERT_SEAT_TO_AI', playerId: 'p1', reason: 'host' })).toBe(false);
    expect(m.move(0, 'houseAct', { type: 'END_TURN' })).toBe(false);
  });

  it('allowed() answers the same question the server asks', () => {
    const m = fresh();
    expect(allowed(m.view(0), 0, { type: 'END_TURN' })).toBe(true);
    expect(allowed(m.view(1), 1, { type: 'END_TURN' })).toBe(false);
    expect(allowed(m.view(1), 1, { type: 'SEND_CHAT', message: 'hi' })).toBe(true);
    expect(allowed(m.view(null), null, { type: 'SEND_CHAT', message: 'hi' })).toBe(false);
    expect(allowed(m.view(2), 2, { type: 'END_TURN' })).toBe(false);
  });
});

describe('ventureflow: acknowledgements belong to their owner', () => {
  it('a fortune card is continued by the seat that drew it, and only that seat', () => {
    const m = make(['p', 'p', 'r']);
    playUntil(m, (vf) => vf.status === 'monthRecap' && vf.fortuneRecap[vf.fortuneRecapIndex].playerId === 'p1');
    expect(m.G.turnP).toBe('0');
    const index = m.G.vf.fortuneRecapIndex;
    expect(act(m, 1, { type: 'ACK_FORTUNE_CARD' })).toBe(false); // failure-table row 3
    expect(act(m, 0, { type: 'ACK_FORTUNE_CARD', index: index + 1 })).toBe(false); // a stale double click
    expect(m.G.vf.fortuneRecapIndex).toBe(index);
    expect(act(m, 0, { type: 'ACK_FORTUNE_CARD', index })).toBe(true);
    expect(m.G.vf.fortuneRecap[m.G.vf.fortuneRecapIndex].playerId).toBe('p2');
    expect(m.G.turnP).toBe('1');
    expect(act(m, 0, { type: 'ACK_FORTUNE_CARD' })).toBe(false);
    // The server continues a forgotten card for its owner after 25 seconds.
    expect(housekeeping(m.G, { now: NOW })).toMatchObject({ args: [{ type: 'ACK_FORTUNE_CARD' }], afterMs: 25000 });
    expect(housekeeping(m.G, { now: NOW, table: { lastMoveAt: NOW - 10000 } }).afterMs).toBe(15000);
    expect(act(m, 1, { type: 'ACK_FORTUNE_CARD' })).toBe(true);
    // The robot's card: nobody's to dismiss; the house moves it on after everyone's peek.
    expect(m.G.vf.fortuneRecap[m.G.vf.fortuneRecapIndex].playerId).toBe('ai1');
    expect(m.G.turnP).toBe(null);
    expect(act(m, 0, { type: 'ACK_FORTUNE_CARD' })).toBe(false);
    expect(act(m, 1, { type: 'ACK_FORTUNE_CARD' })).toBe(false);
    expect(housekeeping(m.G, { now: NOW })).toMatchObject({ args: [{ type: 'ACK_FORTUNE_CARD' }], afterMs: 2600 });
    chore(m);
    expect(m.G.vf.status).toBe('playing');
    expect(m.G.vf.month).toBe(2);
    expect(m.G.turnP).toBe('0');
  });

  it('a launch celebration is dismissed by the founder (or by the house after 25 seconds)', () => {
    const m = make(['p', 'p', 'r']);
    expect(act(m, 0, { type: 'START_BUSINESS', name: 'Person 1\'s Pickle Shop' })).toBe(true);
    expect(m.G.vf.pendingLaunch).toMatchObject({ playerId: 'p1', businessName: 'Person 1\'s Pickle Shop' });
    expect(act(m, 1, { type: 'ACK_STARTUP_LAUNCH' })).toBe(false);
    expect(housekeeping(m.G, { now: NOW })).toMatchObject({ args: [{ type: 'ACK_STARTUP_LAUNCH' }], afterMs: 25000 });
    expect(act(m, 0, { type: 'ACK_STARTUP_LAUNCH' })).toBe(true);
    expect(m.G.vf.pendingLaunch).toBe(null);
    expect(act(m, 0, { type: 'ACK_STARTUP_LAUNCH' })).toBe(false);
  });

  it('a buyout offer is decided by its owner; a robot that inherits the seat decides for it', () => {
    // Find a table where an offer lands on a person.
    let m = null;
    for (let seed = 1; seed < 60 && !m; seed++) {
      const t = make(['p', 'p'], {}, seed);
      // Both people start a business so there is something to buy.
      let guard = 4000;
      while (!t.G.over && t.G.vf.status !== 'exitOffer' && t.G.vf.month <= 12 && --guard > 0) {
        if (t.G.turnP === null) { chore(t); continue; }
        const seat = Number(t.G.turnP);
        const vf = t.G.vf;
        if (vf.status === 'monthRecap') { act(t, seat, { type: 'ACK_FORTUNE_CARD' }); continue; }
        if (vf.pendingLaunch && vf.pendingLaunch.playerId === vf.players[seat].id) { act(t, seat, { type: 'ACK_STARTUP_LAUNCH' }); continue; }
        if (vf.players[seat].businesses.length === 0 && act(t, seat, { type: 'START_BUSINESS' })) continue;
        act(t, seat, { type: 'END_TURN' });
      }
      if (t.G.vf.status === 'exitOffer') m = t;
    }
    expect(m, 'an offer landed on a person').toBeTruthy();
    const owner = Number(m.G.turnP);
    const other = 1 - owner;
    expect(m.G.vf.pendingExitOffer.playerId).toBe(playerIdOf(m.G, owner));
    expect(act(m, other, { type: 'RESOLVE_EXIT_OFFER', accept: true })).toBe(false);
    expect(act(m, other, { type: 'RESOLVE_EXIT_OFFER', playerId: playerIdOf(m.G, owner), accept: true })).toBe(false);
    expect(act(m, owner, { type: 'RESOLVE_EXIT_OFFER', accept: 'yes' })).toBe(false);
    expect(house(m, { type: 'RESOLVE_EXIT_OFFER' })).toBe(false); // not the house's to decide while a person owns it
    expect(housekeeping(m.G, { now: NOW })).toBe(null);

    // The owner walks away mid-decision: the table must not wait forever.
    const leave = onLeave(m.G, owner, 'away');
    expect(m.move(m.house(), leave.move, ...leave.args)).toBe(true);
    expect(m.G.vf.players[owner].type).toBe('ai');
    expect(m.G.turnP).toBe(null);
    expect(housekeeping(m.G, { now: NOW })).toMatchObject({ args: [{ type: 'RESOLVE_EXIT_OFFER' }] });
    chore(m);
    expect(m.G.vf.status).toBe('monthRecap');
    expect(m.G.stats[owner].offersAccepted + m.G.stats[owner].offersDeclined).toBe(0); // the robot's choice is not the person's style
  });
});

describe('ventureflow: the house runs robots and timers', () => {
  it('plays a robot\'s whole turn, one paced step at a time, and nobody else can', () => {
    const m = make(['p', { level: 3, personalityId: 'daddybigbux', skillLevelId: 'shark' }]);
    expect(act(m, 0, { type: 'END_TURN' })).toBe(true);
    expect(m.G.vf.activePlayerIndex).toBe(1);
    expect(m.G.turnP).toBe(null);
    expect(act(m, 0, { type: 'END_TURN', playerId: 'ai1' })).toBe(false);
    expect(act(m, 0, { type: 'RUN_AI_STEP', playerId: 'ai1' })).toBe(false);
    expect(house(m, { type: 'END_TURN' })).toBe(false); // not before the robot has finished
    const kinds = [];
    const delays = [];
    while (m.G.vf.status === 'playing' && m.G.vf.activePlayerIndex === 1) {
      const c = chore(m);
      kinds.push(c.args[0].type);
      delays.push(c.afterMs);
    }
    expect(kinds.length).toBeGreaterThan(2);
    expect(kinds.slice(0, -1).every((k) => k === 'RUN_AI_STEP')).toBe(true);
    expect(kinds[kinds.length - 1]).toBe('END_TURN');
    expect(delays[0]).toBe(950);
    expect(delays[1]).toBe(779);
    expect(delays[delays.length - 1]).toBe(800);
    expect(m.G.vf.log.some((e) => e.playerId === 'ai1' && /bought|started|learned/.test(e.message))).toBe(true);
    expect(m.G.vf.status).toBe('monthRecap'); // the month wrapped up
  });

  it('starts the turn clock when a person\'s turn begins and ends the turn when it lapses', () => {
    const m = make(['p', 'p'], { turnTimer: true });
    const start = housekeeping(m.G, { now: NOW });
    expect(start).toMatchObject({ args: [{ type: 'START_TURN_TIMER', deadlineAt: NOW + 30000 }], afterMs: 0 });
    chore(m);
    expect(m.G.vf.turnDeadlineAt).toBe(NOW + 30000);
    expect(m.G.houseAt).toBe(NOW);
    // The house cannot end a person's turn while their clock is still running...
    expect(house(m, { type: 'END_TURN', now: NOW + 29000 })).toBe(false);
    const wait = housekeeping(m.G, { now: NOW + 1000 });
    expect(wait.args[0].type).toBe('END_TURN');
    expect(wait.afterMs).toBe(29100);
    // ...and does when it lapses. Nothing already bought is undone; the turn simply passes.
    expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'piggy', qty: 1 })).toBe(true);
    expect(house(m, { type: 'END_TURN', now: NOW + 30100 })).toBe(true);
    expect(m.G.vf.activePlayerIndex).toBe(1);
    expect(m.G.vf.players[0].holdings.piggy).toBe(1);
    expect(m.G.vf.turnDeadlineAt).toBe(null);
    expect(housekeeping(m.G, { now: NOW + 31000 })).toMatchObject({ args: [{ type: 'START_TURN_TIMER', deadlineAt: NOW + 61000 }] });
    // With the clock off the house never ends a person's turn.
    const off = make(['p', 'p'], { turnTimer: false });
    expect(house(off, { type: 'END_TURN', now: NOW + 999999 })).toBe(false);
    expect(house(off, { type: 'START_TURN_TIMER', deadlineAt: NOW, now: NOW })).toBe(false);
  });

  it('finalises the end-of-game pause after about 20 seconds, or when any seat presses Continue', () => {
    const m = make(['p', 'r']);
    playUntil(m, (vf) => vf.status === 'gameEnding');
    expect(m.G.over).toBe(null);
    expect(m.G.turnP).toBe(null);
    expect(housekeeping(m.G, { now: NOW })).toMatchObject({ args: [{ type: 'FINALIZE_GAME_OVER' }], afterMs: 20000 });
    expect(act(m, 0, { type: 'FINALIZE_GAME_OVER' })).toBe(true);
    expect(m.G.vf.status).toBe('gameover');
    expect(m.G.over).toMatchObject({ reason: 'months' });
    expect(m.G.over.scores).toEqual(m.G.vf.players.map((p) => telemetry(m.G, m.G.vf.players.indexOf(p)).metrics.netWorth));
    expect(m.ctx.gameover ?? m.state.ctx.gameover).toBeTruthy();
  });
});

describe('ventureflow: leaving, stalling, votes', () => {
  it('resign hands the seat to a robot and the game goes on', () => {
    const m = make(['p', 'p', 'r']);
    expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'treehouse', qty: 1 })).toBe(true);
    const cash = m.G.vf.players[0].cash;
    // Nobody resigns for someone else.
    expect(act(m, 1, { type: 'CONVERT_SEAT_TO_AI', playerId: 'p1', reason: 'resigned' })).toBe(false);
    expect(act(m, 0, { type: 'CONVERT_SEAT_TO_AI', playerId: 'p1', reason: 'host' })).toBe(true);
    const p = m.G.vf.players[0];
    expect(p).toMatchObject({ type: 'ai', originalName: 'Person 1', takeoverReason: 'resigned' }); // the reason is the server's, not the request's
    expect(p.cash).toBe(cash);
    expect(p.holdings.treehouse).toBe(1);
    expect(m.G.turnP).toBe(null);
    expect(m.G.log.some((e) => e.t === 'takeover' && e.p === 0 && e.reason === 'resigned')).toBe(true);
    // The seat is closed to its old owner...
    expect(act(m, 0, { type: 'END_TURN' })).toBe(false);
    expect(act(m, 0, { type: 'SEND_CHAT', message: 'still here' })).toBe(false);
    expect(act(m, 0, { type: 'CONVERT_SEAT_TO_AI' })).toBe(false);
    // ...and the house finishes the turn for it, then seat 1 plays on.
    settle(m);
    expect(m.G.vf.activePlayerIndex).toBe(1);
    expect(m.G.turnP).toBe('1');
    expect(hostSeat(m.G.vf)).toBe(1);
    expect(telemetry(m.G, 0).metrics).toMatchObject({ tookOver: true, takeoverReason: 'resigned' });
    expect(telemetry(m.G, 0).metrics.finishedBy).toBeTruthy();
    // The whole game still finishes.
    playUntil(m, () => false);
    expect(m.G.over.placements).toHaveLength(3);
  });

  it('once nobody is playing any seat the house fast-forwards the rest of the game', () => {
    const m = make(['p', 'r']);
    expect(act(m, 0, { type: 'END_TURN' })).toBe(true);
    expect(housekeeping(m.G, { now: NOW }).afterMs).toBe(950); // a person is still at the table: the robot keeps its pace
    settle(m);
    expect(act(m, 0, { type: 'CONVERT_SEAT_TO_AI' })).toBe(true);
    let slowest = 0; let chores = 0;
    while (!m.G.over) { const c = chore(m); slowest = Math.max(slowest, c.afterMs); chores++; }
    expect(slowest).toBeLessThanOrEqual(PACE.fastForwardMs); // cards, turns, even the end-of-game pause
    expect(chores).toBeGreaterThan(100);
    expect(m.G.over.reason).toBe('months');
  });

  it('onLeave (the arena\'s leave button and idle sweep) converts through the house', () => {
    const m = make(['p', 'p']);
    expect(onLeave(m.G, 1, 'resigned')).toEqual({ as: 'house', move: 'houseAct', args: [{ type: 'CONVERT_SEAT_TO_AI', playerId: 'p2', reason: 'resigned' }] });
    const away = onLeave(m.G, 0, 'away');
    expect(m.move(m.house(), away.move, ...away.args)).toBe(true);
    expect(m.G.vf.players[0]).toMatchObject({ type: 'ai', takeoverReason: 'away' });
    expect(onLeave(m.G, 0, 'away')).toBe(null); // already a robot
  });

  it('KICK_VOTE and the host\'s "Replace now" are refused until the house marks that seat as stalled', () => {
    const m = make(['p', 'p', 'p']);
    expect(m.G.turnP).toBe('0');
    expect(stalledPlayer(m.G)).toBe(null);
    expect(act(m, 1, { type: 'KICK_VOTE', playerId: 'p1', voterId: 'p2' })).toBe(false);
    expect(act(m, 1, { type: 'CONVERT_SEAT_TO_AI', playerId: 'p1', reason: 'host' })).toBe(false);
    // 80 seconds after the last move on a live person's turn the house marks the seat.
    const c = housekeeping(m.G, { now: NOW });
    expect(c).toMatchObject({ args: [{ type: 'MARK_STALL', seat: 0 }], afterMs: 80000 });
    expect(housekeeping(m.G, { now: NOW, table: { lastMoveAt: NOW - 50000 } }).afterMs).toBe(30000);
    expect(house(m, { type: 'MARK_STALL', seat: 1 })).toBe(false); // only the seat whose turn it is
    const actN = m.G.actN;
    chore(m);
    expect(m.G.stall).toEqual({ seat: 0 });
    expect(m.G.actN).toBe(actN); // marking is not activity: boards keep counting the silence
    expect(stalledPlayer(m.G)).toBe('p1');
    expect(housekeeping(m.G, { now: NOW })).toBe(null);

    // Votes: only as yourself, never against yourself, only against the stalled seat.
    expect(act(m, 0, { type: 'KICK_VOTE', playerId: 'p1' })).toBe(false);
    expect(act(m, 1, { type: 'KICK_VOTE', playerId: 'p3' })).toBe(false);
    expect(act(m, 1, { type: 'KICK_VOTE', playerId: 'p1', voterId: 'p3' })).toBe(true);
    expect(m.G.vf.kickVotes.p1).toEqual(['p2']); // cast as seat 1, whatever the request said
    expect(act(m, 1, { type: 'KICK_VOTE', playerId: 'p1' })).toBe(true); // voting twice counts once
    expect(m.G.vf.kickVotes.p1).toEqual(['p2']);
    expect(m.G.vf.players[0].type).toBe('human');

    // Any action from the stalled seat is the cure: mark and votes are gone.
    expect(act(m, 0, { type: 'SEND_CHAT', message: 'sorry, back' })).toBe(true);
    expect(m.G.stall).toBe(null);
    expect(m.G.vf.kickVotes.p1).toBeUndefined();
    expect(act(m, 2, { type: 'KICK_VOTE', playerId: 'p1' })).toBe(false);

    // Stalled again: a unanimous vote of the other live people converts the seat.
    chore(m);
    expect(act(m, 1, { type: 'KICK_VOTE', playerId: 'p1' })).toBe(true);
    expect(act(m, 2, { type: 'KICK_VOTE', playerId: 'p1' })).toBe(true);
    expect(m.G.vf.players[0]).toMatchObject({ type: 'ai', takeoverReason: 'vote' });
    expect(m.G.stall).toBe(null);
    expect(m.G.turnP).toBe(null);
  });

  it('the host may replace a stalled seat; a non-host may not; the host is the lowest live seat', () => {
    const m = make(['p', 'p', 'p']);
    expect(act(m, 0, { type: 'END_TURN' })).toBe(true);
    chore(m); // seat 1 is now marked as stalled
    expect(m.G.stall).toEqual({ seat: 1 });
    expect(act(m, 2, { type: 'CONVERT_SEAT_TO_AI', playerId: 'p2' })).toBe(false);
    expect(act(m, 0, { type: 'CONVERT_SEAT_TO_AI', playerId: 'p3' })).toBe(false); // not the stalled seat
    expect(act(m, 0, { type: 'CONVERT_SEAT_TO_AI', playerId: 'p2', reason: 'resigned' })).toBe(true);
    expect(m.G.vf.players[1]).toMatchObject({ type: 'ai', takeoverReason: 'host' });
    // With one person left there is nobody to vote, so the house does not mark the seat.
    const solo = make(['p', 'r']);
    expect(housekeeping(solo.G, { now: NOW })).toBe(null);
  });

  it('on a clocked table two turns lost to the clock with no action at all count as a stall', () => {
    const m = make(['p', 'p'], { turnTimer: true });
    let now = NOW;
    const loseTurn = () => {
      chore(m, now);                       // START_TURN_TIMER
      now += 30200;
      const c = housekeeping(m.G, { now });
      expect(c.args[0].type).toBe('END_TURN');
      chore(m, now);
    };
    const pass = (seat) => { chore(m, now); expect(act(m, seat, { type: 'END_TURN' })).toBe(true); };
    // Seat 0 is away, so its cards are continued by the house; seat 1 continues its own.
    const recap = () => { while (m.G.vf.status === 'monthRecap') { if (m.G.turnP === '1') act(m, 1, { type: 'ACK_FORTUNE_CARD' }); else chore(m, now); } };
    for (let i = 0; i < MISSED_TURNS_STALL; i++) { loseTurn(); pass(1); recap(); }
    expect(m.G.missed[0]).toBe(MISSED_TURNS_STALL);
    chore(m, now); // the third turn: the clock starts...
    const c = housekeeping(m.G, { now });
    expect(c).toMatchObject({ args: [{ type: 'MARK_STALL', seat: 0 }], afterMs: 0 }); // ...and the table may act at once
    chore(m, now);
    expect(stalledPlayer(m.G)).toBe('p1');
    // Showing up clears it and resets the count.
    expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'piggy', qty: 1 })).toBe(true);
    expect(m.G.stall).toBe(null);
    expect(m.G.missed[0]).toBe(0);
    expect(housekeeping(m.G, { now }).args[0].type).toBe('END_TURN');
  });
});

describe('ventureflow: one authoritative, deterministic state', () => {
  /** Record every move of a full bot game, then replay the recording on a second match. */
  function record(kinds, seed) {
    const moves = [];
    const m = playout({ game: ventureFlow, bot, housekeeping, numSeats: kinds.length, setupData: data(kinds, {}, seed), onStep: (_m, step) => moves.push(step) });
    return { m, moves };
  }

  it('the same seed and the same moves end in an identical game', () => {
    const kinds = ['p', 'r', 'p', 'r'];
    const a = record(kinds, 777);
    const b = createMatch(ventureFlow, kinds.length, data(kinds, {}, 777));
    // Run some other table in between: the engine's RNG is module state shared
    // by every table in the process and must not leak from one to the next.
    let noise = 0;
    for (const step of a.moves) {
      if (noise++ % 25 === 0) { const other = make(['r', 'r'], {}, noise); for (let i = 0; i < 30; i++) chore(other); }
      expect(b.move(step.seat === 'house' ? b.house() : step.seat, step.move, ...step.args)).toBe(true);
    }
    expect(b.G.over).toEqual(a.m.G.over);
    expect(strip(b.G.vf)).toEqual(strip(a.m.G.vf));
    expect(b.G.secret).toEqual(a.m.G.secret);
    // Ids come from counters in the state, not from the wall clock.
    expect(a.m.G.vf.log.every((e) => /^log-\d+$/.test(e.id))).toBe(true);
    expect(a.m.G.vf.chat.every((e) => /^chat-\d+$/.test(e.id))).toBe(true);
    expect(new Set(a.m.G.vf.log.map((e) => e.id)).size).toBe(a.m.G.vf.log.length);
  });

  it('the engine is handed the frozen stored state, not a copy, and never writes to it', () => {
    const m = make(['p', 'r']);
    expect(act(m, 0, { type: 'END_TURN' })).toBe(true);
    // 'immer' or 'immer-cjs': Immer's current() on the draft (see draft.js). 'copy' would mean
    // the slow JSON fallback, and that the playouts above never ran against frozen data.
    expect(['immer', 'immer-cjs']).toContain(engineReadMode());
    expect(Object.isFrozen(m.G.vf)).toBe(true);
    expect(Object.isFrozen(m.G.vf.players[0].holdings)).toBe(true);
  });

  it('the server bundle (one copy of Immer, as deployed) plays the identical game', async () => {
    // The server runs an esbuild CommonJS bundle; the tests run ES modules. Build
    // the rules the server's way and replay a recorded game through that build.
    const dir = path.resolve('node_modules/.cache/ventureflow-test');
    fs.mkdirSync(dir, { recursive: true });
    const outfile = path.join(dir, 'server-rules.cjs');
    await build({
      stdin: { contents: "export * as sim from './src/games/sim.js'; export * as rules from './src/games/ventureflow/rules.js';", resolveDir: process.cwd(), loader: 'js' },
      outfile, bundle: true, platform: 'node', target: 'node20', format: 'cjs', packages: 'external', logLevel: 'silent',
    });
    const prod = createRequire(import.meta.url)(outfile);
    const kinds = ['p', 'r', 'r'];
    const a = record(kinds, 4711);
    const b = prod.sim.createMatch(prod.rules.ventureFlow, kinds.length, data(kinds, {}, 4711));
    for (const step of a.moves) expect(b.move(step.seat === 'house' ? b.house() : step.seat, step.move, ...step.args)).toBe(true);
    expect(prod.rules.engineReadMode()).toBe('immer');
    expect(b.G.over).toEqual(a.m.G.over);
    expect(strip(b.G.vf)).toEqual(strip(a.m.G.vf));
    expect(b.G.secret).toEqual(a.m.G.secret);
    expect(prod.rules.telemetry(b.G, 0)).toEqual(telemetry(a.m.G, 0));
  });

  it('a different seed gives a different game', () => {
    const a = make(['r', 'r'], {}, 1);
    const b = make(['r', 'r'], {}, 2);
    for (let i = 0; i < 200; i++) { chore(a); chore(b); }
    expect(strip(a.G.vf)).not.toEqual(strip(b.G.vf));
  });

  it('no browser receives the RNG', () => {
    const m = make(['p', 'r']);
    expect(m.G.secret.rng).toMatchObject({ def: expect.any(Number), env: expect.any(Number) });
    for (const seat of [0, 1, null]) {
      const view = m.view(seat);
      expect(view.secret).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain('"rng"');
      expect(view.vf.players).toHaveLength(2); // the public game is all there
    }
  });
});

describe('ventureflow: full playouts', () => {
  const TABLES = [
    ['p', 'r'], ['p', 'p'],
    ['p', 'r', 'r'], ['p', 'p', 'r'], ['p', 'p', 'p'],
    ['p', 'r', 'r', 'r'], ['p', 'p', 'r', 'r'], ['p', 'p', 'p', 'r'], ['p', 'p', 'p', 'p'],
  ];
  for (const kinds of TABLES) {
    it(`${kinds.length} seats (${kinds.filter((k) => k === 'p').length} people, ${kinds.filter((k) => k === 'r').length} robots) runs the full 24 months`, () => {
      const m = playout({ game: ventureFlow, bot, housekeeping, numSeats: kinds.length, setupData: data(kinds, {}, 1000 + kinds.length * 7 + kinds.filter((k) => k === 'p').length) });
      const over = m.G.over;
      expect(over).toBeTruthy();
      expect(over.reason).toBe('months');
      expect(m.G.vf.month).toBe(24);
      expect(m.G.vf.status).toBe('gameover');
      expect(over.placements).toHaveLength(kinds.length);
      expect(Math.min(...over.placements)).toBe(1);
      for (const p of over.placements) { expect(p).toBeGreaterThanOrEqual(1); expect(p).toBeLessThanOrEqual(kinds.length); }
      expect(over.scores).toHaveLength(kinds.length);
      for (const s of over.scores) expect(Number.isInteger(s)).toBe(true);
      const best = over.scores.indexOf(Math.max(...over.scores));
      expect(over.placements[best]).toBe(1);
      expect(m.G.vf.winnerId).toBe(m.G.vf.players[best].id);
      // The arena's own log: capped, counted, ends with the result.
      expect(m.G.logN).toBeGreaterThan(0);
      expect(m.G.log.length).toBeLessThanOrEqual(80);
      expect(m.G.log[m.G.log.length - 1].t).toBe('over');
      expect(m.G.moveN).toBeLessThan(6000);

      const seat = kinds.indexOf('p');
      const t = telemetry(m.G, seat);
      expect(Object.keys(t.metrics).sort()).toEqual(['badCards', 'badges', 'businesses', 'cash', 'difficultyId', 'finishedBy', 'goalMonth', 'goodCards', 'holdings', 'months', 'netWorth', 'passive', 'scenarioId', 'score', 'spent', 'takeoverReason', 'tookOver', 'units', 'weatherSeverityId'].sort());
      expect(t.metrics).toMatchObject({ tookOver: false, takeoverReason: null, finishedBy: null, scenarioId: 'classic', difficultyId: 'medium', weatherSeverityId: 'normal', months: 24 });
      expect(t.metrics.score).toBe(t.metrics.netWorth);
      expect(t.metrics.netWorth).toBe(over.scores[seat]);
      expect(t.metrics.goodCards + t.metrics.badCards).toBeGreaterThanOrEqual(24);
      expect(t.metrics.units).toBe(Object.values(t.metrics.holdings).reduce((a, b) => a + b, 0));
      expect(t.metrics.spent).toBeGreaterThan(0);
      expect(t.skillTags).toContain('cash flow');
      for (const k of ['risk', 'horizon', 'negotiation', 'cooperation']) { expect(t.signals[k]).toBeGreaterThanOrEqual(0); expect(t.signals[k]).toBeLessThanOrEqual(100); expect(Number.isInteger(t.signals[k])).toBe(true); }
      expect(t.midRank).toBeGreaterThanOrEqual(1);
      expect(t.midRank).toBeLessThanOrEqual(kinds.length);
      for (let s = 0; s < kinds.length; s++) expect(() => telemetry(m.G, s)).not.toThrow();
      expect(Array.isArray(observations(t.metrics, over.placements[seat], kinds.length))).toBe(true);
      // The finished state is still plain JSON, the way it is stored and sent.
      expect(JSON.parse(JSON.stringify(m.G)).vf.players).toHaveLength(kinds.length);
    });
  }

  it('plays to the end with no setup data, the way the registry playout calls it', () => {
    for (const n of [2, 3, 4]) {
      const m = playout({ game: ventureFlow, bot, housekeeping, numSeats: n });
      expect(m.G.over.placements).toHaveLength(n);
      expect(m.G.vf.month).toBe(24);
    }
  });

  it('plays every scenario, difficulty and weather a host can pick', () => {
    for (const scenarioId of catalog.SCENARIOS.map((s) => s.id)) {
      const settings = { scenarioId, difficultyId: scenarioId === 'survivalCrash' ? 'hard' : 'easy', weatherSeverityId: scenarioId === 'classic' ? 'severe' : 'gentle', turnTimer: true };
      const m = playout({ game: ventureFlow, bot, housekeeping, numSeats: 3, setupData: data(['p', 'r', 'r'], settings, 99) });
      expect(m.G.over.placements).toHaveLength(3);
      expect(telemetry(m.G, 0).metrics.scenarioId).toBe(scenarioId);
    }
  });
});

describe('ventureflow: style signals and the debrief', () => {
  it('accumulates spend, volatility, long-horizon spend and offers per seat as actions are applied', () => {
    const m = make(['p', 'p'], { difficultyId: 'easy' });
    const price = m.G.vf.assetPrices.treasure;
    expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'treasure', qty: 2 })).toBe(true);
    expect(m.G.stats[0]).toMatchObject({ spend: price * 2, longSpend: 0 });
    expect(m.G.stats[0].weightedVol).toBeCloseTo(price * 2 * 0.4);
    expect(telemetry(m.G, 0).signals).toMatchObject({ risk: 100, horizon: 0, negotiation: 50, cooperation: 35 });
    expect(act(m, 0, { type: 'START_BUSINESS' })).toBe(true);
    expect(act(m, 0, { type: 'LEARN_SKILL' })).toBe(true);
    const s = m.G.stats[0];
    expect(s.spend).toBe(price * 2 + 400);
    expect(s.longSpend).toBe(400);
    expect(s.weightedVol).toBeCloseTo(price * 2 * 0.4 + 300 * 0.3 + 100 * 0.12);
    const sig = telemetry(m.G, 0).signals;
    expect(sig.horizon).toBe(Math.round((400 / s.spend) * 100));
    expect(sig.risk).toBe(Math.round((s.weightedVol / s.spend / 0.4) * 100));
    // A refused action is not counted; selling is ignored; someone who spent nothing gets the defaults.
    expect(act(m, 0, { type: 'BUY_ASSET', assetId: 'treehouse', qty: 99 })).toBe(false);
    expect(act(m, 0, { type: 'SELL_ASSET', assetId: 'treasure', qty: 1 })).toBe(true);
    expect(m.G.stats[0].spend).toBe(s.spend);
    expect(telemetry(m.G, 1).signals).toMatchObject({ risk: 35, horizon: 40, negotiation: 50 });
    expect(act(m, 1, { type: 'SEND_CHAT', message: 'nice' })).toBe(true);
    expect(telemetry(m.G, 1).signals.cooperation).toBe(43);
    // Offers: declined minus accepted, over the offers made.
    const G = { ...strip(m.G), stats: [{ ...m.G.stats[0], offersDeclined: 2, offersAccepted: 0 }, { ...m.G.stats[1], offersDeclined: 1, offersAccepted: 3 }] };
    expect(telemetry(G, 0).signals.negotiation).toBe(75);
    expect(telemetry(G, 1).signals.negotiation).toBe(38);
  });

  it('skill tags and mid-game rank follow the old report', () => {
    const m = playout({ game: ventureFlow, bot, housekeeping, numSeats: 2, setupData: data(['p', 'p'], {}, 5) });
    for (const seat of [0, 1]) {
      const p = m.G.vf.players[seat];
      const t = telemetry(m.G, seat);
      expect(t.skillTags.includes('business building')).toBe(p.businesses.length > 0);
      expect(t.skillTags.includes('diversification')).toBe(Object.values(p.holdings).filter((n) => n > 0).length >= 3);
      const at12 = (x) => x.netWorthHistory.find((e) => e.month === 12).netWorth;
      expect(t.midRank).toBe(at12(m.G.vf.players[1 - seat]) > at12(p) ? 2 : 1);
    }
    // No month-12 entry yet: no mid-game rank, so the arena leaves resilience alone.
    expect(telemetry(make(['p', 'p']).G, 0).midRank).toBeUndefined();
  });

  it('observations: the debrief lines, without the win and takeover lines the arena adds itself', () => {
    expect(observations({ businesses: 3, passive: 412.4, units: 31, goodCards: 9, badCards: 15, goalMonth: 11, tookOver: true, finishedBy: 'MrB' }, 1, 4)).toEqual([
      'Builder: started 3 businesses',
      'Cashflow engine: $412/month passive at the end',
      'Accumulator: 31 units held across assets',
      'Resilient: won despite more bad fortune cards than good',
      'Fortune: 9 good · 15 bad',
      'Hit the scenario goal in month 11',
    ]);
    expect(observations({ businesses: 1, passive: 20, units: 2, goodCards: 3, badCards: 5 }, 2, 4)).toEqual(['Started a business', 'Fortune: 3 good · 5 bad']);
    expect(observations({ businesses: 0, passive: 1500 }, 1, 2)).toEqual(['Cashflow engine: $1,500/month passive at the end']);
    expect(observations({}, 1, 2)).toEqual([]);
    expect(observations(undefined, 1, 2)).toEqual([]);
  });

  it('playStyle: the four reads, from the average of every game', () => {
    expect(playStyle([])).toBe(null);
    expect(playStyle(undefined)).toBe(null);
    expect(playStyle([{ businesses: 3, passive: 500, units: 50 }, { businesses: 1, passive: 0, units: 0 }])).toBe('Builder: starts businesses early and often');
    expect(playStyle([{ businesses: 1, passive: 200, units: 50 }])).toBe('Cashflow-minded: stacks passive income');
    expect(playStyle([{ businesses: 0, passive: 20, units: 40 }, { businesses: 1, passive: 30, units: 20 }])).toBe('Accumulator: buys in volume and rides the market');
    expect(playStyle([{ businesses: 1, passive: 20, units: 4 }])).toBe('Balanced: mixes cash, assets and businesses');
  });
});
