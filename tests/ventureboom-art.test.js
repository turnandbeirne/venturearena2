// Card illustrations: files in src/games/ventureboom/art, made by
// scripts/import-card-art.py. A card with no illustration is drawn by the
// game instead, so a partial set is fine; a file that matches no card is not.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ART_NAMES, BY_KEY, CARDS } from '../src/games/ventureboom/cards.js';
import { artFor } from '../src/games/ventureboom/art.js';

const art = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'games', 'ventureboom', 'art');
const list = (dir) => (fs.existsSync(path.join(art, dir)) ? fs.readdirSync(path.join(art, dir)).filter((f) => !f.startsWith('.')) : []);
/** Width and height from a WebP file's header (lossy "VP8 ", lossless "VP8L" or extended "VP8X"). */
function webpSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  if (kind === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  return null;
}

describe('VentureBoom card illustrations', () => {
  const sm = list('sm'); const lg = list('lg');

  it('every file is a .webp named after a card, one copy of a card, or "back", in both sizes', () => {
    expect(sm.length).toBeGreaterThan(0);
    for (const f of [...sm, ...lg]) {
      expect(f, f).toMatch(/^[a-z0-9-]+\.webp$/);
      const key = f.replace(/\.webp$/, '');
      expect(key === 'back' || ART_NAMES.includes(key), `${f} is not the key of any card, nor the art name of a copy`).toBe(true);
    }
    expect(sm.slice().sort()).toEqual(lg.slice().sort());
  });

  it('files are the card shape, the right width, and small enough to load fast on a phone', () => {
    for (const [dir, width, maxKb] of [['sm', 240, 45], ['lg', 720, 220]]) {
      for (const f of list(dir)) {
        const file = path.join(art, dir, f);
        const size = webpSize(file);
        expect(size, `${dir}/${f} is not a WebP file`).toBeTruthy();
        expect(size.w, `${dir}/${f} width`).toBe(width);
        expect(size.h / size.w, `${dir}/${f} shape`).toBeCloseTo(1.445, 2);
        expect(fs.statSync(file).size / 1024, `${dir}/${f} is too heavy`).toBeLessThan(maxKb);
      }
    }
  });

  it('the first three samples are in', () => {
    for (const key of ['unicorn', 'the-lawsuit', 'sir-solders-a-lot']) expect(sm, key).toContain(`${key}.webp`);
  });

  it('the back of the deck is drawn, and is found by the name "back"', () => {
    expect(sm).toContain('back.webp');
    expect(artFor('back').sm).toMatch(/back/);
    expect(BY_KEY.back, '"back" must never also be a card').toBeUndefined();
  });

  it('reports which cards still have no illustration', () => {
    const have = new Set(sm.map((f) => f.replace(/\.webp$/, '')));
    const missing = Object.keys(BY_KEY).filter((k) => !have.has(k));
    // Not a failure: the game draws those cards itself. Printed so the list is one test run away.
    console.log(`card art: ${Object.keys(BY_KEY).length - missing.length} of ${Object.keys(BY_KEY).length} cards illustrated${missing.length ? `; still drawn by the game: ${missing.join(', ')}` : ''}`);
    // The deck was fully illustrated on 2026-10-02. A new card added without art is still fine
    // (the game draws it), but losing a picture that exists today is not.
    for (const key of ['kpi-kevin', 'duct-tape-dana', 'prototype-pete', 'patent-pending-priya', 'reorg', 'market-research', 'ask-a-mentor', 'unicorn']) expect(have.has(key), key).toBe(true);
    expect(missing.length).toBeLessThan(Object.keys(BY_KEY).length);
  });
});

describe('one picture per copy of a card', () => {
  // The seven Pivots each carry a different line ("Pivot to video."), and the
  // owner drew a picture for several of them.
  const pivots = CARDS.filter((c) => c.key === 'pivot');

  it('a copy with a picture of its own shows it; the others show the card\'s picture', () => {
    expect(pivots).toHaveLength(7);
    const video = pivots.find((c) => /Pivot to video/.test(c.flavor));
    expect(video.art).toBe('pivot-video');
    expect(artFor(video).sm).toMatch(/pivot-video/);
    expect(artFor(video).lg).toMatch(/pivot-video/);
    const plain = pivots.find((c) => !c.art);
    expect(plain, 'at least one Pivot uses the plain picture').toBeTruthy();
    expect(artFor(plain).sm).toMatch(/pivot\.webp|pivot-[A-Za-z0-9_]{6,}\.webp/);
    expect(artFor(plain).sm).not.toMatch(/pivot-(ai|video|platform|realignment|new-logo)/);
    // The log names a card by its key alone: that is always the card's own picture.
    expect(artFor('pivot')).toEqual(artFor(plain));
  });

  it('the four Out of Office cards share two pictures, two copies each', () => {
    const ooo = CARDS.filter((c) => c.key === 'out-of-office');
    expect(ooo).toHaveLength(4);
    const pictures = ooo.map((c) => artFor(c).sm);
    expect(pictures.filter((u) => /out-of-office-pool/.test(u))).toHaveLength(2);
    expect(pictures.filter((u) => !/out-of-office-pool/.test(u))).toHaveLength(2);
    expect(artFor(ooo.find((c) => /on a beach/.test(c.flavor))).sm).not.toMatch(/pool/);
  });

  it('a copy whose own picture has not been drawn yet falls back to the card\'s picture, and a card with neither to none', () => {
    expect(artFor({ key: 'pivot', art: 'pivot-not-drawn-yet' })).toEqual(artFor('pivot'));
    expect(artFor({ key: 'no-such-card' })).toBeNull();
    expect(artFor('no-such-card')).toBeNull();
    expect(artFor(null)).toBeNull();
  });

  it('a picture changes nothing about the card: same key, name, rule and story link on every copy', () => {
    for (const c of pivots) {
      expect([c.key, c.name, c.type, c.rule, c.link]).toEqual(['pivot', 'Pivot', 'pivot', pivots[0].rule, pivots[0].link]);
      if (c.art) expect(c.art, 'an art name must not collide with a card key').not.toBe(BY_KEY[c.art] && BY_KEY[c.art].key);
    }
    // Every art name on a card is one the art-file check accepts.
    for (const c of CARDS) if (c.art) expect(ART_NAMES).toContain(c.art);
  });
});

describe('a renamed card keeps its key', () => {
  // Keys are written into the logs of games already in progress and into the
  // addresses of the real-world story pages. (Renaming "It's-Like-X-for-Y
  // Yuri" by editing the name alone would have changed its key, and every
  // table mid-game would have shown the raw key where the name used to be.)
  it('Yuri has the shorter name and the key he always had', () => {
    const yuri = BY_KEY['its-like-x-for-y-yuri'];
    expect(yuri, 'the old key is gone').toBeTruthy();
    expect(yuri.name).toBe('Like-X-for-Y Yuri');
    expect(yuri.set).toBe('innovators');
    expect(yuri.link).toBe('https://venturemaker.org/ventureboom/hof/its-like-x-for-y-yuri');
    expect(CARDS.filter((c) => /Yuri/.test(c.name))).toHaveLength(1);
    expect(BY_KEY['like-x-for-y-yuri']).toBeUndefined();
  });
});
