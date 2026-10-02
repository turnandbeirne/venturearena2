// VentureBoom sound effects. Every sound is synthesised in the browser with
// Web Audio: there are no audio files to download, license or keep in step.
//
// Sounds are keyed off the game log (HOUSE-RULES section 3, rule 6), so each
// event sounds once: a re-render, or a refresh in the middle of a game, never
// replays it. The board calls soundFor(entry) for each NEW log entry.
//
// Browsers only allow sound after the person has touched the page, so nothing
// plays until unlock() has run inside a tap, click or key press.

/** Remembered per browser: 'off' when the player muted the game. */
export const SOUND_PREF = 'ventureboom.sound';

/**
 * Log entry type -> the voice it plays (a name, a function of the entry, or
 * null for "deliberately silent"). tests/ventureboom-sounds.test.js fails if
 * rules.js logs a type that is not listed here, so a new event cannot be
 * forgotten.
 */
export const SOUND_EVENTS = {
  deal: 'deal',
  draw: 'draw',
  play: 'play',
  combo: 'play',
  offer: 'play',
  pass: 'nope',              // a Hard Pass hits the table
  cancel: null,              // the Hard Pass already said it
  exit: 'cash',
  attack: 'takeover',
  skip: 'whoosh',
  peek: 'blip',
  shuffle: 'shuffle',
  ask: null,                 // the answer ("gave") makes the sound
  steal: (e) => (e.ok ? 'swipe' : 'miss'),
  hire: (e) => (e.ok ? 'swipe' : 'miss'),
  gave: (e) => (e.ok ? 'gift' : 'miss'),
  review: 'blip',
  took: 'gift',
  placed: 'whoosh',          // the BOOM slides back into the deck
  refill: 'shuffle',
  boom: 'boom',
  pivot: 'saved',
  bust: (e, mySeat) => (e.p === mySeat ? 'lose' : 'bust'),
  round: 'round',
};

/** The voice for one log entry, or null. Pure. */
export function soundFor(entry, mySeat = null) {
  if (!entry || !Object.prototype.hasOwnProperty.call(SOUND_EVENTS, entry.t)) return null;
  const v = SOUND_EVENTS[entry.t];
  return typeof v === 'function' ? v(entry, mySeat) : v;
}

/** How long to leave after a voice before the next queued one starts (seconds). */
const GAP = { boom: 0.6, deal: 0.3, lose: 0.9, bust: 0.7, win: 0.9, takeover: 0.45, shuffle: 0.3 };
const DEFAULT_GAP = 0.13;

// ---- the voices ---------------------------------------------------------------
// Each takes the toolkit and a start time. `o` is an oscillator sweep,
// `n` a burst of filtered noise.
const VOICES = {
  tick: ({ o }, t) => { o('sine', 1250, 1250, t, 0.035, 0.07); },
  draw: ({ o, n }, t) => { n(t, 0.09, 0.22, 'highpass', 1800, 4200); o('triangle', 700, 920, t, 0.05, 0.07); },
  play: ({ o, n }, t) => { o('triangle', 520, 340, t, 0.1, 0.2); n(t, 0.05, 0.1, 'bandpass', 1200, 900); },
  deal: ({ n }, t) => { for (let i = 0; i < 4; i++) n(t + i * 0.065, 0.05, 0.16, 'highpass', 2200, 3600); },
  nope: ({ o }, t) => { o('square', 150, 118, t, 0.3, 0.13); o('square', 157, 124, t, 0.3, 0.1); },
  cash: ({ o, n }, t) => { n(t, 0.03, 0.12, 'highpass', 6000, 7000); o('sine', 1319, 1319, t, 0.1, 0.16); o('sine', 1760, 1760, t + 0.09, 0.42, 0.2); o('triangle', 3520, 3520, t + 0.09, 0.3, 0.05); },
  takeover: ({ o }, t) => { o('sawtooth', 110, 104, t, 0.22, 0.16, 700); o('sawtooth', 82, 76, t + 0.24, 0.36, 0.18, 600); },
  whoosh: ({ n }, t) => { n(t, 0.26, 0.2, 'bandpass', 400, 2400, 1); },
  blip: ({ o }, t) => { o('sine', 880, 1320, t, 0.08, 0.13); o('sine', 1320, 1760, t + 0.09, 0.09, 0.11); },
  shuffle: ({ n }, t) => { for (let i = 0; i < 6; i++) n(t + i * 0.045, 0.03, 0.14, 'bandpass', 2500, 2100, 2); },
  swipe: ({ o }, t) => { o('sine', 420, 980, t, 0.17, 0.18); },
  miss: ({ o }, t) => { o('sine', 520, 250, t, 0.22, 0.13); },
  gift: ({ o }, t) => { o('triangle', 660, 660, t, 0.11, 0.16); o('triangle', 880, 880, t + 0.1, 0.2, 0.16); },
  boom: ({ o, n }, t) => { n(t, 1.0, 0.75, 'lowpass', 1100, 60); o('sine', 120, 30, t, 0.75, 0.7); o('square', 58, 30, t, 0.4, 0.14, 300); },
  saved: ({ o }, t) => { [523, 659, 784, 1047].forEach((f, i) => o('triangle', f, f, t + i * 0.07, 0.18, 0.16)); },
  bust: ({ o }, t) => { o('sawtooth', 392, 196, t, 0.5, 0.13, 900); o('sawtooth', 370, 175, t + 0.4, 0.55, 0.13, 800); },
  lose: ({ o }, t) => { [[311, 0.26], [294, 0.26], [277, 0.26]].forEach(([f, d], i) => o('sawtooth', f, f * 0.985, t + i * 0.28, d, 0.13, 900)); o('sawtooth', 262, 220, t + 0.84, 0.8, 0.14, 800); },
  win: ({ o }, t) => { [[392, 0.1], [523, 0.1], [659, 0.1]].forEach(([f, d], i) => { o('triangle', f, f, t + i * 0.11, d + 0.06, 0.18); o('square', f, f, t + i * 0.11, d, 0.04, 2400); }); o('triangle', 784, 784, t + 0.33, 0.5, 0.2); o('sine', 1568, 1568, t + 0.33, 0.6, 0.08); o('triangle', 1047, 1047, t + 0.5, 0.6, 0.16); },
  round: ({ o }, t) => { o('triangle', 784, 784, t, 0.16, 0.14); o('triangle', 1047, 1047, t + 0.14, 0.3, 0.14); },
  turn: ({ o }, t) => { o('sine', 880, 880, t, 0.12, 0.1); o('sine', 1175, 1175, t + 0.11, 0.24, 0.1); },
};
export const VOICE_NAMES = Object.keys(VOICES);

function readPref() {
  try { return window.localStorage.getItem(SOUND_PREF) === 'off'; } catch { return false; }
}

/**
 * One per board. `AudioCtx` is injectable so the tests can count what would
 * have been played without a sound card.
 */
export function createSounds({ AudioCtx = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null, muted = typeof window !== 'undefined' ? readPref() : false } = {}) {
  let ctx = null; let master = null; let hiss = null; let cursor = 0; let isMuted = !!muted;

  function ready() {
    if (isMuted || !ctx || ctx.state !== 'running') return false;
    return true;
  }
  function kit() {
    const o = (type, f0, f1, t, dur, gain, lowpass = 0) => {
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = osc;
      if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; osc.connect(f); node = f; }
      node.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + dur + 0.03);
    };
    const n = (t, dur, gain, type, f0, f1, q = 0.7) => {
      if (!hiss) {
        hiss = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = hiss.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ctx.createBufferSource(); const f = ctx.createBiquadFilter(); const g = ctx.createGain();
      src.buffer = hiss; src.loop = true;
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.03);
    };
    return { o, n };
  }

  return {
    get muted() { return isMuted; },
    /** Call inside a tap, click or key press: browsers refuse sound before one. */
    unlock() {
      if (!AudioCtx) return;
      try {
        if (!ctx) { ctx = new AudioCtx(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); }
        if (ctx.state === 'suspended' && ctx.resume) { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
      } catch { ctx = null; }
    },
    setMuted(v) {
      isMuted = !!v;
      try { if (isMuted) window.localStorage.setItem(SOUND_PREF, 'off'); else window.localStorage.removeItem(SOUND_PREF); } catch { /* private window: the choice lasts for this visit */ }
    },
    /** Play now. Returns true if it will be heard. */
    play(name) {
      if (!VOICES[name] || !ready()) return false;
      try { VOICES[name](kit(), ctx.currentTime + 0.01); } catch { return false; }
      return true;
    },
    /** Play after whatever is already queued, so a burst of events is a sequence and not a smear. */
    queue(name) {
      if (!VOICES[name] || !ready()) return false;
      const now = ctx.currentTime + 0.01;
      // Never fall more than a second and a half behind the table.
      const at = Math.min(Math.max(now, cursor), now + 1.5);
      cursor = at + (GAP[name] || DEFAULT_GAP);
      try { VOICES[name](kit(), at); } catch { return false; }
      return true;
    },
    close() { try { if (ctx && ctx.close) ctx.close(); } catch { /* already closed */ } ctx = null; },
  };
}
