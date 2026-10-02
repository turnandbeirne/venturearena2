// ============================================================================
// Sound engine — Web Audio playback + volume/mute state
// ----------------------------------------------------------------------------
// Most effects are synthesized on the fly from soundLibrary.js — no audio
// files, nothing to license, keeps VentureFlow lightweight and working
// offline once loaded (good for classroom wifi). A handful of the biggest
// moments (fortune cards, badges, buyouts, a bot's laugh, "oops") also mix
// in small royalty-free recorded clips (Mixkit License) for extra character
// — under ~1.1MB total, decoded once per clip and cached (see
// playSampleNote below), so they don't add meaningfully to load time.
//
// This module is framework-free by design (same philosophy as src/game/):
// React components read/write it through useAudioSettings.js.
// ============================================================================
import { SOUNDS } from './soundLibrary';

const STORAGE_KEY = 'ventureflow-audio-v1';
const DEFAULT_VOLUME = 0.6;

let audioContext = null;
let masterGain = null;
let noiseBuffer = null;

// Decoded-clip cache for the recorded sfx in soundLibrary.js's *_SAMPLES
// pools — keyed by the imported file URL, so each clip is fetched and
// decoded once no matter how many times it's picked over a game.
const sampleBufferCache = new Map();

let settings = loadSettings();
const listeners = new Set();

// Whether the page has had a real user gesture yet (set by unlockAudio,
// which App.jsx calls on the first interaction anywhere). Before that, a
// context that isn't running is completely normal and says nothing; after
// it, the same state means the browser is genuinely refusing — and that
// distinction is the whole point of audioDiagnostics' 'blocked' reason.
let gestureSeen = false;

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { volume: DEFAULT_VOLUME, muted: false };
    const parsed = JSON.parse(raw);
    return {
      volume: typeof parsed.volume === 'number' ? parsed.volume : DEFAULT_VOLUME,
      muted: !!parsed.muted,
    };
  } catch {
    return { volume: DEFAULT_VOLUME, muted: false };
  }
}

function persistSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — audio still works, it just won't remember next visit.
  }
}

function notify() {
  for (const listener of listeners) listener(settings);
}

function ensureContext() {
  if (audioContext) return audioContext;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null; // very old / unsupported browser — sounds simply won't play
  audioContext = new Ctx();
  masterGain = audioContext.createGain();
  masterGain.gain.value = effectiveVolume();
  masterGain.connect(audioContext.destination);
  noiseBuffer = createNoiseBuffer(audioContext);
  return audioContext;
}

/** A couple seconds of white noise, generated once per context and sliced
 * from (at a random offset) for every noise-based note — crackle, applause,
 * crowd murmur, etc. Cheaper than generating fresh noise per note, and a
 * random offset keeps repeated bursts from sounding identical. */
function createNoiseBuffer(ctx) {
  const duration = 2;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function effectiveVolume() {
  return settings.muted ? 0 : settings.volume;
}

/** A pitched note: sine/triangle/square/sawtooth oscillator, optionally
 * sweeping from `freq` to `freqEnd` (used for firework whistles, cheer
 * "whoops"). */
function playToneNote(ctx, n, now) {
  const osc = ctx.createOscillator();
  const noteGain = ctx.createGain();
  osc.type = n.type;

  const startAt = now + n.start;
  const endAt = startAt + n.duration;

  if (n.freqEnd) {
    osc.frequency.setValueAtTime(n.freq, startAt);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.freqEnd), endAt);
  } else {
    osc.frequency.value = n.freq;
  }

  // Quick attack, smooth release so notes don't click/pop.
  noteGain.gain.setValueAtTime(0, startAt);
  noteGain.gain.linearRampToValueAtTime(n.gain, startAt + 0.012);
  noteGain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  osc.connect(noteGain);
  noteGain.connect(masterGain);
  osc.start(startAt);
  osc.stop(endAt + 0.02);
}

/** An unpitched burst: filtered white noise, used for firework crackle,
 * applause claps, and crowd-cheer texture — things a pure oscillator can't
 * convincingly make. */
function playNoiseNote(ctx, n, now) {
  const startAt = now + n.start;
  const endAt = startAt + n.duration;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = n.filterType || 'bandpass';
  filter.Q.value = n.filterQ ?? 1;
  if (n.filterFreqEnd) {
    filter.frequency.setValueAtTime(n.filterFreq, startAt);
    filter.frequency.linearRampToValueAtTime(n.filterFreqEnd, endAt);
  } else {
    filter.frequency.value = n.filterFreq ?? 1800;
  }

  const noteGain = ctx.createGain();
  noteGain.gain.setValueAtTime(0, startAt);
  noteGain.gain.linearRampToValueAtTime(n.gain, startAt + (n.attack ?? 0.008));
  noteGain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  src.connect(filter);
  filter.connect(noteGain);
  noteGain.connect(masterGain);

  const maxOffset = Math.max(0, noiseBuffer.duration - n.duration - 0.01);
  const offset = Math.random() * maxOffset;
  src.start(startAt, offset, n.duration);
  src.stop(endAt + 0.02);
}

/** Fetch + decode a recorded clip once per URL, caching the (promised)
 * AudioBuffer so repeat plays of the same clip are instant after the first. */
function getSampleBuffer(ctx, src) {
  let entry = sampleBufferCache.get(src);
  if (!entry) {
    entry = fetch(src)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data));
    sampleBufferCache.set(src, entry);
  }
  return entry;
}

/** A short recorded clip (see soundLibrary.js's *_SAMPLES pools) rather than
 * a synthesized note. Unlike tone/noise notes, a sample doesn't support a
 * `start` offset — it's always the only note in its recipe, so it just
 * plays as soon as decoding resolves (instant once cached). A clip that
 * fails to load/decode silently no-ops rather than breaking the game. */
function playSampleNote(ctx, n) {
  getSampleBuffer(ctx, n.src)
    .then((buffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const noteGain = ctx.createGain();
      noteGain.gain.value = n.gain ?? 1;
      src.connect(noteGain);
      noteGain.connect(masterGain);
      src.start();
    })
    .catch(() => {});
}

/**
 * Play a named effect from soundLibrary.js. Silently no-ops if audio is
 * unavailable. Most entries in SOUNDS are a static array of notes; a few
 * (fireworks, cheering, applause) are a function that GENERATES a fresh
 * randomized note list on every call, so those big celebratory moments
 * don't sound exactly the same twice.
 */
export function playSound(name) {
  const raw = SOUNDS[name];
  if (!raw) return;

  const ctx = ensureContext();
  if (!ctx) return;

  // Browsers suspend the context until a user gesture; every action that
  // triggers a sound IS a user gesture (a click), so this just resumes it.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (masterGain) masterGain.gain.value = effectiveVolume();
  if (effectiveVolume() <= 0) return;

  const recipe = typeof raw === 'function' ? raw() : raw;
  const now = ctx.currentTime;
  for (const n of recipe) {
    if (n.kind === 'noise') playNoiseNote(ctx, n, now);
    else if (n.kind === 'sample') playSampleNote(ctx, n);
    else playToneNote(ctx, n, now);
  }
}

export function getAudioSettings() {
  return settings;
}

// ============================================================================
// Diagnostics and unlocking
// ----------------------------------------------------------------------------
// Every browser refuses to produce sound until the page has had a real user
// gesture, and some environments refuse for longer than that — an embedded
// preview pane, an iframe without `allow="autoplay"`, a tab the OS has muted,
// a strict autoplay setting. From inside the page all of those look the same:
// the code runs perfectly, notes get scheduled, and nothing is heard.
//
// So rather than assume it worked, the game can now ASK. `audioDiagnostics()`
// reports the real state, and `unlockAudio()` — called from inside a genuine
// click handler — resumes the context and confirms whether that succeeded.
// components/AudioStatus.jsx turns those two into a visible control.
// ============================================================================

/**
 * What is actually true about audio right now.
 *
 * `reason` is the single most useful thing here — it separates the three
 * causes that are indistinguishable to a player who just hears nothing:
 *   'muted'       — they (or a previous session) turned it off. Their choice,
 *                   but easy to forget, and it persists in localStorage.
 *   'blocked'     — the browser has not granted audio yet.
 *   'unsupported' — no Web Audio at all.
 *   'ok'          — sound should genuinely be audible.
 */
export function audioDiagnostics() {
  const supported = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  const contextState = audioContext ? audioContext.state : 'none';
  const silentBySetting = settings.muted || settings.volume <= 0;

  let reason = 'ok';
  if (!supported) reason = 'unsupported';
  else if (silentBySetting) reason = 'muted';
  else if (!gestureSeen) {
    // Nothing has been clicked yet, so a suspended (or absent) context is
    // exactly what a healthy page looks like. Claiming a problem here would
    // put a scary warning on every fresh load.
    reason = 'ok';
  } else if (!audioContext || audioContext.state !== 'running') {
    // A gesture HAS happened and audio still isn't running — the browser is
    // refusing. This is the case that looks identical to "the game is
    // broken" from the player's side: an embedded preview pane, an iframe
    // with no `allow="autoplay"`, a muted tab, a strict autoplay setting.
    reason = 'blocked';
  }

  return {
    supported,
    contextState,
    volume: settings.volume,
    muted: settings.muted,
    reason,
  };
}

/**
 * Try to make sound work, from inside a user gesture.
 *
 * MUST be called synchronously from a real click/tap handler — that is the
 * only context in which a browser will grant audio. Creates the context if it
 * doesn't exist yet, resumes it if suspended, unmutes if the player had it
 * off, and plays a short confirmation tone so success is audible rather than
 * merely reported.
 *
 * Returns a promise for the post-attempt diagnostics, so a caller can tell
 * the player what happened if it still didn't work.
 */
export async function unlockAudio({ unmute = true, testSound = 'click' } = {}) {
  // Reaching here at all means a gesture happened — this is only ever called
  // from a click/tap/keypress handler. See `gestureSeen` above.
  gestureSeen = true;
  if (unmute && (settings.muted || settings.volume <= 0)) {
    settings = { ...settings, muted: false, volume: settings.volume > 0 ? settings.volume : DEFAULT_VOLUME };
    persistSettings();
    notify();
  }

  // Create the context here rather than waiting for the first sound, so its
  // state is knowable and a refusal can actually be reported.
  const ctx = ensureContext();
  if (ctx && ctx.state !== 'running') {
    try {
      await ctx.resume();
    } catch {
      // Still refused — audioDiagnostics() below will report it.
    }
  }
  if (testSound) playSound(testSound);
  const result = audioDiagnostics();
  notify(); // so any mounted AudioStatus re-reads immediately
  return result;
}

export function setVolume(volume) {
  settings = { ...settings, volume: Math.min(1, Math.max(0, volume)) };
  if (masterGain) masterGain.gain.value = effectiveVolume();
  persistSettings();
  notify();
}

export function setMuted(muted) {
  settings = { ...settings, muted };
  if (masterGain) masterGain.gain.value = effectiveVolume();
  persistSettings();
  notify();
}

export function toggleMuted() {
  setMuted(!settings.muted);
}

export function subscribeAudioSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
