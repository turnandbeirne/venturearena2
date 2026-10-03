// Mancala: pure rules. No React, no DOM, no clock, no Math.random.
// The board, the bot and the move validator all import legalMoves() and sow()
// from here, so they share ONE definition of what a move does and cannot drift.
//
// The ring of 14 slots, sown counter-clockwise (index + 1):
//   0..5   seat 0's pits      6   seat 0's store
//   7..12  seat 1's pits      13  seat 1's store
// Pit k of one seat faces pit 5 - k of the other, so opposite(i) = 12 - i.
import { defineGame, refuse, pushLog, countMove, finish, twoSeatPlacements, INVALID_MOVE } from '../kit.js';

export const PITS = 6;
export const STONES = 4;
export const SLOTS = 14;
export const TOTAL = PITS * STONES * 2;
/**
 * A game runs 30 to 80 moves. Every sow that crosses to the other side drops a
 * stone in a store, so play cannot loop for ever; the limit is there so the
 * rule is uniform and a pathological game still ends.
 */
export const MERCY_MOVES = 300;

export const storeOf = (seat) => (seat === 0 ? 6 : 13);
/** Ring index of a seat's pit `pit` (0..5, counted in sowing order). */
export const pitIndex = (seat, pit) => seat * 7 + pit;
export const isStore = (i) => i === 6 || i === 13;
/** Whose slot this is, stores included. */
export const ownerOf = (i) => (i < 7 ? 0 : 1);
export const opposite = (i) => 12 - i;

/** Pits (0..5) the seat can sow from. The single source of legality. */
export function legalMoves(G, seat = Number(G.turnP)) {
  if (G.over) return [];
  const out = [];
  for (let pit = 0; pit < PITS; pit++) if (G.pits[pitIndex(seat, pit)] > 0) out.push(pit);
  return out;
}

/** Slots that receive a stone, in order, when `seat` sows `stones` from ring index `from`. */
export function pathOf(seat, from, stones) {
  const skip = storeOf(1 - seat);
  const path = [];
  let i = from;
  for (let k = 0; k < stones; k++) {
    i = (i + 1) % SLOTS;
    if (i === skip) i = (i + 1) % SLOTS;
    path.push(i);
  }
  return path;
}

/**
 * What sowing does, without touching the input. Returns the new ring and what
 * happened: `extra` (last stone in the sower's own store), `captured` (stones
 * moved to the store by a capture, the capturing stone included).
 */
export function sow(pits, seat, pit) {
  const next = pits.slice();
  const from = pitIndex(seat, pit);
  const stones = next[from];
  next[from] = 0;
  const path = pathOf(seat, from, stones);
  for (const i of path) next[i] += 1;
  const last = path.length ? path[path.length - 1] : from;
  const extra = last === storeOf(seat);
  let captured = 0;
  // A capture needs the last stone alone in one of the sower's own pits AND
  // stones across from it: landing opposite an empty pit captures nothing.
  if (!extra && !isStore(last) && ownerOf(last) === seat && next[last] === 1 && next[opposite(last)] > 0) {
    captured = next[opposite(last)] + 1;
    next[opposite(last)] = 0;
    next[last] = 0;
    next[storeOf(seat)] += captured;
  }
  return { pits: next, from, stones, last, extra, captured };
}

export function sideCount(pits, seat) {
  let total = 0;
  for (let pit = 0; pit < PITS; pit++) total += pits[pitIndex(seat, pit)];
  return total;
}

/** True when either side has run out: the game ends and the other side sweeps. */
export const sideEmpty = (pits) => sideCount(pits, 0) === 0 || sideCount(pits, 1) === 0;

/** End of game: each side's remaining stones go to that side's own store. */
export function settle(pits) {
  const next = pits.slice();
  const swept = [0, 0];
  for (let seat = 0; seat < 2; seat++) {
    for (let pit = 0; pit < PITS; pit++) { swept[seat] += next[pitIndex(seat, pit)]; next[pitIndex(seat, pit)] = 0; }
    next[storeOf(seat)] += swept[seat];
  }
  return { pits: next, swept };
}

const blankStats = () => ({ moves: 0, extra: 0, captures: 0, capturedStones: 0 });

function end(G, reason) {
  const scores = [G.pits[storeOf(0)], G.pits[storeOf(1)]];
  const winner = scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1;
  finish(G, twoSeatPlacements(winner), { reason: winner === null && reason === 'win' ? 'draw' : reason, scores });
}

export const mancala = defineGame({
  name: 'mancala',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => {
    const pits = Array(SLOTS).fill(STONES);
    pits[storeOf(0)] = 0;
    pits[storeOf(1)] = 0;
    return { pits, turnP: '0', stats: [blankStats(), blankStats()], mid: null };
  },
  moves: {
    sow: ({ G, playerID }, pit) => {
      if (refuse(G, playerID)) return INVALID_MOVE;
      const seat = Number(playerID);
      if (!Number.isInteger(pit) || !legalMoves(G, seat).includes(pit)) return INVALID_MOVE;
      const r = sow(G.pits, seat, pit);
      G.pits = r.pits;
      // Guarded where written: a match that started before these fields existed has neither.
      if (!Array.isArray(G.stats)) G.stats = [blankStats(), blankStats()];
      const st = G.stats[seat];
      st.moves += 1;
      if (r.extra) st.extra += 1;
      if (r.captured) { st.captures += 1; st.capturedStones += r.captured; }
      const moveN = countMove(G);
      pushLog(G, { t: 'sow', p: seat, pit, from: r.from, stones: r.stones, last: r.last, extra: r.extra, cap: r.captured });
      // Who led when half the stones were home: the arena reads comebacks from it.
      if (!G.mid && G.pits[storeOf(0)] + G.pits[storeOf(1)] >= TOTAL / 2) G.mid = [G.pits[storeOf(0)], G.pits[storeOf(1)]];
      // Terminal conditions before the turn changes hands: a move that empties
      // a side ends the game even when it also earned an extra turn.
      if (sideEmpty(G.pits)) {
        const { pits, swept } = settle(G.pits);
        G.pits = pits;
        for (let s = 0; s < 2; s++) if (swept[s] > 0) pushLog(G, { t: 'sweep', p: s, stones: swept[s] });
        end(G, 'win');
        return undefined;
      }
      // Mercy: decided on the stores as they stand, stones still in play count for nobody.
      if (moveN >= MERCY_MOVES) { end(G, 'mercy'); return undefined; }
      if (!r.extra) G.turnP = String(1 - seat);
      return undefined;
    },
  },
});

/** What the arena learns about how this seat played (see server/arena/play.js). */
export function telemetry(G, seat) {
  const st = (Array.isArray(G.stats) && G.stats[seat]) || blankStats();
  const out = {
    metrics: {
      moves: st.moves,
      extraTurns: st.extra,
      captures: st.captures,
      capturedStones: st.capturedStones,
      store: Array.isArray(G.pits) ? G.pits[storeOf(seat)] : 0,
    },
    skillTags: ['counting', 'tempo', 'planning ahead'],
  };
  // Equal stores at the midpoint share first, the same way tied placements do.
  if (Array.isArray(G.mid)) out.midRank = G.mid[seat] >= G.mid[1 - seat] ? 1 : 2;
  return out;
}
