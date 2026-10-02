// Card illustrations. Every file in art/sm and art/lg (made by
// scripts/import-card-art.py, named by card key, or by the art name of one
// copy of a card: cards.js PIVOT_ART) is picked up at build time;
// nothing is listed by hand. A card with no file here is drawn by the board
// in CSS instead, so the deck can be illustrated a few cards at a time.
//
//   sm  240 px wide: cards in a hand, on the table, in lists
//   lg  720 px wide: the opened card, loaded only when someone opens one
const sm = import.meta.glob('./art/sm/*.webp', { eager: true, query: '?url', import: 'default' });
const lg = import.meta.glob('./art/lg/*.webp', { eager: true, query: '?url', import: 'default' });

const keyOf = (file) => file.split('/').pop().replace(/\.webp$/, '');
const ART = {};
for (const [file, url] of Object.entries(sm)) ART[keyOf(file)] = { sm: url, lg: url };
for (const [file, url] of Object.entries(lg)) if (ART[keyOf(file)]) ART[keyOf(file)].lg = url;

/**
 * { sm, lg } URLs, or null when there is no illustration yet. Takes a card
 * (a copy with a picture of its own, card.art, gets that one; otherwise the
 * card's picture) or a plain name: a card key, or "back".
 */
export const artFor = (card) => {
  if (!card) return null;
  if (typeof card === 'string') return ART[card] || null;
  return ART[card.art] || ART[card.key] || null;
};
export const ART_KEYS = Object.keys(ART);
