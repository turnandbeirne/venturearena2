// The hand of cards must always be fully on screen: fitHand lays every card
// out in the space the board measured, in as few rows as keep them readable.
import { describe, it, expect } from 'vitest';
import { fitHand, comfortable, ACCEPTABLE_W, HAND_GAP, HAND_MIN_W, CARD_RATIO } from '../src/games/ventureboom/hand-layout.js';

const fits = ({ perRow, rows, w }, { n, width, height }) => ({
  holdsAll: perRow * rows >= n,
  wide: perRow * w + HAND_GAP * (perRow - 1) <= width + 0.001,
  tall: rows * w * CARD_RATIO + HAND_GAP * (rows - 1) <= height + 0.001,
});

describe('fitHand', () => {
  it('the opening hand on a small phone: all eight cards visible, in two rows', () => {
    // 360 x 640: about 354 px across and 190 px down once the table is at its minimum.
    const space = { n: 8, width: 348, height: 190, maxW: 81 };
    const f = fitHand(space);
    expect(f.scroll).toBe(false);
    expect(f.rows).toBe(2);
    expect(f.perRow).toBe(4);
    expect(fits(f, space)).toEqual({ holdsAll: true, wide: true, tall: true });
    expect(f.w).toBeGreaterThanOrEqual(HAND_MIN_W);
  });

  it('on a laptop eight cards share one row, a little smaller than full size', () => {
    const f = fitHand({ n: 8, width: 768, height: 300, maxW: 110 });
    expect(f).toEqual({ perRow: 8, rows: 1, w: 90, scroll: false });
  });

  it('a few cards are shown at full size, never enlarged', () => {
    expect(fitHand({ n: 3, width: 768, height: 300, maxW: 110 })).toEqual({ perRow: 3, rows: 1, w: 110, scroll: false });
    expect(fitHand({ n: 1, width: 348, height: 190, maxW: 81 }).w).toBe(81);
  });

  it('every size of hand, on every size of board: all cards fit, or the hand scrolls at the smallest tappable size', () => {
    for (const width of [300, 348, 378, 500, 768]) {
      for (const height of [120, 190, 260, 400, 600]) {
        for (const maxW of [64, 81, 94, 110]) {
          for (let n = 1; n <= 40; n++) {
            const space = { n, width, height, maxW };
            const f = fitHand(space);
            const where = `${n} cards in ${width}x${height} (max ${maxW})`;
            expect(f.w, where).toBeGreaterThanOrEqual(HAND_MIN_W);
            expect(f.w, where).toBeLessThanOrEqual(Math.max(maxW, HAND_MIN_W));
            expect(f.perRow * f.rows, where).toBeGreaterThanOrEqual(n);
            expect((f.rows - 1) * f.perRow, `${where}: an empty row`).toBeLessThan(n);
            const ok = fits(f, space);
            expect(ok.wide, `${where}: too wide`).toBe(true);
            if (!f.scroll) expect(ok.tall, `${where}: too tall`).toBe(true);
            else expect(f.w, where).toBe(HAND_MIN_W);
          }
        }
      }
    }
  });

  it('uses the fewest rows that keep cards comfortable, and otherwise the biggest cards it can', () => {
    const sizeAt = ({ n, width, maxW }, h, rows) => {
      const perRow = Math.ceil(n / rows); const used = Math.ceil(n / perRow);
      return Math.floor(Math.min(maxW, (width - HAND_GAP * (perRow - 1)) / perRow, (h - HAND_GAP * (used - 1)) / used / CARD_RATIO));
    };
    for (const [n, width, height, roomy, maxW] of [[8, 348, 190, 120, 81], [12, 378, 380, 300, 94], [15, 768, 260, 200, 110], [9, 300, 260, 260, 64], [11, 768, 344, 249, 110], [20, 348, 190, 120, 81], [11, 378, 374, 294, 94], [16, 378, 374, 294, 94]]) {
      const space = { n, width, height, roomy, maxW };
      const f = fitHand(space);
      if (f.scroll) continue;
      const comfy = comfortable(maxW);
      const soft = Array.from({ length: n }, (_, i) => sizeAt(space, roomy, i + 1));
      const hard = Array.from({ length: n }, (_, i) => sizeAt(space, height, i + 1));
      const firstComfy = soft.findIndex((w) => w >= comfy);
      const where = `${n} cards in ${width}x${height} (roomy ${roomy})`;
      if (firstComfy >= 0) expect(f.w, where).toBe(soft[firstComfy]);
      else if (Math.max(...soft) >= ACCEPTABLE_W) expect(f.w, where).toBe(Math.max(...soft));
      else expect(f.w, where).toBe(Math.max(...hard));
      expect(fits(f, space).tall, where).toBe(true);
    }
    // A laptop does not squeeze the table to make ten cards a little bigger.
    expect(fitHand({ n: 10, width: 768, height: 300, maxW: 110 })).toEqual({ perRow: 10, rows: 1, w: 71, scroll: false });
    // A tall phone with eleven cards: three readable rows and a roomy table,
    // not three full-size rows with the table crushed to its minimum.
    expect(fitHand({ n: 11, width: 378, height: 374, roomy: 294, maxW: 94 })).toEqual({ perRow: 4, rows: 3, w: 65, scroll: false });
    // A small phone has no room to be roomy: it takes the table's spare space.
    expect(fitHand({ n: 8, width: 348, height: 190, roomy: 120, maxW: 81 })).toEqual({ perRow: 4, rows: 2, w: 63, scroll: false });
  });

  it('nonsense input does not throw or divide by zero', () => {
    for (const bad of [{ n: 0, width: 300, height: 200, maxW: 80 }, { n: 5, width: 0, height: 200, maxW: 80 }, { n: 5, width: 300, height: -40, maxW: 80 }, { n: 5, width: 300, height: 200, maxW: 0 }, { n: 5, width: NaN, height: NaN, maxW: NaN }]) {
      const f = fitHand(bad);
      expect(Number.isFinite(f.w) && f.w >= HAND_MIN_W && f.perRow >= 1 && f.rows >= 1, JSON.stringify(bad)).toBe(true);
    }
  });
});
