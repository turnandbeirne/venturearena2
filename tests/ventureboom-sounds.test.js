// VentureBoom sounds: which event makes which sound, and that nothing plays
// when it should not (muted, or before the player has touched the page).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { SOUND_EVENTS, VOICE_NAMES, soundFor, createSounds } from '../src/games/ventureboom/sounds.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Counts what would have been played, in place of a sound card. */
function fakeAudio({ state = 'running' } = {}) {
  const made = { ctx: 0, osc: 0, noise: 0, starts: [] };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra = {}) => ({ connect() {}, ...extra });
  class Ctx {
    constructor() { made.ctx += 1; this.state = state; this.currentTime = 10; this.sampleRate = 8000; this.destination = node(); }
    createGain() { return node({ gain: param() }); }
    createBiquadFilter() { return node({ frequency: param(), Q: param(), type: 'lowpass' }); }
    createOscillator() { made.osc += 1; return node({ frequency: param(), type: 'sine', start(t) { made.starts.push(t); }, stop() {} }); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { made.noise += 1; return node({ buffer: null, loop: false, start(t) { made.starts.push(t); }, stop() {} }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() {}
  }
  return { Ctx, made };
}

describe('which event makes which sound', () => {
  it('every kind of entry the rules write to the log has been given a sound, or silence, on purpose', () => {
    const rules = fs.readFileSync(path.join(root, 'src/games/ventureboom/rules.js'), 'utf8');
    const logged = [...new Set([...rules.matchAll(/pushLog\(G, \{ t: '([a-z]+)'/g)].map((m) => m[1]))].sort();
    expect(logged.length).toBeGreaterThan(15);
    const missing = logged.filter((t) => !Object.prototype.hasOwnProperty.call(SOUND_EVENTS, t));
    expect(missing, 'rules.js logs these, sounds.js does not list them').toEqual([]);
    const stale = Object.keys(SOUND_EVENTS).filter((t) => !logged.includes(t));
    expect(stale, 'sounds.js lists these, rules.js never logs them').toEqual([]);
  });

  it('every sound an event can ask for exists', () => {
    const asked = new Set();
    for (const [t, v] of Object.entries(SOUND_EVENTS)) {
      if (typeof v === 'function') for (const e of [{ t, ok: true, p: 0 }, { t, ok: false, p: 0 }, { t, ok: true, p: 1 }]) asked.add(v(e, 0));
      else asked.add(v);
    }
    asked.delete(null);
    for (const name of asked) expect(VOICE_NAMES, name).toContain(name);
    for (const name of ['turn', 'win', 'lose', 'tick']) expect(VOICE_NAMES).toContain(name); // played by the board itself
  });

  it('the moments that matter sound like themselves', () => {
    expect(soundFor({ t: 'boom', p: 2 }, 0)).toBe('boom');
    expect(soundFor({ t: 'pivot', p: 2 }, 0)).toBe('saved');
    expect(soundFor({ t: 'bust', p: 0 }, 0)).toBe('lose');   // it was you
    expect(soundFor({ t: 'bust', p: 2 }, 0)).toBe('bust');   // it was someone else
    expect(soundFor({ t: 'exit', p: 1 }, 0)).toBe('cash');
    expect(soundFor({ t: 'pass', p: 1 }, 0)).toBe('nope');
    expect(soundFor({ t: 'steal', ok: true }, 0)).toBe('swipe');
    expect(soundFor({ t: 'steal', ok: false }, 0)).toBe('miss');
    expect(soundFor({ t: 'cancel' }, 0)).toBe(null);
    expect(soundFor({ t: 'something-new' }, 0)).toBe(null);
    expect(soundFor(null, 0)).toBe(null);
    expect(soundFor({ t: 'constructor' }, 0)).toBe(null);
  });
});

describe('the sound player', () => {
  it('is silent until the player has touched the page, then plays', () => {
    const { Ctx, made } = fakeAudio();
    const s = createSounds({ AudioCtx: Ctx, muted: false });
    expect(s.play('boom')).toBe(false);
    expect(s.queue('draw')).toBe(false);
    expect(made.ctx).toBe(0); // no audio context is even created before a gesture
    s.unlock();
    expect(made.ctx).toBe(1);
    expect(s.play('boom')).toBe(true);
    expect(made.osc + made.noise).toBeGreaterThan(0);
    s.unlock();
    expect(made.ctx).toBe(1);
  });

  it('muted means nothing is created or played, and unmuting brings it back', () => {
    const { Ctx, made } = fakeAudio();
    const s = createSounds({ AudioCtx: Ctx, muted: true });
    expect(s.muted).toBe(true);
    s.unlock();
    for (const name of VOICE_NAMES) { expect(s.play(name), name).toBe(false); expect(s.queue(name), name).toBe(false); }
    expect(made.osc + made.noise).toBe(0);
    s.setMuted(false);
    expect(s.muted).toBe(false);
    expect(s.play('cash')).toBe(true);
    s.setMuted(true);
    expect(s.play('cash')).toBe(false);
  });

  it('every voice plays without error', () => {
    const { Ctx, made } = fakeAudio();
    const s = createSounds({ AudioCtx: Ctx, muted: false });
    s.unlock();
    for (const name of VOICE_NAMES) { const before = made.osc + made.noise; expect(s.play(name), name).toBe(true); expect(made.osc + made.noise, name).toBeGreaterThan(before); }
    expect(s.play('no-such-sound')).toBe(false);
  });

  it('queued sounds follow one another instead of piling up, and never fall far behind', () => {
    const { Ctx, made } = fakeAudio();
    const s = createSounds({ AudioCtx: Ctx, muted: false });
    s.unlock();
    s.queue('boom'); const afterBoom = made.starts.length;
    s.queue('saved');
    const boomAt = Math.min(...made.starts.slice(0, afterBoom));
    const savedAt = Math.min(...made.starts.slice(afterBoom));
    expect(savedAt - boomAt).toBeGreaterThanOrEqual(0.5); // the explosion gets its moment
    for (let i = 0; i < 40; i++) s.queue('draw');
    expect(Math.max(...made.starts)).toBeLessThanOrEqual(10 + 0.01 + 1.5 + 0.2);
  });

  it('a browser with no Web Audio, or one that keeps it suspended, is simply quiet', () => {
    const none = createSounds({ AudioCtx: null, muted: false });
    none.unlock();
    expect(none.play('boom')).toBe(false);
    class Stuck { constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; } createGain() { return { gain: { value: 0 }, connect() {} }; } resume() { return Promise.reject(new Error('not allowed')); } }
    const stuck = createSounds({ AudioCtx: Stuck, muted: false });
    stuck.unlock();
    expect(stuck.play('boom')).toBe(false);
    class Broken { constructor() { throw new Error('no audio device'); } }
    const broken = createSounds({ AudioCtx: Broken, muted: false });
    expect(() => broken.unlock()).not.toThrow();
    expect(broken.play('boom')).toBe(false);
  });
});
