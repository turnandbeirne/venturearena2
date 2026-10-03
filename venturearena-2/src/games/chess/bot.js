// Chess bot. Sees only what a browser in its seat sees, and the move it
// returns is always one of legalMoves() from rules.js, the list the validator
// checks against.
//
// Looking ahead needs tens of thousands of positions, and asking chess.js for
// full move lists costs about 3 ms a position, so the look-ahead runs on a
// small engine of its own below (one flat 64-square array, make/unmake). That
// engine only ever SCORES the legal moves it was handed; it never invents one.
// tests/rules-chess.test.js pins its move generator against chess.js (perft).
import { legalMoves, positionKey } from './rules.js';

const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
const TYPE = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
const VAL = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100000;
const INF = 1000000;
const QUIESCE_PLIES = 6;

// Piece-square tables from White's side, a8 first (so they read like a board).
// Black reads them mirrored (square ^ 56).
const PST = [
  null,
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
];
const KING_MID = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

// Geometry, worked out once: where a knight or king can step from each square,
// and the squares along each of the 8 rays (0-3 straight, 4-7 diagonal).
const KNIGHT_TO = [], KING_TO = [], RAYS = [];
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
const JUMPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
for (let sq = 0; sq < 64; sq++) {
  const row = sq >> 3, col = sq & 7;
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  KNIGHT_TO.push(JUMPS.filter(([dr, dc]) => on(row + dr, col + dc)).map(([dr, dc]) => (row + dr) * 8 + col + dc));
  KING_TO.push(DIRS.filter(([dr, dc]) => on(row + dr, col + dc)).map(([dr, dc]) => (row + dr) * 8 + col + dc));
  RAYS.push(DIRS.map(([dr, dc]) => {
    const ray = [];
    for (let r = row + dr, c = col + dc; on(r, c); r += dr, c += dc) ray.push(r * 8 + c);
    return ray;
  }));
}
// Castling rights (K=1 Q=2 k=4 q=8) that survive a move touching each square.
const KEEP = new Array(64).fill(15);
KEEP[63] = 14; KEEP[56] = 13; KEEP[60] = 12; KEEP[7] = 11; KEEP[0] = 7; KEEP[4] = 3;

const sqIndex = (name) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);
// A move packed into one integer: from, to, promotion piece, flag (1 en passant, 2 castle, 3 double push).
const pack = (from, to, promo, flag) => from | (to << 6) | (promo << 12) | (flag << 15);

class Position {
  constructor(fen) {
    const [placement, turn, castling, ep] = fen.split(' ');
    this.board = new Array(64).fill(0);
    this.king = [0, 0];
    let i = 0;
    for (const ch of placement) {
      if (ch === '/') continue;
      if (ch >= '1' && ch <= '8') { i += Number(ch); continue; }
      const lower = ch.toLowerCase();
      const white = ch !== lower;
      this.board[i] = white ? TYPE[lower] : -TYPE[lower];
      if (lower === 'k') this.king[white ? 0 : 1] = i;
      i++;
    }
    this.side = turn === 'w' ? 1 : -1;
    this.castle = (castling.includes('K') ? 1 : 0) | (castling.includes('Q') ? 2 : 0) | (castling.includes('k') ? 4 : 0) | (castling.includes('q') ? 8 : 0);
    this.ep = ep && ep !== '-' ? sqIndex(ep) : -1;
    this.undo = [];
    this.nodes = 0;
    this.checkAt = 1024;
    this.deadline = Infinity;
    this.stop = false;
  }

  /** Look at the clock every thousand positions or so; once past the deadline every search unwinds. */
  clock() {
    this.checkAt = this.nodes + 1024;
    if (Date.now() > this.deadline) this.stop = true;
  }

  /** Is `sq` attacked by the side `by` (1 white, -1 black)? */
  attacked(sq, by) {
    const b = this.board, col = sq & 7;
    if (by === 1) {
      if (col < 7 && sq + 9 < 64 && b[sq + 9] === PAWN) return true;
      if (col > 0 && sq + 7 < 64 && b[sq + 7] === PAWN) return true;
    } else {
      if (col < 7 && sq - 7 >= 0 && b[sq - 7] === -PAWN) return true;
      if (col > 0 && sq - 9 >= 0 && b[sq - 9] === -PAWN) return true;
    }
    const knight = by * KNIGHT, king = by * KING;
    for (const to of KNIGHT_TO[sq]) if (b[to] === knight) return true;
    for (const to of KING_TO[sq]) if (b[to] === king) return true;
    const rays = RAYS[sq];
    for (let d = 0; d < 8; d++) {
      for (const to of rays[d]) {
        const v = b[to];
        if (v === 0) continue;
        const t = v * by;
        if (t === QUEEN || t === (d < 4 ? ROOK : BISHOP)) return true;
        break;
      }
    }
    return false;
  }

  inCheck() { return this.attacked(this.king[this.side === 1 ? 0 : 1], -this.side); }

  /** Pseudo-legal moves (the king may be left in check; callers test that after make()). */
  gen(capturesOnly) {
    const b = this.board, side = this.side, out = [];
    for (let sq = 0; sq < 64; sq++) {
      const t = b[sq] * side;
      if (t <= 0) continue;
      if (t === PAWN) {
        const dir = side === 1 ? -8 : 8, row = sq >> 3, col = sq & 7;
        const last = row === (side === 1 ? 1 : 6);
        const fwd = sq + dir;
        if (b[fwd] === 0) {
          if (last) {
            out.push(pack(sq, fwd, QUEEN, 0));
            if (!capturesOnly) out.push(pack(sq, fwd, ROOK, 0), pack(sq, fwd, BISHOP, 0), pack(sq, fwd, KNIGHT, 0));
          } else if (!capturesOnly) {
            out.push(pack(sq, fwd, 0, 0));
            if (row === (side === 1 ? 6 : 1) && b[fwd + dir] === 0) out.push(pack(sq, fwd + dir, 0, 3));
          }
        }
        for (let dc = -1; dc <= 1; dc += 2) {
          if (col + dc < 0 || col + dc > 7) continue;
          const to = fwd + dc;
          if (b[to] * side < 0) {
            if (last) out.push(pack(sq, to, QUEEN, 0), pack(sq, to, ROOK, 0), pack(sq, to, BISHOP, 0), pack(sq, to, KNIGHT, 0));
            else out.push(pack(sq, to, 0, 0));
          } else if (to === this.ep) out.push(pack(sq, to, 0, 1));
        }
      } else if (t === KNIGHT || t === KING) {
        for (const to of (t === KNIGHT ? KNIGHT_TO : KING_TO)[sq]) {
          const v = b[to] * side;
          if (v > 0 || (capturesOnly && v === 0)) continue;
          out.push(pack(sq, to, 0, 0));
        }
        if (t === KING && !capturesOnly) this.castles(out);
      } else {
        const rays = RAYS[sq];
        for (let d = t === BISHOP ? 4 : 0, end = t === ROOK ? 4 : 8; d < end; d++) {
          for (const to of rays[d]) {
            const v = b[to] * side;
            if (v === 0) { if (!capturesOnly) out.push(pack(sq, to, 0, 0)); continue; }
            if (v < 0) out.push(pack(sq, to, 0, 0));
            break;
          }
        }
      }
    }
    return out;
  }

  castles(out) {
    const b = this.board, side = this.side;
    const home = side === 1 ? 60 : 4, rook = side * ROOK, short = side === 1 ? 1 : 4, long = side === 1 ? 2 : 8;
    if (!(this.castle & (short | long)) || b[home] !== side * KING || this.attacked(home, -side)) return;
    if ((this.castle & short) && b[home + 1] === 0 && b[home + 2] === 0 && b[home + 3] === rook && !this.attacked(home + 1, -side)) out.push(pack(home, home + 2, 0, 2));
    if ((this.castle & long) && b[home - 1] === 0 && b[home - 2] === 0 && b[home - 3] === 0 && b[home - 4] === rook && !this.attacked(home - 1, -side)) out.push(pack(home, home - 2, 0, 2));
  }

  make(m) {
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7, flag = m >> 15;
    const b = this.board, side = this.side, piece = b[from];
    this.undo.push(b[to], this.castle, this.ep);
    b[from] = 0;
    b[to] = promo ? promo * side : piece;
    if (flag === 1) b[to + (side === 1 ? 8 : -8)] = 0;
    else if (flag === 2) {
      if (to > from) { b[to - 1] = b[to + 1]; b[to + 1] = 0; } else { b[to + 1] = b[to - 2]; b[to - 2] = 0; }
    }
    if (piece === side * KING) this.king[side === 1 ? 0 : 1] = to;
    this.ep = flag === 3 ? (from + to) >> 1 : -1;
    this.castle &= KEEP[from] & KEEP[to];
    this.side = -side;
  }

  unmake(m) {
    const from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7, flag = m >> 15;
    const b = this.board, side = -this.side;
    this.side = side;
    this.ep = this.undo.pop();
    this.castle = this.undo.pop();
    const piece = promo ? side * PAWN : b[to];
    b[to] = this.undo.pop();
    b[from] = piece;
    if (flag === 1) b[to + (side === 1 ? 8 : -8)] = -side * PAWN;
    else if (flag === 2) {
      if (to > from) { b[to + 1] = b[to - 1]; b[to - 1] = 0; } else { b[to - 2] = b[to + 1]; b[to + 1] = 0; }
    }
    if (piece === side * KING) this.king[side === 1 ? 0 : 1] = from;
  }

  /** Material and placement, from the side to move's point of view, in centipawns. */
  evaluate() {
    const b = this.board;
    let score = 0, lead = 0, heavy = 0;
    for (let sq = 0; sq < 64; sq++) {
      const v = b[sq];
      if (v === 0) continue;
      if (v > 0) {
        if (v !== KING) { score += VAL[v] + PST[v][sq]; lead += VAL[v]; if (v !== PAWN) heavy += VAL[v]; }
      } else if (v !== -KING) { score -= VAL[-v] + PST[-v][sq ^ 56]; lead -= VAL[-v]; if (v !== -PAWN) heavy += VAL[-v]; }
    }
    const wk = this.king[0], bk = this.king[1];
    if (heavy > 2600) score += KING_MID[wk] - KING_MID[bk ^ 56];
    else {
      score += KING_END[wk] - KING_END[bk ^ 56];
      // Won endings need a plan a short search cannot find: push the bare king
      // to the edge and walk your own king up to it.
      if (lead >= 300 || lead <= -300) {
        const loser = lead > 0 ? bk : wk;
        const edge = Math.abs(2 * (loser >> 3) - 7) + Math.abs(2 * (loser & 7) - 7); // 2 in the centre, 14 in a corner
        const apart = Math.abs((wk >> 3) - (bk >> 3)) + Math.abs((wk & 7) - (bk & 7));
        score += (lead > 0 ? 1 : -1) * (edge * 6 + (14 - apart) * 5);
      }
    }
    return score * this.side;
  }

  /** Captures and promotions first (biggest victim, smallest attacker), then moves toward better squares. */
  ordered(moves) {
    const b = this.board, side = this.side;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i], from = m & 63, to = (m >> 6) & 63, promo = (m >> 12) & 7;
      const t = b[from] * side, victim = (m >> 15) === 1 ? PAWN : -b[to] * side;
      let s = 100;
      if (victim > 0) s = 3000 + VAL[victim] - (VAL[t] >> 3);
      else if (t !== KING) s += side === 1 ? PST[t][to] - PST[t][from] : PST[t][to ^ 56] - PST[t][from ^ 56];
      if (promo === QUEEN) s += 2500;
      moves[i] = (s < 0 ? 0 : s) * 262144 + m;
    }
    moves.sort((x, y) => y - x);
    for (let i = 0; i < moves.length; i++) moves[i] %= 262144;
    return moves;
  }

  /** Play out the captures so a position is never scored in the middle of an exchange. */
  quiesce(alpha, beta, left) {
    if (++this.nodes >= this.checkAt) this.clock();
    if (this.stop) return 0;
    const stand = this.evaluate();
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (left <= 0) return alpha;
    const mover = this.side, moves = this.ordered(this.gen(true));
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      this.make(m);
      if (this.attacked(this.king[mover === 1 ? 0 : 1], -mover)) { this.unmake(m); continue; }
      const s = -this.quiesce(-beta, -alpha, left - 1);
      this.unmake(m);
      if (this.stop) return 0;
      if (s >= beta) return s;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  /** Negamax with alpha-beta. `ply` is the distance from the root, so nearer mates score higher. */
  search(depth, alpha, beta, ply) {
    if (depth <= 0) return this.quiesce(alpha, beta, QUIESCE_PLIES);
    if (++this.nodes >= this.checkAt) this.clock();
    if (this.stop) return 0;
    const mover = this.side, moves = this.ordered(this.gen(false));
    let best = -INF, any = false;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      this.make(m);
      if (this.attacked(this.king[mover === 1 ? 0 : 1], -mover)) { this.unmake(m); continue; }
      any = true;
      const s = -this.search(depth - 1, -beta, -alpha, ply + 1);
      this.unmake(m);
      if (this.stop) return 0;
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    if (!any) return this.inCheck() ? -MATE + ply : 0; // checkmate, or stalemate
    return best;
  }

  /** Count the legal move sequences of a given length (the standard move generator check). */
  perft(depth) {
    if (depth === 0) return 1;
    const mover = this.side;
    let total = 0;
    for (const m of this.gen(false)) {
      this.make(m);
      if (!this.attacked(this.king[mover === 1 ? 0 : 1], -mover)) total += this.perft(depth - 1);
      this.unmake(m);
    }
    return total;
  }
}

/** For the tests: must equal chess.js's own perft for the same position. */
export const perft = (fen, depth) => new Position(fen).perft(depth);

// The whole think is capped: a depth that has not finished by the deadline is
// dropped and the last finished depth answers. If even depth 1 runs out (it
// never has in measurement), the best of the moves it did score answers.
const BUDGET_MS = 180;
const answer = (m) => ({ move: 'move', args: m.promotion ? [m.from, m.to, m.promotion] : [m.from, m.to] });

/**
 * level: 1 easy (one move ahead, loose, and a random move three times in ten),
 * 2 decent (two plies plus captures), 3 sharp (three plies plus captures, four
 * when the position is small enough to finish in time).
 */
export function bot({ G, seat, level = 2 }) {
  if (!G || G.over || Number(G.turnP) !== seat) return null;
  const legal = legalMoves(G);
  if (legal.length === 0) return null;
  if (legal.length === 1) return answer(legal[0]);
  if (level <= 1 && Math.random() < 0.3) return answer(legal[Math.floor(Math.random() * legal.length)]);
  const mate = legal.find((m) => m.san.endsWith('#'));
  if (mate) return answer(mate);

  const started = Date.now();
  const pos = new Position(G.fen);
  const known = new Set(pos.gen(false));
  const reps = G.reps && typeof G.reps === 'object' ? G.reps : {};
  const roots = [];
  for (const lm of legal) {
    const m = pack(sqIndex(lm.from), sqIndex(lm.to), lm.promotion ? TYPE[lm.promotion] : 0, lm.flags.includes('e') ? 1 : lm.flags.includes('k') || lm.flags.includes('q') ? 2 : lm.flags.includes('b') ? 3 : 0);
    // A legal move the engine cannot follow is skipped for scoring, never for legality.
    if (known.has(m)) roots.push({ lm, m, seen: reps[positionKey(lm.after)] || 0, score: -INF, next: -INF, tie: Math.random() });
  }
  if (roots.length === 0) return answer(legal[Math.floor(Math.random() * legal.length)]);
  roots.sort((a, b) => a.tie - b.tie);

  const maxDepth = level >= 3 ? 4 : level === 2 ? 2 : 1;
  const noise = level >= 3 ? 0 : level === 2 ? 12 : 70; // centipawns the level cannot tell apart
  for (let depth = 1; depth <= maxDepth; depth++) {
    const spent = Date.now() - started;
    if (depth > 1 && spent > BUDGET_MS * (depth > 3 ? 0.12 : 0.6)) break;
    pos.deadline = started + BUDGET_MS;
    let alpha = -INF;
    for (const r of roots) {
      r.next = -INF;
      // Stepping into a position for the third time IS a draw under our rules.
      if (r.seen >= 2) r.next = 0;
      else {
        pos.make(r.m);
        // A move that cannot come within `noise` of the best so far only needs a
        // bound, which lets the search cut it short. A move that repeats a
        // position has its score halved below, so it needs the exact number.
        let s = -pos.search(depth - 1, -INF, r.seen > 0 ? INF : noise - alpha, 1);
        pos.unmake(r.m);
        if (pos.stop) break;
        // Do not shuffle back and forth: a position already seen once is worth half.
        if (r.seen > 0) s = Math.trunc(s / 2);
        r.next = s;
      }
      if (r.next > alpha) alpha = r.next;
    }
    if (pos.stop && depth > 1) break;
    for (const r of roots) r.score = r.next;
    roots.sort((a, b) => b.score - a.score);
    if (pos.stop) break;
  }
  if (noise > 0) {
    for (const r of roots) if (r.score > -INF) r.score += Math.random() * noise;
    roots.sort((a, b) => b.score - a.score);
  }
  return answer(roots[0].lm);
}
