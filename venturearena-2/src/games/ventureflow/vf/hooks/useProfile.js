import { useCallback, useSyncExternalStore } from 'react';
import {
  loadProfile,
  recordGameResult,
  setSelectedTheme,
  unlockedAvatars,
  unlockedThemes,
  avatarUnlockProgress,
  themeUnlockProgress,
} from '../game/profile';

// Module-level store, shared by every component that calls useProfile() —
// App.jsx (for the data-theme attribute), LandingScreen.jsx and
// SetupScreen.jsx (avatar/theme pickers), GameOverScreen.jsx (recording a
// finished game), each get their OWN useState if this were a plain hook, so
// picking a new theme in the Unlocks modal (inside SetupScreen) would
// update SetupScreen's own copy but leave App.jsx's copy — the one that
// actually sets data-theme on the root — stale until a full page reload.
// useSyncExternalStore keeps every instance reading the exact same value
// and re-rendering the moment any of them writes it — the same fix
// game/profile.js's persistence already assumed was happening.
let currentProfile = loadProfile();
const listeners = new Set();

function publish(next) {
  currentProfile = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return currentProfile;
}

/** React glue for the lifetime profile / cosmetic-unlock system — mirrors
 * useLeaderboard.js's pattern. */
export function useProfile() {
  const profile = useSyncExternalStore(subscribe, getSnapshot);

  const refresh = useCallback(() => {
    publish(loadProfile());
  }, []);

  const recordResult = useCallback((payload) => {
    const result = recordGameResult(payload);
    publish(result.profile);
    return result;
  }, []);

  const selectTheme = useCallback((themeId) => {
    publish(setSelectedTheme(themeId));
  }, []);

  return {
    profile,
    refresh,
    recordResult,
    selectTheme,
    avatars: unlockedAvatars(profile),
    themes: unlockedThemes(profile),
    avatarProgress: avatarUnlockProgress(profile),
    themeProgress: themeUnlockProgress(profile),
  };
}
