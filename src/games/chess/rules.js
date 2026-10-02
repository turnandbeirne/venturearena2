// Chess: pure rules. No React, no DOM, no clock, no Math.random.
// chess.js (BSD-2) is the move generator. G holds the position as a FEN string
// and nothing that is not plain JSON: a Chess object is built from the FEN for
// each question and thrown away. The board, the bot and the move validator all
// ask legalMoves() / legalFrom() here, so there is one definition of "legal".
//
// Seat 0 is White.
import { Chess } from 'chess.js';
import { defineGame, refuse, pushLog, countMove, finish, twoSeatPlacements, INVALID_MOVE } from '../kit.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Mercy limit in plies (150 moves each). Past it the game is a draw. */
export const MERCY_PLIES = 300;
/** Material is read at this ply (15 moves each) as "who was ahead at the midpoint". */
export const MID_PLY = 30;
export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PROMOTIONS = ['q', 'r', 'b', 'n'];
const SQUARE = /^[a-h][1-8]$/;

export const colorOf = (seat) => (Number(seat) === 0 ? 'w' : 'b');
export const seatOf = (color) => (color === 'w' ? 0 : 1);
/** 'a8' is index 0, 'h1' is index 63: the order a FEN lists squares in. */
export const squareName = (i) => 'abcdefgh'[i & 7] + (8 - (i >> 3));
export const squareIndex = (sq) => (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97);

/**
 * What makes two positions "the same" for repetition: pieces, side to move,
 * castling rights and the en passant square. chess.js only writes an en
 * passant square into a FEN when a pawn can actually take there, which is
 * exactly the rule.
 */
export const positionKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

/** The 64 squares of a FEN as { color, type } or null. No chess.js: the board calls this every render. */
export function piecesOf(fen) {
  const out = [];
  for (const ch of fen.split(' ')[0]) {
    if (ch === '/') continue;
    if (ch >= '1' && ch <= '8') { for (let k = 0; k < Number(ch); k++) out.push(null); continue; }
    const lower = ch.toLowerCase();
    out.push({ color: ch === lower ? 'b' : 'w', type: lower });
  }
  return out;
}

/** Material on the board as [white, black], in pawns. */
export function material(fen) {
  const total = [0, 0];
  for (const p of piecesOf(fen)) if (p) total[seatOf(p.color)] += VALUE[p.type];
  return total;
}

// chess.js move objects are class instances; hand out plain data so nothing
// that leaves this file can end up in G by accident.
const plain = (m) => ({ from: m.from, to: m.to, san: m.san, color: m.color, piece: m.piece, captured: m.captured || null, promotion: m.promotion || null, flags: m.flags, after: m.after });

/** Every legal move for the side to move. The single source of legality. */
export function legalMoves(G) {
  if (!G || G.over) return [];
  return new Chess(G.fen).moves({ verbose: true }).map(plain);
}

/** Legal moves of the piece on `square` (empty when it is not that side's turn). */
export function legalFrom(G, square) {
  if (!G || G.over || typeof square !== 'string' || !SQUARE.test(square)) return [];
  return new Chess(G.fen).moves({ square, verbose: true }).map(plain);
}

/** True when the side to move is in check. */
export const inCheck = (G) => new Chess(G.fen).isCheck();

const blankStats = () => ({ moves: 0, captures: 0, checks: 0, castled: 0, promotions: 0 });

/** A fresh G for a position. setup() uses the start; tests build others. */
export function initialState(fen = START_FEN) {
  const game = new Chess(fen); // throws on a malformed FEN
  return {
    fen: game.fen(),
    turnP: String(seatOf(game.turn())),
    // position key -> times seen. A new Chess is built from the FEN on every
    // move, so chess.js cannot count repetitions for us.
    reps: { [positionKey(game.fen())]: 1 },
    taken: [[], []], // taken[seat] = piece types that seat has captured
    stats: [blankStats(), blankStats()],
    mid: null,
  };
}

export const chess = defineGame({
  name: 'chess',
  minPlayers: 2,
  maxPlayers: 2,
  setup: () => initialState(),
  moves: {
    move: ({ G, playerID }, from, to, promotion) => {
      if (refuse(G, playerID)) return INVALID_MOVE;
      if (typeof from !== 'string' || typeof to !== 'string' || !SQUARE.test(from) || !SQUARE.test(to)) return INVALID_MOVE;
      if (promotion !== undefined && promotion !== null && !PROMOTIONS.includes(promotion)) return INVALID_MOVE;
      const seat = Number(playerID);
      const game = new Chess(G.fen);
      // G.turnP and the FEN always agree; if a bug ever split them, the FEN wins and nobody moves out of turn.
      if (game.turn() !== colorOf(seat)) return INVALID_MOVE;
      const options = legalFrom(G, from).filter((m) => m.to === to);
      // A pawn reaching the last rank has four entries; queen unless told otherwise.
      const pick = options.find((m) => !m.promotion || m.promotion === (promotion || 'q'));
      if (!pick) return INVALID_MOVE;
      const done = game.move({ from, to, promotion: pick.promotion || undefined });
      G.fen = game.fen();

      // Guarded where written: matches that began before a field existed do not have it.
      if (!Array.isArray(G.taken)) G.taken = [[], []];
      if (done.captured) G.taken[seat].push(done.captured);
      if (!Array.isArray(G.stats)) G.stats = [blankStats(), blankStats()];
      const st = G.stats[seat];
      st.moves += 1;
      if (done.captured) st.captures += 1;
      if (done.promotion) st.promotions += 1;
      if (done.san.includes('+') || done.san.includes('#')) st.checks += 1;
      if (done.flags.includes('k') || done.flags.includes('q')) st.castled = 1;

      // A capture or a pawn move can never be undone, so no earlier position
      // can come back: start the count again and keep the map small.
      if (!G.reps || typeof G.reps !== 'object' || done.captured || done.piece === 'p') G.reps = {};
      const key = positionKey(G.fen);
      G.reps[key] = (G.reps[key] || 0) + 1;

      const ply = countMove(G);
      pushLog(G, { t: 'move', p: seat, ply, from, to, san: done.san, piece: done.piece, cap: done.captured || null, promo: done.promotion || null });
      if (ply === MID_PLY) { const [w, b] = material(G.fen); G.mid = w - b; }

      // Terminal conditions before the turn changes hands. Checkmate first: a
      // mating move that is also the 100th quiet half-move is still a win.
      if (game.isCheckmate()) { finish(G, twoSeatPlacements(seat), { reason: 'checkmate' }); return undefined; }
      let draw = null;
      if (game.isStalemate()) draw = 'stalemate';
      else if (game.isInsufficientMaterial()) draw = 'material';
      else if (G.reps[key] >= 3) draw = 'repetition';
      else if (game.isDrawByFiftyMoves()) draw = 'fifty-move';
      else if (ply >= MERCY_PLIES) draw = 'mercy';
      if (draw) { finish(G, twoSeatPlacements(null), { reason: draw }); return undefined; }
      G.turnP = String(1 - seat);
      return undefined;
    },
  },
});

/** What the arena learns about how this seat played (see server/arena/play.js). */
export function telemetry(G, seat) {
  const st = (Array.isArray(G.stats) && G.stats[seat]) || blankStats();
  const [w, b] = typeof G.fen === 'string' ? material(G.fen) : [0, 0];
  const out = {
    metrics: {
      moves: st.moves,
      captures: st.captures,
      checks: st.checks,
      castled: st.castled,
      promotions: st.promotions,
      materialLead: seat === 0 ? w - b : b - w,
    },
    skillTags: ['calculation', 'tactics', 'planning ahead'],
  };
  // Level material at the midpoint shares first, the same way tied placements do.
  if (typeof G.mid === 'number') out.midRank = (seat === 0 ? G.mid : -G.mid) >= 0 ? 1 : 2;
  return out;
}
