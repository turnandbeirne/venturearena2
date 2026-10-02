// How a hand of cards is laid out: every card on screen at once, in as few
// rows as keep the cards comfortable to read, and never smaller than a thumb
// can hit.
//
// (Bug: the hand was one row that scrolled sideways with its scrollbar
// hidden. Dealt eight cards on a phone, four were off screen with nothing to
// say so; on a laptop a mouse could not reach them at all. A player could not
// see, and so could not play, half their hand.)
//
// Pure arithmetic, so it is tested without a browser (tests/ventureboom-hand.test.js).
// The board measures the space and passes it in.

export const HAND_GAP = 6;
/** Below this a card is too small to hit with a thumb. */
export const HAND_MIN_W = 44;
/** A card is this much taller than it is wide: the shape of the illustrated card frame (board.css --ratio). */
export const CARD_RATIO = 1.445;

/** A card at least this wide reads comfortably: 62% of full size, and never under 60 px. */
export const comfortable = (maxW) => Math.min(maxW, Math.max(60, Math.round(maxW * 0.62)));

/** Below this, bigger cards are worth squeezing the table for. */
export const ACCEPTABLE_W = 52;

/**
 * @param n      cards in the hand
 * @param width  px available across
 * @param height px available down with the table squeezed to its minimum
 * @param roomy  px available down with the table at a comfortable size
 *               (optional; defaults to `height`)
 * @param maxW   the full card width for this board size
 * @returns { perRow, rows, w, scroll }  w is the card width in px.
 *
 * In order of preference:
 *   1. the fewest rows at which cards are comfortable and the table stays roomy;
 *   2. the biggest cards that leave the table roomy, if they are acceptable;
 *   3. the biggest cards with the table at its minimum (small phones live here);
 *   4. only when even the smallest tappable card cannot show them all:
 *      `scroll`, and the hand scrolls DOWN with a visible scrollbar.
 */
export function fitHand({ n, width, height, roomy, maxW, gap = HAND_GAP, minW = HAND_MIN_W, ratio = CARD_RATIO }) {
  const cap = Math.max(minW, Math.floor(maxW || minW));
  if (!(n > 0) || !(width > 0)) return { perRow: 1, rows: 1, w: cap, scroll: false };
  const comfy = comfortable(cap);
  const soft = roomy > 0 && roomy < height ? roomy : height;
  const options = [];
  for (let rows = 1; rows <= n; rows++) {
    const perRow = Math.ceil(n / rows);
    const used = Math.ceil(n / perRow);
    if (options.length && options[options.length - 1].perRow === perRow) continue;
    const byWidth = (width - gap * (perRow - 1)) / perRow;
    const tall = (h) => (h > 0 ? (h - gap * (used - 1)) / used / ratio : Infinity);
    options.push({ perRow, rows: used, soft: Math.floor(Math.min(cap, byWidth, tall(soft))), hard: Math.floor(Math.min(cap, byWidth, tall(height))) });
    // Wide enough already: more rows can only cost height.
    if (byWidth >= cap) break;
  }
  const done = (o, w) => ({ perRow: o.perRow, rows: o.rows, w, scroll: false });
  const biggest = (key) => options.reduce((a, b) => (b[key] > a[key] ? b : a));
  const first = options.find((o) => o.soft >= comfy);
  if (first) return done(first, first.soft);
  const roomiest = biggest('soft');
  if (roomiest.soft >= Math.max(minW, ACCEPTABLE_W)) return done(roomiest, roomiest.soft);
  const squeezed = biggest('hard');
  if (squeezed.hard >= minW) return done(squeezed, squeezed.hard);
  const perRow = Math.max(1, Math.floor((width + gap) / (minW + gap)));
  return { perRow, rows: Math.ceil(n / perRow), w: minW, scroll: true };
}
