// VentureFlow table settings: the catalog a host picks from, the presets, the
// normaliser the server runs on every save, and the robot line-up.
// Ported from the first arena's src/lib/vfSettings.ts and the
// vf_normalize_settings SQL function. Text and plain data only: rules.js, the
// settings form and the tests all import this one file, so the ids a host can
// pick and the ids the server accepts cannot drift apart.
//
// The ids mirror the game's own data/gameConfig.js (tests/rules-ventureflow
// asserts they still match).

export const SCENARIOS = [
  { id: 'classic', icon: '\u{1F3C6}', name: 'Classic Growth', tagline: 'Highest net worth after 24 months wins.' },
  { id: 'passiveIncomeRace', icon: '\u{1F3C1}', name: 'Passive Income Race', tagline: 'First to the monthly passive-income goal.' },
  { id: 'survivalCrash', icon: '⛈️', name: 'Survive the Crash', tagline: 'Start mid-storm. Recover if you can.' },
  { id: 'businessSprint', icon: '\u{1F680}', name: 'Business Sprint', tagline: 'Three businesses running by month 12.' },
];
export const DIFFICULTIES = [
  { id: 'easy', icon: '\u{1F308}', name: 'KidStuff', tagline: '$800 to start, $220 a month. Stress-free.' },
  { id: 'medium', icon: '⚖️', name: 'Middle of the Pack', tagline: '$500 to start, $150 a month. The classic.' },
  { id: 'hard', icon: '\u{1F94A}', name: 'Hard Knocks', tagline: '$300 to start, $90 a month. Every choice counts.' },
];
export const WEATHER = [
  { id: 'gentle', icon: '\u{1F324}️', name: 'Gentle', tagline: 'The economy nudges.' },
  { id: 'normal', icon: '\u{1F326}️', name: 'Normal', tagline: 'Booms and busts you can ride out.' },
  { id: 'rough', icon: '\u{1F327}️', name: 'Rough', tagline: 'Storms really bite.' },
  { id: 'severe', icon: '⛈️', name: 'Severe', tagline: 'Brutal swings. Diversify or get wiped out.' },
];
/** Robot personalities, in the engine's own order. 'random' is "Surprise me". */
export const PERSONALITIES = [
  { id: 'random', avatar: '\u{1F3B2}', name: 'Surprise me', style: 'random' },
  { id: 'leeroy', avatar: '\u{1F414}', name: 'Leeroy Jenkins', style: 'reckless' },
  { id: 'bossemby', avatar: '\u{1F576}️', name: 'BossEmby', style: 'flipper' },
  { id: 'mrb', avatar: '\u{1F3A9}', name: 'MrB', style: 'balanced' },
  { id: 'mrgrinch', avatar: '\u{1F384}', name: 'MrGrinch', style: 'hoarder' },
  { id: 'daddybigbux', avatar: '\u{1F4BC}', name: 'DaddyBigBux', style: 'tycoon' },
  { id: 'moneymama', avatar: '\u{1F45B}', name: 'MoneyMama', style: 'saver' },
  { id: 'grumpymommy', avatar: '\u{1F624}', name: 'GrumpyMommy', style: 'contrarian' },
];
export const SKILLS = [
  { id: 'random', icon: '\u{1F3B2}', name: 'Any' },
  { id: 'rookie', icon: '\u{1F423}', name: 'Rookie' },
  { id: 'sharp', icon: '\u{1F9E0}', name: 'Sharp' },
  { id: 'shark', icon: '\u{1F988}', name: 'Shark' },
];

/** Seats in the game, and so the most robots a line-up can hold. */
export const MAX_SEATS = 4;
export const MIN_SEATS = 2;
export const MAX_LINEUP = MAX_SEATS - 1;

/** The arena's generic bot level (1-3) for each engine skill, and back. */
export const SKILL_LEVEL = { rookie: 1, sharp: 2, shark: 3 };
export const LEVEL_SKILL = { 1: 'rookie', 2: 'sharp', 3: 'shark' };

export const DEFAULT_SETTINGS = {
  preset: 'classic', scenarioId: 'classic', difficultyId: 'medium', weatherSeverityId: 'normal',
  turnTimer: true, bots: [], fillWithRobots: true,
};

const rookie = () => ({ personalityId: 'random', skillLevelId: 'rookie' });
export const PRESETS = {
  casual: {
    name: 'Casual', blurb: 'Roomy budget, gentle weather, rookie robots, no clock.',
    settings: { scenarioId: 'classic', difficultyId: 'easy', weatherSeverityId: 'gentle', turnTimer: false, fillWithRobots: true, bots: [rookie(), rookie(), rookie()] },
  },
  classic: {
    name: 'Classic', blurb: 'The standard VentureFlow challenge. Robots fill empty chairs.',
    settings: { scenarioId: 'classic', difficultyId: 'medium', weatherSeverityId: 'normal', turnTimer: true, fillWithRobots: true, bots: [] },
  },
  shark: {
    name: 'Shark tank', blurb: 'Tight budget, rough weather, shark robots, 30-second turns.',
    settings: {
      scenarioId: 'classic', difficultyId: 'hard', weatherSeverityId: 'rough', turnTimer: true, fillWithRobots: true,
      bots: [{ personalityId: 'mrgrinch', skillLevelId: 'shark' }, { personalityId: 'daddybigbux', skillLevelId: 'shark' }, { personalityId: 'bossemby', skillLevelId: 'shark' }],
    },
  },
};
export const PRESET_IDS = Object.keys(PRESETS);

const has = (list, id) => typeof id === 'string' && list.some((x) => x.id === id);
const pick = (list, id, fallback) => (has(list, id) ? id : fallback);

function cleanBots(bots) {
  if (!Array.isArray(bots)) return [];
  return bots.slice(0, MAX_LINEUP).map((b) => ({
    personalityId: pick(PERSONALITIES, b && b.personalityId, 'random'),
    skillLevelId: pick(SKILLS, b && b.skillLevelId, 'random'),
  }));
}

const GAME_KEYS = ['scenarioId', 'difficultyId', 'weatherSeverityId', 'turnTimer', 'fillWithRobots'];
/** True when `s` plays exactly like the named preset. */
export function matchesPreset(s, presetId) {
  const p = PRESETS[presetId];
  if (!p) return false;
  return GAME_KEYS.every((k) => s[k] === p.settings[k]) && JSON.stringify(s.bots) === JSON.stringify(p.settings.bots);
}

/**
 * Whatever a browser sent, return settings the game can start from. Never
 * throws: an unknown id falls back to the default rather than failing a save.
 *
 * The arena's own generic fields ride along (it reads them when the table
 * starts) and are kept consistent with ours:
 *   fillBots  mirrors fillWithRobots. The table room's own "fill empty seats"
 *             checkbox only sends fillBots, so when the two disagree fillBots
 *             is the one that was just changed and it wins.
 *   size      how many chairs the game is dealt for (2-4, default 4).
 *   botLevel  kept as handed; robots here get their skill from the line-up.
 */
export function normalizeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const fill = typeof src.fillBots === 'boolean' ? src.fillBots : src.fillWithRobots !== false;
  const out = {
    ...src,
    scenarioId: pick(SCENARIOS, src.scenarioId, DEFAULT_SETTINGS.scenarioId),
    difficultyId: pick(DIFFICULTIES, src.difficultyId, DEFAULT_SETTINGS.difficultyId),
    weatherSeverityId: pick(WEATHER, src.weatherSeverityId, DEFAULT_SETTINGS.weatherSeverityId),
    turnTimer: src.turnTimer === undefined ? DEFAULT_SETTINGS.turnTimer : !!src.turnTimer,
    bots: cleanBots(src.bots),
    fillWithRobots: fill,
    fillBots: fill,
    size: Math.max(MIN_SEATS, Math.min(MAX_SEATS, Math.round(Number(src.size)) || MAX_SEATS)),
    botLevel: [1, 2, 3].includes(Number(src.botLevel)) ? Number(src.botLevel) : 2,
  };
  // The preset is a label for a known combination. If the values no longer
  // match it (someone flipped the fill checkbox in the table room, or sent a
  // preset name with other values), the honest label is "custom".
  if (PRESET_IDS.includes(src.preset)) out.preset = matchesPreset(out, src.preset) ? src.preset : 'custom';
  else if (src.preset === 'custom') out.preset = 'custom';
  else out.preset = PRESET_IDS.find((id) => matchesPreset(out, id)) || 'custom'; // no label sent: name it if it is one
  return out;
}

export function describeBot(b) {
  const p = PERSONALITIES.find((x) => x.id === b.personalityId) || PERSONALITIES[0];
  const k = SKILLS.find((x) => x.id === b.skillLevelId) || SKILLS[0];
  return { avatar: p.avatar, name: p.id === 'random' ? 'Mystery robot' : p.name, skill: k.id === 'random' ? 'any skill' : k.name, skillIcon: k.icon };
}

/** One line everyone at the table can read; also the chat note after a save. */
export function summarizeSettings(s) {
  const n = (list, id) => (list.find((x) => x.id === id) || { name: id }).name;
  const bots = s.bots.length ? s.bots.map((b) => { const d = describeBot(b); return `${d.name} (${d.skill})`; }).join(', ') : 'none picked';
  const label = s.preset === 'custom' || !PRESETS[s.preset] ? 'Custom' : PRESETS[s.preset].name;
  return `${label}: ${n(SCENARIOS, s.scenarioId)} · ${n(DIFFICULTIES, s.difficultyId)} · ${n(WEATHER, s.weatherSeverityId)} weather · ${s.turnTimer ? '30s clock' : 'no clock'} · robots: ${bots}${s.fillWithRobots ? ' + fill empty chairs' : ' (empty chairs stay empty)'}`;
}

/**
 * The robots that take the chairs still empty when the table starts: the
 * host's line-up first, in order, then surprise robots.
 *
 * "Surprise me" is resolved HERE, to a named personality and a skill, so the
 * name on the arena's seat list is the same robot the game then plays (the
 * engine would otherwise roll its own at START_GAME and the two would
 * disagree). A surprise never repeats a personality already at the table; a
 * host who deliberately picks the same robot twice gets it twice.
 *
 * `rand` defaults to Math.random. This runs once, on the server, when the
 * table starts and outside any move, exactly like the table's own seed; the
 * result is stored in the seat list, so nothing is ever re-rolled.
 */
export function botLineup(settings, count, rand = Math.random) {
  const s = normalizeSettings(settings);
  const n = Math.max(0, Math.min(MAX_LINEUP, Math.floor(Number(count)) || 0));
  const wanted = [];
  for (let i = 0; i < n; i++) wanted.push(s.bots[i] || { personalityId: 'random', skillLevelId: 'random' });
  const named = PERSONALITIES.filter((p) => p.id !== 'random');
  const skills = SKILLS.filter((k) => k.id !== 'random');
  const used = new Set(wanted.map((b) => b.personalityId).filter((id) => id !== 'random'));
  const roll = (list) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
  return wanted.map((b) => {
    let personality = named.find((p) => p.id === b.personalityId);
    if (!personality) {
      const free = named.filter((p) => !used.has(p.id));
      personality = roll(free.length ? free : named);
      used.add(personality.id);
    }
    const skillLevelId = b.skillLevelId === 'random' ? roll(skills).id : b.skillLevelId;
    return { name: personality.name, avatar: personality.avatar, level: SKILL_LEVEL[skillLevelId], personalityId: personality.id, skillLevelId };
  });
}
