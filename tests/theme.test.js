// The look: pages wear venturemaker.org's colours, game tables stay dark, and
// the two palettes are kept apart (HOUSE-RULES section 4, rule 12).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/client/styles.css'), 'utf8');
/** Every rule as [selector, body], with comments and @media wrappers removed. */
function rules(text) {
  const out = [];
  const flat = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) out.push([m[1].trim().replace(/^@media[^{]*\{\s*/, ''), m[2]]);
  return out;
}
const TABLE_ONLY = /var\(--(navy|navy-2|navy-3|line|gold|gold-2|cream|muted|good|bad|teal|violet)\)/;
const token = (name) => { const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css); return m ? m[1].trim() : null; };
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('the page palette', () => {
  it('is venturemaker.org\'s: navy, cream, orange, teal', () => {
    // Read from venturemaker.org's own stylesheet on 2026-10-02 (hsl 220 50% 15, 35 40% 96, 25 90% 55, 180 70% 45).
    expect(token('vm-navy')).toBe('#132039');
    expect(token('vm-cream')).toBe('#f9f5f1');
    expect(token('vm-orange')).toBe('#f47b25');
    expect(token('vm-teal')).toBe('#22c3c3');
    expect(css).toMatch(/--display: 'Inter Variable'/);
  });

  it('page rules use the semantic tokens; the table\'s palette appears only inside .stage', () => {
    const offenders = [];
    for (const [selector, body] of rules(css)) {
      if (selector === ':root') continue; // where both palettes are defined
      if (!TABLE_ONLY.test(body)) continue;
      // Every comma-separated part of the selector must be scoped to the table.
      if (!selector.split(',').every((s) => /(^|\s)\.stage(\s|$|\.|:|>)/.test(s.trim()) || s.trim().startsWith('.stage'))) offenders.push(`${selector} { ${body.trim().slice(0, 80)} }`);
    }
    expect(offenders, 'a page rule uses a colour that only exists for the dark game table').toEqual([]);
  });

  it('text colours are readable on the page: at least 4.5:1 on the cream page, the white cards and the tinted fills', () => {
    const surfaces = { page: '#f9f5f1', card: '#ffffff', tinted: token('surface-2') };
    const inks = { 'ink-soft': token('ink-soft'), 'accent-ink': token('accent-ink'), 'teal-ink': token('teal-ink'), ok: token('ok'), warn: token('warn') };
    for (const [name, ink] of Object.entries(inks)) {
      for (const [where, bg] of Object.entries(surfaces)) {
        expect(contrast(ink, bg), `--${name} ${ink} on the ${where} ${bg}`).toBeGreaterThanOrEqual(where === 'tinted' && name === 'teal-ink' ? 4.5 : 4.5);
      }
    }
    expect(contrast('#132039', '#f9f5f1')).toBeGreaterThan(12);
  });

  it('the orange button is a little deeper than the brand orange, so white text on it is readable', () => {
    // White on venturemaker.org's #f47b25 is 2.7:1. The button uses a deeper
    // orange and bold text; the brand orange is its hover colour.
    expect(contrast('#ffffff', token('accent'))).toBeGreaterThanOrEqual(3.4);
    expect(css).toMatch(/--accent-2: var\(--vm-orange\)/);
  });
});

describe('the drafting-paper backdrop', () => {
  const file = path.join(root, 'src/client/assets/blueprint.svg');
  const svg = fs.readFileSync(file, 'utf8');
  it('is on the page, and not on the game table', () => {
    expect(css).toMatch(/body \{[^}]*url\('\.\/assets\/blueprint\.svg'\)/);
    const stage = rules(css).find(([selector]) => selector === '.stage');
    expect(stage[1]).not.toMatch(/blueprint/);
    // The table paints its own background over the paper.
    expect(css).toMatch(/\.stage \{[^}]*background: var\(--bg\)/);
  });
  it('stays a backdrop: faint lines, one colour, no text, and small enough to load at once', () => {
    const opacities = [...svg.matchAll(/opacity="([0-9.]+)"/g)].map((m) => Number(m[1]));
    expect(opacities.length).toBeGreaterThanOrEqual(4);
    // "A bit more noticeable than a watermark": the grid well under the sketches, and nothing above a quarter.
    expect(Math.max(...opacities)).toBeLessThanOrEqual(0.25);
    expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.05);
    expect(new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1])).size).toBe(1);
    expect(svg).not.toMatch(/<text|<image|fill="#/);
    expect(fs.statSync(file).size).toBeLessThan(12 * 1024);
  });
  it('is the same file on the static pages', () => {
    const seo = fs.readFileSync(path.join(root, 'scripts/build-seo.mjs'), 'utf8');
    expect(seo).toMatch(/copyFileSync\(path\.resolve\('src\/client\/assets\/blueprint\.svg'\)/);
    expect(seo).toMatch(/url\(\/blueprint\.svg\)/);
  });
});

describe('the static pages', () => {
  const seo = fs.readFileSync(path.join(root, 'scripts/build-seo.mjs'), 'utf8');
  it('wear the same colours', () => {
    for (const hex of ['#132039', '#f9f5f1', '#22c3c3']) expect(seo).toContain(hex);
    expect(seo).not.toContain('#0b1530');
  });
});
