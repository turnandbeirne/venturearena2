// ============================================================================
// Lifetime player profile — cosmetic unlocks, persisted across games
// ----------------------------------------------------------------------------
// Separate from a single game's save (persistence.js) and from the
// leaderboard (leaderboard.js): this tracks a small set of lifetime totals
// — games played, badges earned, best net worth/passive income ever — that
// gate a handful of cosmetic unlocks (extra avatars, an alternate board
// theme, see gameConfig.js's AVATAR_UNLOCKS/BOARD_THEMES). Purely cosmetic;
// nothing here affects gameplay balance. Survives "New Game"/"Play Again"
// forever, same storage-key pattern as leaderboard.js.
// ============================================================================
import { AVATAR_UNLOCKS, BOARD_THEMES, STARTER_AVATAR_COUNT, PLAYER_AVATARS } from '../data/gameConfig';

const STORAGE_KEY = 'ventureflow-profile-v1';

function defaultProfile() {
  return {
    gamesPlayed: 0,
    badgesEarned: 0,
    bestNetWorth: 0,
    bestPassiveIncome: 0,
    selectedTheme: 'classic',
    // Lifetime "career" totals — separate from the best-ever figures above,
    // which only ever go up on a new personal best. These accumulate every
    // game, win or lose, so there's a reason to keep playing even once a
    // personal best feels out of reach for a while. Surfaced on the setup
    // screen's Career Stats view (see components/CareerStatsModal.jsx).
    totalNetWorthEarned: 0,
    totalBusinessesStarted: 0,
    totalBusinessesSold: 0,
  };
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw);
    // Spread over the default so a profile saved before a new field existed
    // (e.g. selectedTheme) still gets a sensible value instead of undefined.
    return { ...defaultProfile(), ...parsed };
  } catch {
    return defaultProfile();
  }
}

function persist(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage unavailable — unlocks just won't be remembered next visit.
  }
}

function meetsRequirement(profile, requirement) {
  if (!requirement) return true; // no requirement = unlocked from the start
  switch (requirement.type) {
    case 'gamesPlayed':
      return profile.gamesPlayed >= requirement.value;
    case 'badgesEarned':
      return profile.badgesEarned >= requirement.value;
    case 'netWorth':
      return profile.bestNetWorth >= requirement.value;
    case 'passiveIncome':
      return profile.bestPassiveIncome >= requirement.value;
    // Lifetime totals (accumulate every game, win or lose — see
    // defaultProfile's comment) rather than a single-game best, so these
    // reward playing a certain STYLE over many games rather than one great
    // run — a trader who never starts a business and a builder who never
    // sells one both have something to chase either way.
    case 'businessesStarted':
      return (profile.totalBusinessesStarted || 0) >= requirement.value;
    case 'businessesSold':
      return (profile.totalBusinessesSold || 0) >= requirement.value;
    default:
      return false;
  }
}

/** Every avatar currently available to pick — the starter set plus any
 * lifetime-unlocked ones. */
export function unlockedAvatars(profile) {
  const starters = PLAYER_AVATARS.slice(0, STARTER_AVATAR_COUNT);
  const unlocked = AVATAR_UNLOCKS.filter((u) => meetsRequirement(profile, u.requirement)).map((u) => u.avatar);
  return [...starters, ...unlocked];
}

/** Every board theme currently available to pick. */
export function unlockedThemes(profile) {
  return BOARD_THEMES.filter((t) => meetsRequirement(profile, t.requirement));
}

/** Full avatar-unlock list annotated with whether each is unlocked yet —
 * for an "Unlocks" viewer showing locked items and what it takes to get
 * them (see components/UnlocksModal.jsx). */
export function avatarUnlockProgress(profile) {
  return AVATAR_UNLOCKS.map((u) => ({ ...u, unlocked: meetsRequirement(profile, u.requirement) }));
}

/** Same as avatarUnlockProgress, for board themes. */
export function themeUnlockProgress(profile) {
  return BOARD_THEMES.map((t) => ({ ...t, unlocked: meetsRequirement(profile, t.requirement) }));
}

/**
 * Record the result of a just-finished game (called once from
 * GameOverScreen, for the human player with the best result if there are
 * several). Returns { profile, newlyUnlockedAvatars, newlyUnlockedThemes }
 * so the caller can show a "you unlocked something!" celebration for
 * whatever crossed a threshold this game.
 */
export function recordGameResult({
  netWorth,
  passiveIncome,
  badgesEarnedThisGame,
  businessesStartedThisGame,
  businessesSoldThisGame,
}) {
  const before = loadProfile();
  const beforeAvatars = new Set(unlockedAvatars(before));
  const beforeThemeIds = new Set(unlockedThemes(before).map((t) => t.id));

  const after = {
    ...before,
    gamesPlayed: before.gamesPlayed + 1,
    badgesEarned: before.badgesEarned + (badgesEarnedThisGame || 0),
    bestNetWorth: Math.max(before.bestNetWorth, Math.round(netWorth || 0)),
    bestPassiveIncome: Math.max(before.bestPassiveIncome, Math.round(passiveIncome || 0)),
    totalNetWorthEarned: (before.totalNetWorthEarned || 0) + Math.round(netWorth || 0),
    totalBusinessesStarted: (before.totalBusinessesStarted || 0) + (businessesStartedThisGame || 0),
    totalBusinessesSold: (before.totalBusinessesSold || 0) + (businessesSoldThisGame || 0),
  };
  persist(after);

  const newlyUnlockedAvatars = unlockedAvatars(after).filter((a) => !beforeAvatars.has(a));
  const newlyUnlockedThemes = unlockedThemes(after).filter((t) => !beforeThemeIds.has(t.id));

  return { profile: after, newlyUnlockedAvatars, newlyUnlockedThemes };
}

export function setSelectedTheme(themeId) {
  const next = { ...loadProfile(), selectedTheme: themeId };
  persist(next);
  return next;
}
