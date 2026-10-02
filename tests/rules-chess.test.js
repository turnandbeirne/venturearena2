// Chess rules: legality, the special moves, every way a game ends, refusals,
// the bot's own move generator pinned against chess.js, and bot playouts.
import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { chess, legalMoves, legalFrom, inCheck, initialState, piecesOf, squareIndex, squareName, positionKey, material, telemetry, START_FEN, MERCY_PLIES, MID_PLY } from '../src/games/chess/rules.js';
import { bot, perft } from '../src/games/chess/bot.js';
import meta from '../src/games/chess/meta.js';
import { createMatch, playout } from '../src/games/sim.js';

/** Play a line given in SAN through the real reducer; throws if a move is not legal. */
function line(m, sans) {
  for (const san of sans.split(/\s+/).filter(Boolean)) {
    const mv = legalMoves(m.G).find((x) => x.san === san);
    if (!mv) throw new Error(`"${san}" is not legal here: ${m.G.fen}`);
    const seat = Number(m.G.turnP);
    const ok = mv.promotion ? m.move(seat, 'move', mv.from, mv.to, mv.promotion) : m.move(seat, 'move', mv.from, mv.to);
    if (!ok) throw new Error(`"${san}" was refused: ${m.G.fen}`);
  }
  return m;
}
/** A hand-built position, shaped like a match in progress, for calling the move directly. */
const position = (fen, extra = {}) => ({ ...initialState(fen), n: 2, log: [], logN: 0, moveN: 0, over: null, resolving: false, ...extra });
const play = (G, from, to, promotion) => chess.moves.move.move({ G, playerID: G.turnP }, from, to, promotion);
const at = (G, sq) => { const p = piecesOf(G.fen)[squareIndex(sq)]; return p ? p.color + p.type : null; };

describe('chess: setup and legality', () => {
  it('starts from the standard position with White (seat 0) to move and 20 legal moves', () => {
    const m = createMatch(chess, 2);
    expect(m.G.fen).toBe(START_FEN);
    expect(m.G.turnP).toBe('0');
    expect(legalMoves(m.G)).toHaveLength(20);
    expect(legalFrom(m.G, 'e2').map((x) => x.to).sort()).toEqual(['e3', 'e4']);
    expect(legalFrom(m.G, 'g1').map((x) => x.to).sort()).toEqual(['f3', 'h3']);
    expect(legalFrom(m.G, 'e7'), 'not Black\'s turn').toEqual([]);
    expect(legalFrom(m.G, 'e4'), 'an empty square').toEqual([]);
    expect(legalFrom(m.G, 'zz')).toEqual([]);
    expect(chess.minPlayers).toBe(2);
    expect(chess.maxPlayers).toBe(2);
  });

  it('reads a FEN into 64 squares, a8 first', () => {
    const p = piecesOf(START_FEN);
    expect(p).toHaveLength(64);
    expect(p[0]).toEqual({ color: 'b', type: 'r' });
    expect(p[squareIndex('e1')]).toEqual({ color: 'w', type: 'k' });
    expect(p[squareIndex('e4')]).toBeNull();
    expect(squareName(0)).toBe('a8');
    expect(squareName(63)).toBe('h1');
    expect(material(START_FEN)).toEqual([39, 39]);
  });

  it('a move changes the position, the turn and the log', () => {
    const m = line(createMatch(chess, 2), 'e4');
    expect(m.G.turnP).toBe('1');
    expect(at(m.G, 'e4')).toBe('wp');
    expect(at(m.G, 'e2')).toBeNull();
    expect(m.G.log[0]).toMatchObject({ t: 'move', p: 0, ply: 1, from: 'e2', to: 'e4', san: 'e4', piece: 'p', cap: null, promo: null });
    expect(legalMoves(m.G)).toHaveLength(20);
    expect(inCheck(m.G)).toBe(false);
  });

  it('you may not leave or put your own king in check', () => {
    const m = line(createMatch(chess, 2), 'e4 e5 Qh5 Nc6 Qxf7+');
    expect(inCheck(m.G)).toBe(true);
    expect(m.move(1, 'move', 'a7', 'a6'), 'ignoring a check').toBe(false);
    expect(legalMoves(m.G).map((x) => x.san)).toEqual(['Kxf7']);
    expect(m.move(1, 'move', 'e8', 'f7')).toBe(true);
    expect(m.G.taken[1]).toEqual(['q']);
  });
});

describe('chess: checkmate', () => {
  it('fool\'s mate: Black (seat 1) wins', () => {
    const m = line(createMatch(chess, 2), 'f3 e5 g4 Qh4#');
    expect(m.G.over).toMatchObject({ placements: [2, 1], reason: 'checkmate' });
    expect(m.G.turnP, 'the turn is not handed over after the end').toBe('1');
    expect(m.G.log.map((e) => e.t)).toEqual(['move', 'move', 'move', 'move', 'over']);
    expect(legalMoves(m.G)).toEqual([]);
    expect(m.move(0, 'move', 'e2', 'e4'), 'nothing moves after the end').toBe(false);
    expect(telemetry(m.G, 1).metrics).toMatchObject({ moves: 2, checks: 1, captures: 0 });
  });

  it('scholar\'s mate: White (seat 0) wins', () => {
    const m = line(createMatch(chess, 2), 'e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#');
    expect(m.G.over).toMatchObject({ placements: [1, 2], reason: 'checkmate' });
    expect(m.G.taken[0]).toEqual(['p']);
  });
});

describe('chess: castling, en passant, promotion', () => {
  it('castles king side through the real move', () => {
    const m = line(createMatch(chess, 2), 'e4 e5 Nf3 Nc6 Bc4 Bc5');
    expect(legalFrom(m.G, 'e1').map((x) => x.to)).toContain('g1');
    expect(m.move(0, 'move', 'e1', 'g1')).toBe(true);
    expect(at(m.G, 'g1')).toBe('wk');
    expect(at(m.G, 'f1')).toBe('wr');
    expect(at(m.G, 'h1')).toBeNull();
    expect(m.G.log[m.G.log.length - 1].san).toBe('O-O');
    expect(telemetry(m.G, 0).metrics.castled).toBe(1);
    expect(m.G.fen.split(' ')[2], 'White has no castling rights left').toBe('kq');
  });

  it('castles queen side, and not through an attacked square', () => {
    const G = position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(play(G, 'e1', 'c1')).toBeUndefined();
    expect(at(G, 'c1')).toBe('wk');
    expect(at(G, 'd1')).toBe('wr');
    expect(at(G, 'a1')).toBeNull();
    expect(play(G, 'e8', 'g8')).toBeUndefined();
    expect(at(G, 'f8')).toBe('br');

    const guarded = position('r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1'); // the f8 rook covers f1
    expect(play(guarded, 'e1', 'g1')).toBe('INVALID_MOVE');
    expect(guarded.fen).toBe('r3kr2/8/8/8/8/8/8/R3K2R w KQq - 0 1');
    expect(play(guarded, 'e1', 'c1')).toBeUndefined();
  });

  it('loses the right to castle once the king has moved', () => {
    const m = line(createMatch(chess, 2), 'e4 e5 Nf3 Nc6 Bc4 Bc5 Ke2 a6 Ke1 a5');
    expect(m.move(0, 'move', 'e1', 'g1')).toBe(false);
  });

  it('en passant takes the pawn that just passed, and only on the next move', () => {
    const m = line(createMatch(chess, 2), 'e4 a6 e5 d5');
    expect(legalFrom(m.G, 'e5').map((x) => x.to).sort()).toEqual(['d6', 'e6']);
    expect(m.move(0, 'move', 'e5', 'd6')).toBe(true);
    expect(at(m.G, 'd6')).toBe('wp');
    expect(at(m.G, 'd5'), 'the captured pawn is gone').toBeNull();
    expect(m.G.taken[0]).toEqual(['p']);
    expect(m.G.log[m.G.log.length - 1]).toMatchObject({ san: 'exd6', cap: 'p' });

    const late = line(createMatch(chess, 2), 'e4 a6 e5 d5 h3 h6');
    expect(late.move(0, 'move', 'e5', 'd6'), 'the chance has passed').toBe(false);
  });

  it('promotes to a queen by default, or to the piece asked for', () => {
    const queen = line(createMatch(chess, 2), 'h4 g5 hxg5 h6 gxh6 Nf6 h7 Rg8');
    expect(legalFrom(queen.G, 'h7').filter((x) => x.to === 'h8').map((x) => x.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    expect(legalFrom(queen.G, 'h7'), 'four ways to promote on h8 and four by taking on g8').toHaveLength(8);
    expect(queen.move(0, 'move', 'h7', 'h8')).toBe(true);
    expect(at(queen.G, 'h8')).toBe('wq');
    expect(queen.G.log[queen.G.log.length - 1]).toMatchObject({ san: 'h8=Q', promo: 'q' });
    expect(telemetry(queen.G, 0).metrics.promotions).toBe(1);

    const knight = line(createMatch(chess, 2), 'h4 g5 hxg5 h6 gxh6 Nf6 h7 Rg8');
    expect(knight.move(0, 'move', 'h7', 'h8', 'k'), 'a king is not a promotion piece').toBe(false);
    expect(knight.move(0, 'move', 'h7', 'h8', 'n')).toBe(true);
    expect(at(knight.G, 'h8')).toBe('wn');

    const taking = position('1n5k/P7/8/8/8/8/8/K7 w - - 0 1');
    expect(play(taking, 'a7', 'b8', 'r')).toBeUndefined();
    expect(at(taking, 'b8')).toBe('wr');
    expect(taking.taken[0]).toEqual(['n']);
  });
});

describe('chess: draws', () => {
  it('stalemate is a draw (shortest known game, through the real moves)', () => {
    const m = line(createMatch(chess, 2), 'e3 a5 Qh5 Ra6 Qxa5 h5 h4 Rah6 Qxc7 f6 Qxd7+ Kf7 Qxb7 Qd3 Qxb8 Qh7 Qxc8 Kg6 Qe6');
    expect(m.G.over).toMatchObject({ placements: [1, 1], reason: 'stalemate' });
    expect(m.G.moveN).toBe(19);
  });

  it('stalemate from a set position', () => {
    const G = position('7k/8/5QK1/8/8/8/8/8 w - - 0 1');
    play(G, 'f6', 'f7');
    expect(G.over).toMatchObject({ placements: [1, 1], reason: 'stalemate' });
  });

  it('the same position three times is a draw', () => {
    const m = line(createMatch(chess, 2), 'Nf3 Nf6 Ng1 Ng8 Nf3 Nf6 Ng1');
    expect(m.G.over, 'twice is not enough').toBeNull();
    expect(m.G.reps[positionKey(START_FEN)]).toBe(2);
    line(m, 'Ng8');
    expect(m.G.over).toMatchObject({ placements: [1, 1], reason: 'repetition' });
    expect(m.G.reps[positionKey(START_FEN)]).toBe(3);
  });

  it('a pawn move or a capture starts the repetition count again', () => {
    const m = line(createMatch(chess, 2), 'Nf3 Nf6 Ng1 Ng8 e4');
    expect(Object.keys(m.G.reps)).toHaveLength(1);
    line(m, 'Nf6 Nf3 Ng8 Ng1 Nf6 Nf3 Ng8');
    expect(m.G.over, 'the position after e4 has been seen twice, and the old start position does not count').toBeNull();
    line(m, 'Ng1');
    expect(m.G.over).toMatchObject({ reason: 'repetition' });
  });

  it('a possible en passant makes a position different', () => {
    // After 1.e4 no black pawn can take on e3, so the key has no en passant square.
    expect(positionKey(line(createMatch(chess, 2), 'e4').G.fen)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -');
    expect(positionKey(line(createMatch(chess, 2), 'e4 a6 e5 d5').G.fen).endsWith(' d6')).toBe(true);
  });

  it('a match that began before the repetition map existed still plays and still draws', () => {
    const G = position(START_FEN);
    delete G.reps; delete G.taken; delete G.stats;
    for (const [from, to] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'], ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']]) expect(play(G, from, to)).toBeUndefined();
    // Counting began with the first move made after the upgrade, so the start position has only been counted twice.
    expect(G.over, 'counting started late, so not yet').toBeNull();
    play(G, 'g1', 'f3'); // the position after Nf3: plies 1, 5 and 9
    expect(G.over).toMatchObject({ reason: 'repetition' });
    expect(G.taken).toEqual([[], []]);
  });

  it('fifty moves without a capture or a pawn move is a draw', () => {
    const G = position('k7/8/8/8/8/8/8/K6R w - - 99 80');
    play(G, 'h1', 'h2');
    expect(G.over).toMatchObject({ placements: [1, 1], reason: 'fifty-move' });
    const early = position('k7/8/8/8/8/8/8/K6R w - - 97 80');
    play(early, 'h1', 'h2');
    expect(early.over).toBeNull();
  });

  it('checkmate on the hundredth quiet half-move is still a win', () => {
    const G = position('k7/8/1K6/8/8/8/8/7R w - - 99 90');
    play(G, 'h1', 'h8');
    expect(G.over).toMatchObject({ placements: [1, 2], reason: 'checkmate' });
  });

  it('not enough material to mate is a draw', () => {
    const G = position('k7/8/8/8/8/8/1p6/K7 w - - 0 1');
    play(G, 'a1', 'b2');
    expect(G.over).toMatchObject({ placements: [1, 1], reason: 'material' });
  });

  it('the mercy limit draws the game at 300 plies', () => {
    const G = position(START_FEN, { moveN: MERCY_PLIES - 1 });
    play(G, 'e2', 'e4');
    expect(G.over).toMatchObject({ placements: [1, 1], reason: 'mercy' });
    const before = position(START_FEN, { moveN: MERCY_PLIES - 2 });
    play(before, 'e2', 'e4');
    expect(before.over).toBeNull();
  });
});

describe('chess: refusals', () => {
  it('refuses out-of-turn, illegal and malformed moves and changes nothing', () => {
    const m = createMatch(chess, 2);
    expect(m.move(1, 'move', 'e7', 'e5'), 'Black moving first').toBe(false);
    expect(m.move(0, 'move', 'e7', 'e5'), 'White moving a black pawn').toBe(false);
    expect(m.move(0, 'move', 'e2', 'e5'), 'a pawn does not go three squares').toBe(false);
    expect(m.move(0, 'move', 'a1', 'a4'), 'a rook does not jump').toBe(false);
    expect(m.move(0, 'move', 'e1', 'g1'), 'no castling through pieces').toBe(false);
    expect(m.move(0, 'move', 'e4', 'e5'), 'an empty square').toBe(false);
    expect(m.move(0, 'move', 'e2', 'z9')).toBe(false);
    expect(m.move(0, 'move', 'e2')).toBe(false);
    expect(m.move(0, 'move', 12, 28)).toBe(false);
    expect(m.move(0, 'move', { from: 'e2', to: 'e4' })).toBe(false);
    expect(m.move(0, 'move', 'e2', 'e4', 'x'), 'a bad promotion piece').toBe(false);
    expect(m.G.fen).toBe(START_FEN);
    expect(m.G.moveN).toBe(0);
    expect(m.G.log).toHaveLength(0);
    expect(m.move(0, 'move', 'e2', 'e4')).toBe(true);
    expect(m.move(0, 'move', 'd2', 'd4'), 'two moves in a row').toBe(false);
  });

  it('resign ends the game for the other seat, even out of turn', () => {
    const m = line(createMatch(chess, 2), 'e4');
    expect(m.move(0, 'resign')).toBe(true);
    expect(m.G.over).toMatchObject({ placements: [2, 1], reason: 'resign' });
    expect(m.move(1, 'move', 'e7', 'e5')).toBe(false);
    const other = line(createMatch(chess, 2), 'e4');
    expect(other.move(1, 'resign')).toBe(true);
    expect(other.G.over.placements).toEqual([1, 2]);
  });

  it('G stays plain JSON, with no chess.js objects in it', () => {
    const m = line(createMatch(chess, 2), 'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 c6 Nf3 Bg4');
    expect(JSON.parse(JSON.stringify(m.G))).toEqual(m.G);
    expect(typeof m.G.fen).toBe('string');
    for (const mv of legalMoves(m.G)) expect(Object.getPrototypeOf(mv)).toBe(Object.prototype);
  });

  it('records material at the midpoint for the arena', () => {
    const G = position('k7/8/8/8/8/8/8/KQ5R w - - 0 1', { moveN: MID_PLY - 1 });
    play(G, 'h1', 'h2');
    expect(G.mid).toBe(14);
    expect(telemetry(G, 0)).toMatchObject({ midRank: 1, metrics: { materialLead: 14 } });
    expect(telemetry(G, 1)).toMatchObject({ midRank: 2, metrics: { materialLead: -14 } });
    expect(telemetry(createMatch(chess, 2).G, 0).midRank).toBeUndefined();
  });
});

describe('chess: bot', () => {
  const POSITIONS = [
    START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', // castling, pins, promotions near
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', // en passant and discovered checks
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', // promotions with capture
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 b - - 0 10',
  ];

  it('its own move generator agrees with chess.js (perft to depth 3)', () => {
    for (const fen of POSITIONS) {
      const ref = new Chess(fen);
      for (let depth = 1; depth <= 3; depth++) expect(perft(fen, depth), `${fen} depth ${depth}`).toBe(ref.perft(depth));
    }
  });

  it('only ever returns a legal move, at every level', () => {
    for (const fen of POSITIONS) {
      const G = position(fen);
      for (let level = 1; level <= 3; level++) {
        for (let i = 0; i < (level === 1 ? 8 : 2); i++) {
          const act = bot({ G, seat: Number(G.turnP), level });
          expect(act.move).toBe('move');
          const [from, to, promotion] = act.args;
          expect(legalMoves(G).some((x) => x.from === from && x.to === to && (x.promotion || undefined) === promotion), `${fen}: ${JSON.stringify(act.args)}`).toBe(true);
        }
      }
    }
  });

  it('does nothing when it is not its turn or the game is over', () => {
    const m = createMatch(chess, 2);
    expect(bot({ G: m.view(1), seat: 1 })).toBeNull();
    line(m, 'f3 e5 g4 Qh4#');
    expect(bot({ G: m.view(0), seat: 0 })).toBeNull();
  });

  it('takes a mate in one, and a free queen', () => {
    const mate = position('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
    for (const level of [2, 3]) expect(bot({ G: mate, seat: 0, level }).args).toEqual(['a1', 'a8']);
    const hanging = position('r1b1kbnr/pppp1ppp/2n5/4p1q1/4P3/3P1N2/PPP2PPP/RNBQKB1R w KQkq - 0 1');
    for (const level of [2, 3]) expect(bot({ G: hanging, seat: 0, level }).args[1], `level ${level} takes the queen on g5`).toBe('g5');
  });

  it('does not stalemate a bare king when it can keep winning', () => {
    // Qf7 or Qg6-style moves that leave Black no move would throw the win away.
    const G = position('7k/8/5QK1/8/8/8/8/8 w - - 0 1');
    for (const level of [2, 3]) {
      play(G, ...bot({ G, seat: 0, level }).args);
      expect(G.over === null || G.over.reason === 'checkmate', `level ${level}: ${G.fen}`).toBe(true);
      Object.assign(G, position('7k/8/5QK1/8/8/8/8/8 w - - 0 1'));
    }
  });

  it('answers well inside 400 ms at every level, even in a crowded position', () => {
    const G = position(POSITIONS[1]);
    bot({ G, seat: 0, level: 3 }); // warm the JIT so we time the bot, not the compiler
    for (let level = 1; level <= 3; level++) {
      const t = Date.now();
      bot({ G, seat: 0, level });
      expect(Date.now() - t, `level ${level}`).toBeLessThan(400);
    }
  });

  it('bots reach a result with valid placements (3 games)', () => {
    for (let round = 0; round < 3; round++) {
      const m = playout({ game: chess, bot, numSeats: 2 });
      const over = m.G.over;
      expect(over, 'game ended').toBeTruthy();
      expect(over.placements).toHaveLength(2);
      expect(Math.min(...over.placements)).toBe(1);
      for (const p of over.placements) expect([1, 2]).toContain(p);
      expect(['checkmate', 'stalemate', 'material', 'repetition', 'fifty-move', 'mercy']).toContain(over.reason);
      expect(over.reason === 'checkmate').toBe(over.placements[0] !== over.placements[1]);
      expect(m.G.moveN).toBeLessThanOrEqual(MERCY_PLIES);
      expect(m.G.log.length).toBeLessThanOrEqual(80);
      const ns = m.G.log.map((e) => e.n);
      expect([...ns].sort((a, b) => a - b)).toEqual(ns);
      expect(JSON.parse(JSON.stringify(m.G))).toEqual(m.G);
      for (let s = 0; s < 2; s++) {
        const t = telemetry(m.G, s);
        expect(t.skillTags.length).toBeGreaterThanOrEqual(2);
        expect(t.metrics.moves).toBe(m.G.stats[s].moves);
      }
      expect(m.G.stats[0].moves + m.G.stats[1].moves).toBe(m.G.moveN);
    }
  });

  it('a sharp bot does not lose to an easy one', () => {
    // Measured: 14 wins by checkmate in 14 games. Asserting "never loses" keeps a rare draw from failing the build.
    const m = playout({ game: chess, bot: (a) => bot({ ...a, level: a.seat === 0 ? 1 : 3 }), numSeats: 2 });
    expect(m.G.over.placements[1]).toBe(1);
  });
});

describe('chess: metadata', () => {
  it('has everything the lobby, the how-to panel and the SEO page read', () => {
    expect(meta).toMatchObject({ id: 'chess', name: 'Chess', family: 'classic', seats: { min: 2, max: 2 } });
    expect(meta.skills).toHaveLength(3);
    expect(meta.howTo.length).toBeGreaterThanOrEqual(3);
    expect(meta.howTo.length).toBeLessThanOrEqual(6);
    expect(meta.reflection).toHaveLength(3);
    expect(typeof meta.paceSec).toBe('number');
    expect(meta.seo.strategy.length).toBeGreaterThanOrEqual(3);
    expect([...meta.icon]).toHaveLength(1);
    expect(JSON.stringify(meta)).not.toMatch(/—/); // no em dashes in the copy
  });
});
