// Mancala bot. Sees only what a browser in its seat sees and picks from the
// same legalMoves() the validator uses; it looks ahead with the same sow() the
// rules apply, so what it expects a move to do is what the move does.
import { PITS, TOTAL, storeOf, pitIndex, legalMoves, sow, sideEmpty, settle, sideCount } from './rules.js';

const WIN = 10000;

/** Store lead for `me`, with a small nudge for stones still on my own side. */
function score(pits, me) {
  const mine = pits[storeOf(me)], theirs = pits[storeOf(1 - me)];
  // More than half the stones is a won game whatever is left on the board.
  if (mine * 2 > TOTAL) return WIN + mine - theirs;
  if (theirs * 2 > TOTAL) return -WIN + mine - theirs;
  return (mine - theirs) * 10 + (sideCount(pits, me) - sideCount(pits, 1 - me));
}

function finalScore(pits, me) {
  const done = settle(pits).pits;
  const diff = done[storeOf(me)] - done[storeOf(1 - me)];
  return diff === 0 ? 0 : (diff > 0 ? WIN : -WIN) + diff;
}

/** Pits nearest the store first: they are the ones that earn extra turns, and good ordering prunes more. */
function ordered(pits, seat) {
  const out = [];
  for (let pit = PITS - 1; pit >= 0; pit--) if (pits[pitIndex(seat, pit)] > 0) out.push(pit);
  return out;
}

function search(pits, seat, me, depth, alpha, beta) {
  if (sideEmpty(pits)) return finalScore(pits, me);
  if (depth <= 0) return score(pits, me);
  const maximise = seat === me;
  let best = maximise ? -Infinity : Infinity;
  for (const pit of ordered(pits, seat)) {
    const r = sow(pits, seat, pit);
    // An extra turn keeps the same seat but still spends a ply, so a chain of
    // them can never run the search away.
    const v = search(r.pits, r.extra ? seat : 1 - seat, me, depth - 1, alpha, beta);
    if (maximise) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

/** level: 1 easy (looks 2 ahead, wanders a third of the time), 2 decent (4 ahead), 3 sharp (10 ahead). */
export function bot({ G, seat, level = 2 }) {
  if (G.over || Number(G.turnP) !== seat) return null;
  const legal = legalMoves(G, seat);
  if (legal.length === 0) return null;
  if (level <= 1 && Math.random() < 0.35) return { move: 'sow', args: [legal[Math.floor(Math.random() * legal.length)]] };
  const depth = level >= 3 ? 10 : level === 2 ? 4 : 2;
  let best = legal[0], bestScore = -Infinity;
  for (const pit of ordered(G.pits, seat)) {
    if (!legal.includes(pit)) continue;
    const r = sow(G.pits, seat, pit);
    const s = search(r.pits, r.extra ? seat : 1 - seat, seat, depth - 1, -Infinity, Infinity) + Math.random() * 0.5;
    if (s > bestScore) { bestScore = s; best = pit; }
  }
  return { move: 'sow', args: [best] };
}
