// What happens when a game ends: Elo, results, stats, points, reputation, the
// play-style read, the debrief, peer feedback, vouching and records.
import { describe, it, expect, vi } from 'vitest';
import { makeArena, guest, member, playToEnd, tick } from './helpers.js';
import { eloDeltas } from '../src/server/arena/play.js';
import { personaLabel, PERSONAS, styleInsight, skillRank, arenaRank, repBand, CHIPS, STYLE_DIMS } from '../src/shared/profile.js';
import { getGame } from '../src/games/registry.js';

const GAME = 'fourinarow';
const DAY = 86400000;
const err = async (p) => { try { await p; } catch (e) { return e; } throw new Error('expected the call to be refused'); };
const drop = (A, id, seat, col) => A.bgio.submit(id, GAME, seat, 'drop', [col]);
/** Seat `winner` lines up four in column 0. `secs` is how long each move takes on the injected clock. */
async function winFor(A, id, winner, secs = 0) {
  const moves = winner === 0 ? [[0, 0], [1, 1], [0, 0], [1, 1], [0, 0], [1, 1], [0, 0]] : [[0, 1], [1, 0], [0, 1], [1, 0], [0, 2], [1, 0], [0, 2], [1, 0]];
  for (const [seat, col] of moves) { A.advance(secs * 1000); expect(await drop(A, id, seat, col)).toBe(true); }
  await tick(5);
}
/** Seat two members at a started table. */
async function table(A, a, b, extra = []) {
  const { table: t } = await A.call('createTable', a, { gameId: GAME });
  await A.call('joinTable', b, { id: t.id });
  for (const o of extra) await A.call('joinTable', o, { id: t.id });
  await A.call('startTable', a, { id: t.id });
  return t.id;
}
async function game(A, a, b, winner = 0, opts = {}) {
  const id = await table(A, a, b, opts.watch || []);
  if (opts.before) await opts.before(id);
  await winFor(A, id, winner, opts.secs || 0);
  return id;
}
/** End a started table with a fabricated final state (for outcomes that are slow to play out, like a draw). */
async function endWith(A, id, placements, extra = {}) {
  const st = A.bgio.state(id);
  await A.hooks.matchOver(A.c.tables.get(id), { G: { ...st.G, over: { placements, reason: 'draw', ...extra } }, ctx: {} });
}

describe('eloDeltas', () => {
  const H = (rating, games, placement) => ({ rating, games, placement, human: true });
  const B = (placement, rating = 1200) => ({ rating, games: 0, placement, human: false });

  it('a 1200 player beating a bot gains about 4; losing costs 4; bots never move', () => {
    expect(eloDeltas([H(1200, 0, 1), B(2)])).toEqual([4, 0]);
    expect(eloDeltas([H(1200, 0, 2), B(1)])).toEqual([-4, 0]);
    expect(eloDeltas([H(1200, 50, 1), B(2)])).toEqual([4, 0]); // K=8 against a bot whatever your experience
  });

  it('a bot always counts as 1200, so a strong player gains almost nothing from it', () => {
    expect(eloDeltas([H(1600, 30, 1), B(2, 2000)])).toEqual([1, 0]);
    expect(eloDeltas([H(1600, 30, 2), B(1, 2000)])).toEqual([-7, 0]);
  });

  it('two people: K=40 for the first ten games, then 20', () => {
    expect(eloDeltas([H(1200, 0, 1), H(1200, 0, 2)])).toEqual([20, -20]);
    expect(eloDeltas([H(1200, 9, 1), H(1200, 9, 2)])).toEqual([20, -20]);
    expect(eloDeltas([H(1200, 10, 1), H(1200, 10, 2)])).toEqual([10, -10]);
    // Each side uses its own K: a newcomer beating a veteran.
    expect(eloDeltas([H(1200, 2, 1), H(1200, 40, 2)])).toEqual([20, -10]);
  });

  it('a draw moves equal ratings nowhere and unequal ones toward each other', () => {
    expect(eloDeltas([H(1200, 0, 1), H(1200, 0, 1)])).toEqual([0, 0]);
    expect(eloDeltas([H(1400, 0, 1), H(1200, 0, 1)])).toEqual([-10, 10]);
  });

  it('an upset pays more than an expected win', () => {
    const [up] = eloDeltas([H(1200, 20, 1), H(1600, 20, 2)]);
    const [expected] = eloDeltas([H(1600, 20, 1), H(1200, 20, 2)]);
    expect(up).toBe(18);
    expect(expected).toBe(2);
  });

  it('more seats: K is shared across the human opponents, bots add their own 8', () => {
    expect(eloDeltas([H(1200, 0, 1), H(1200, 0, 2), B(3)])).toEqual([24, -16, 0]);
    expect(eloDeltas([H(1200, 0, 1), H(1200, 0, 2), H(1200, 0, 3)])).toEqual([20, 0, -20]);
    const four = eloDeltas([H(1200, 12, 1), H(1200, 12, 2), H(1200, 12, 3), H(1200, 12, 4)]);
    expect(four).toEqual([10, 3, -3, -10]);
    expect(four.reduce((x, y) => x + y, 0)).toBe(0);
  });
});

describe('recording a result', () => {
  it('two people: ratings, stats, points and reputation all move, once', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await guest(A, 'Bob');
    const pa = a.points; const pb = b.points;
    const id = await game(A, a, b, 0);
    const t = A.c.tables.get(id);
    expect(t.status).toBe('finished');
    expect(t.endedAt).toBe(A.now());
    expect(t.result).toMatchObject({ placements: [1, 2], reason: 'win' });
    expect(t.result.summary.map((s) => [s.seat, s.userId, s.placement, s.bot])).toEqual([[0, a.id, 1, false], [1, b.id, 2, false]]);

    const ra = A.c.results.get(`${id}:${a.id}`); const rb = A.c.results.get(`${id}:${b.id}`);
    expect(ra).toMatchObject({ tableId: id, userId: a.id, gameId: GAME, seat: 0, placement: 1, players: 2, humans: 2, ratingBefore: 1200, ratingAfter: 1220, won: true, takeover: null });
    expect(rb).toMatchObject({ seat: 1, placement: 2, ratingBefore: 1200, ratingAfter: 1180, won: false });
    expect(ra.metrics).toMatchObject({ moves: 4, centerShare: 0 });
    expect(ra.skillTags).toContain('positioning');

    expect(A.c.ratings.get(`${a.id}:${GAME}`)).toMatchObject({ rating: 1220, games: 1, wins: 1 });
    expect(A.c.ratings.get(`${b.id}:${GAME}`)).toMatchObject({ rating: 1180, games: 1, wins: 0 });
    expect(A.ratingOf(a.id, GAME)).toBe(1220);
    expect(a.stats).toEqual({ games: 1, wins: 1, best: 1220, avg: 1220 });
    expect(b.stats).toEqual({ games: 1, wins: 0, best: 1180, avg: 1180 });
    expect(a.points - pa).toBe(25); // game_won
    expect(b.points - pb).toBe(10); // game_played: guests earn too
    expect(A.c.points.get(`${a.id}:game_won:${id}`)).toMatchObject({ points: 25, ref: id });
    expect(a.reputation.score).toBe(102);
    expect(b.reputation.score).toBe(102);

    // Recording twice must be impossible, however it is triggered.
    const state = A.bgio.state(id);
    await Promise.all([A.hooks.matchOver(t, state), A.hooks.matchOver(t, state)]);
    A.hooks.matchState(id, state, []);
    await tick(5);
    expect(A.c.results.count((r) => r.tableId === id)).toBe(2);
    expect(A.ratingOf(a.id, GAME)).toBe(1220);
    expect(a.points - pa).toBe(25);
    expect(a.reputation.score).toBe(102);
    expect(a.stats.games).toBe(1);
  });

  it('bots get no result row, no rating row and no points', async () => {
    const A = makeArena();
    const me = await member(A, 'Ada');
    const { table: t } = await A.call('playBots', me, { gameId: GAME, level: 1 });
    await playToEnd(A, t.id); await tick(20);
    expect(A.c.results.count((r) => r.tableId === t.id)).toBe(1);
    expect(A.c.results.all()[0].userId).toBe(me.id);
    expect(A.c.ratings.size).toBe(1);
    expect(A.c.points.count((p) => p.ref === t.id)).toBe(1);
    const r = A.c.results.get(`${t.id}:${me.id}`);
    expect(r).toMatchObject({ players: 2, humans: 1 });
    expect(Math.abs(r.ratingAfter - 1200)).toBeLessThanOrEqual(4); // K=8 against a bot
    const row = A.c.tables.get(t.id).result.summary.find((s) => s.bot);
    expect(row).toMatchObject({ userId: null, bot: true });
  });

  it('everyone tying is a draw: nobody "won", everybody played', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const pa = a.points;
    const id = await table(A, a, b);
    await endWith(A, id, [1, 1]);
    expect(A.c.results.get(`${id}:${a.id}`)).toMatchObject({ placement: 1, won: false, ratingAfter: 1200 });
    expect(A.c.ratings.get(`${a.id}:${GAME}`)).toMatchObject({ games: 1, wins: 0 });
    expect(a.points - pa).toBe(10);
    expect(a.stats).toMatchObject({ games: 1, wins: 0 });
    expect((await A.call('debrief', a, { id })).mine.won).toBe(false);
  });

  it('K drops to 20 once a player has ten games of that game behind them', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    A.c.ratings.put({ id: `${a.id}:${GAME}`, userId: a.id, gameId: GAME, rating: 1200, games: 10, wins: 5 });
    const id = await game(A, a, b, 0);
    expect(A.c.results.get(`${id}:${a.id}`).ratingAfter).toBe(1210);
    expect(A.c.results.get(`${id}:${b.id}`).ratingAfter).toBe(1180);
    expect(A.c.ratings.get(`${a.id}:${GAME}`)).toMatchObject({ games: 11, wins: 6 });
  });

  it('stats: best is the highest rating, avg is weighted by games, across every game played', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    A.c.ratings.put({ id: `${a.id}:other`, userId: a.id, gameId: 'other', rating: 1500, games: 3, wins: 2 });
    await game(A, a, b, 1); // Alice loses one game of Four in a Row: 1180 over 1 game
    expect(a.stats).toEqual({ games: 4, wins: 2, best: 1500, avg: Math.round((1500 * 3 + 1180) / 4) });
    expect(A.card(a, b)).toMatchObject({ rating: a.stats.avg, games: 4, wins: 2 });
  });

  it('a result is kept even if the game has no telemetry or it throws', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await table(A, a, b);
    const g = getGame(GAME);
    const original = g.telemetry;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    g.telemetry = () => { throw new Error('boom'); };
    try { await endWith(A, id, [2, 1], { reason: 'win' }); } finally { g.telemetry = original; quiet.mockRestore(); }
    expect(A.c.results.get(`${id}:${b.id}`)).toMatchObject({ won: true, metrics: {}, skillTags: [] });
    expect(A.c.tables.get(id).status).toBe('finished');
  });

  it('only the rules end a game: a "gameover" the rules did not write (no G.over) records nothing', async () => {
    // boardgame.io will end a match on an endGame event with whatever result the sender supplies.
    // The socket guard stops those arriving; this is the second lock on the same door.
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await table(A, a, b);
    const st = A.bgio.state(id);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    await A.hooks.matchOver(A.c.tables.get(id), { G: st.G, ctx: { ...st.ctx, gameover: { placements: [2, 1], reason: 'win' } } });
    quiet.mockRestore();
    expect(A.c.results.count((r) => r.tableId === id)).toBe(0);
    expect(A.c.ratings.size).toBe(0);
    expect(b.stats.wins).toBe(0);
    expect(A.c.tables.get(id).status).toBe('abandoned');
    expect((await err(A.call('debrief', a, { id }))).status).toBe(404);
  });

  it('scores from the game are carried into the summary', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await table(A, a, b);
    await endWith(A, id, [2, 1], { scores: [30, 70], reason: 'win' });
    expect(A.c.tables.get(id).result.scores).toEqual([30, 70]);
    expect(A.c.results.get(`${id}:${b.id}`).score).toBe(70);
    const d = await A.call('debrief', a, { id });
    expect(d.standings.map((s) => [s.name, s.placement, s.score])).toEqual([['Bob', 1, 70], ['Alice', 2, 30]]);
  });
});

describe('play style', () => {
  it('personaLabel: first matching rule wins, in the published order', () => {
    const base = { risk: 50, horizon: 50, negotiation: 50, cooperation: 50, speed: 50, resilience: 50 };
    const L = (patch) => personaLabel({ ...base, ...patch });
    expect(L({})).toBe('Explorer');
    expect(L({ negotiation: 65 })).toBe('Dealmaker');
    expect(L({ negotiation: 64 })).toBe('Explorer');
    expect(L({ risk: 65, speed: 60 })).toBe('Wildcard');
    expect(L({ risk: 65, speed: 59 })).toBe('Explorer');
    expect(L({ cooperation: 70 })).toBe('Connector');
    expect(L({ resilience: 68 })).toBe('Closer');
    expect(L({ horizon: 60, cooperation: 55 })).toBe('Builder');
    expect(L({ horizon: 60, cooperation: 54 })).toBe('Strategist');
    expect(L({ risk: 40, speed: 55 })).toBe('Operator');
    expect(L({ risk: 40, speed: 56 })).toBe('Explorer');
    // Precedence.
    expect(L({ negotiation: 90, risk: 90, speed: 90, cooperation: 90, resilience: 90, horizon: 90 })).toBe('Dealmaker');
    expect(L({ risk: 90, speed: 90, cooperation: 90, resilience: 90, horizon: 90 })).toBe('Wildcard');
    expect(L({ cooperation: 90, resilience: 90, horizon: 90 })).toBe('Connector');
    expect(L({ resilience: 90, horizon: 90 })).toBe('Closer');
    for (const label of ['Dealmaker', 'Wildcard', 'Connector', 'Closer', 'Builder', 'Strategist', 'Operator', 'Explorer']) expect(PERSONAS[label]).toBeTruthy();
    expect(STYLE_DIMS).toEqual(['risk', 'horizon', 'negotiation', 'cooperation', 'speed', 'resilience']);
  });

  it('styleInsight reads one game', () => {
    expect(styleInsight(null)).toBe(null);
    expect(styleInsight({ negotiation: 70 })).toMatch(/Dealmaker/);
    expect(styleInsight({ risk: 70 })).toMatch(/Wildcard/);
    expect(styleInsight({ horizon: 60 })).toMatch(/long-horizon/);
    expect(styleInsight({ resilience: 68 })).toMatch(/Closer/);
    expect(styleInsight({ risk: 30, speed: 50 })).toMatch(/Operator/);
    expect(styleInsight({ speed: 80 })).toMatch(/Fast turns/);
    expect(styleInsight({ speed: 60 })).toMatch(/still taking shape/);
  });

  it('signals: speed from the median think time, cooperation from chat, resigning costs cooperation', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    // 8 seconds a move is the default pace: speed 50. Alice says three things.
    const id = await game(A, a, b, 0, { secs: 8, before: async (tid) => { for (let i = 0; i < 3; i++) await A.call('sendChat', a, { id: tid, body: `gl ${i}` }); } });
    const ra = A.c.results.get(`${id}:${a.id}`); const rb = A.c.results.get(`${id}:${b.id}`);
    expect(ra.signals).toEqual({ speed: 50, cooperation: 35 + 3 * 8 });
    expect(rb.signals).toEqual({ speed: 50, cooperation: 35 });
    expect((await A.call('debrief', a, { id })).mine.signals).toEqual(ra.signals);

    // Faster is higher, slower is lower, both clamped to 0..100; chat counts up to eight lines.
    const fast = await game(A, a, b, 0, { secs: 2, before: async (tid) => { A.advance(61000); for (let i = 0; i < 12; i++) await A.call('sendChat', a, { id: tid, body: `l${i}` }); } });
    expect(A.c.results.get(`${fast}:${a.id}`).signals).toEqual({ speed: 100, cooperation: 99 });
    const slow = await game(A, a, b, 0, { secs: 64 });
    expect(A.c.results.get(`${slow}:${a.id}`).signals.speed).toBe(0);

    // Resigning: -30 cooperation.
    const quit = await table(A, a, b);
    await A.call('leaveTable', b, { id: quit }); await tick(10);
    expect(A.c.results.get(`${quit}:${b.id}`).signals.cooperation).toBe(5);
  });

  it('the persona is a running mean over the games that measured each dimension', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    await game(A, a, b, 0, { secs: 8 }); // speed 50, cooperation 35
    expect(a.persona).toMatchObject({ games: 1, speed: 50, cooperation: 35, risk: 50, horizon: 50, negotiation: 50, resilience: 50, label: 'Explorer' });
    expect(a.persona.counts).toEqual({ speed: 1, cooperation: 1 });
    await game(A, a, b, 0, { secs: 2, before: async (tid) => { A.advance(61000); for (let i = 0; i < 8; i++) await A.call('sendChat', a, { id: tid, body: `l${i}` }); } }); // speed 100, cooperation 99
    expect(a.persona).toMatchObject({ games: 2, speed: 75, cooperation: 67, label: 'Explorer' });
    await game(A, a, b, 0, { secs: 2, before: async (tid) => { A.advance(61000); for (let i = 0; i < 8; i++) await A.call('sendChat', a, { id: tid, body: `l${i}` }); } });
    expect(a.persona).toMatchObject({ games: 3, speed: Math.round((75 * 2 + 100) / 3), cooperation: Math.round((67 * 2 + 99) / 3), label: 'Connector' });
    expect(a.playStyle).toBe(`Connector: ${PERSONAS.Connector} Wins more than half their games.`);
    expect(b.playStyle).toBe(`Explorer: ${PERSONAS.Explorer}`);
    expect(A.card(a, b).personaLabel).toBe('Connector');
  });

  it('after five games the arena may SUGGEST an archetype; it never changes the label the member chose', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice', { archetype: 'builder' }); const b = await member(A, 'Bob'); // Bob never did the card sort
    const chatty = async (tid) => { A.advance(61000); for (let i = 0; i < 6; i++) { await A.call('sendChat', a, { id: tid, body: `l${i}` }); await A.call('sendChat', b, { id: tid, body: `l${i}` }); } };
    for (let n = 1; n <= 4; n++) {
      await game(A, a, b, 0, { before: chatty });
      expect(a.persona.label).toBe('Connector');
      expect(a.suggestedArchetype, `after ${n} games`).toBe(null);
    }
    await game(A, a, b, 0, { before: chatty });
    expect(a.persona.games).toBe(5);
    expect(a.suggestedArchetype).toBe('backer'); // Connector plays like a Backer
    expect(a.archetype).toBe('builder');
    expect(b.archetype).toBe(null);
    expect(b.suggestedArchetype).toBe(null); // nothing to compare with: no suggestion
    // Only the member sees the suggestion.
    expect((await A.call('profile', a, {})).suggestedArchetype).toBe('backer');
    expect((await A.call('profile', b, { id: a.id })).suggestedArchetype).toBeUndefined();
    expect(A.card(a, b).archetype).toBe('builder');

    // "Keep mine" clears the suggestion and keeps the label.
    const kept = await A.call('keepArchetype', a, {});
    expect(kept.user.archetype).toBe('builder');
    expect(kept.user.suggestedArchetype).toBe(null);
    // The next game suggests again; switching is the member's own act.
    await game(A, a, b, 0, { before: chatty });
    expect(a.archetype).toBe('builder');
    expect(a.suggestedArchetype).toBe('backer');
    const switched = await A.call('keepArchetype', a, { switch: true });
    expect(switched.user.archetype).toBe('backer');
    expect(switched.user.suggestedArchetype).toBe(null);
    await game(A, a, b, 0, { before: chatty });
    expect(a.suggestedArchetype).toBe(null); // label and play now agree
    // Asking to switch with nothing suggested changes nothing.
    expect((await A.call('keepArchetype', b, { switch: true })).user.archetype).toBe(null);
  });
});

describe('the debrief', () => {
  it('standings, my result, and whether I watched', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol'); const out = await guest(A);
    const id = await table(A, a, b, [c]);
    expect((await err(A.call('debrief', a, { id }))).status).toBe(404); // not finished yet
    await winFor(A, id, 1);
    const d = await A.call('debrief', a, { id });
    expect(d.table).toMatchObject({ id, gameId: GAME, gameName: 'Four in a Row', reason: 'win' });
    expect(d.standings.map((s) => [s.placement, s.name, s.ratingBefore, s.ratingAfter, s.rank.name])).toEqual([[1, 'Bob', 1200, 1220, 'Operator'], [2, 'Alice', 1200, 1180, 'Operator']]);
    expect(d.standings[0].card.id).toBe(b.id);
    expect(d.mine).toMatchObject({ placement: 2, won: false, ratingBefore: 1200, ratingAfter: 1180, games: 1, wins: 0 });
    expect(d.watched).toBe(false);
    const db = await A.call('debrief', b, { id });
    expect(db.mine).toMatchObject({ placement: 1, won: true });
    expect(db.mine.observations).toContain('Won against 1 other');
    expect(typeof db.mine.insight).toBe('string');
    expect(await A.call('debrief', c, { id })).toMatchObject({ mine: null, watched: true });
    expect(await A.call('debrief', out, { id })).toMatchObject({ mine: null, watched: false }); // a public game can be read by anyone
    expect((await err(A.call('debrief', a, { id: 'nope' }))).status).toBe(404);
    expect((await err(A.call('debrief', a, {}))).status).toBe(404);
  });

  it('a resigned game says so in the observations', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const id = await table(A, a, b);
    await A.call('leaveTable', b, { id }); await tick(10);
    const d = await A.call('debrief', b, { id });
    expect(d.mine.observations).toContain('A bot finished this game after you resigned');
    expect(d.standings.find((s) => s.userId === b.id).takeover).toBe('resigned');
  });

  it('the lesson: a one-sentence teaser for free members, the whole thing for Subscribers', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob', { tier: 'member' }); const g = await guest(A, 'Gus');
    const id = await table(A, a, b, [g]);
    await winFor(A, id, 0);
    const lesson = getGame(GAME).meta.lesson;
    const free = await A.call('debrief', a, { id });
    expect(free.lessonLocked).toBe(true);
    expect(free.lesson).toBe(`${lesson.split('. ')[0]}.`);
    expect(free.lesson.length).toBeLessThan(lesson.length);
    expect(lesson.startsWith(free.lesson)).toBe(true);
    expect(await A.call('debrief', g, { id })).toMatchObject({ lessonLocked: true, lesson: free.lesson });
    const paid = await A.call('debrief', b, { id });
    expect(paid).toMatchObject({ lessonLocked: false, lesson });
    // A lapsed plan reads the teaser again.
    b.tierExpiresAt = A.now() - 1;
    expect((await A.call('debrief', b, { id })).lessonLocked).toBe(true);
  });

  it('the reflection question is the same for everyone at a table and comes from the game', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const qs = getGame(GAME).meta.reflection;
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      const id = await game(A, a, b, i % 2);
      const q1 = (await A.call('debrief', a, { id })).question;
      expect(qs).toContain(q1);
      expect((await A.call('debrief', b, { id })).question).toBe(q1);
      expect((await A.call('debrief', a, { id })).question).toBe(q1);
      seen.add(q1);
    }
    expect(seen.size).toBeGreaterThanOrEqual(1);
  });

  it('one answer per person: an edit replaces it; only people who were at the table answer', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await guest(A, 'Carol'); const out = await member(A, 'Out');
    const id = await table(A, a, b, [c]);
    expect((await err(A.call('answerDebrief', a, { id, answer: 'too early' }))).status).toBe(403);
    await winFor(A, id, 0);
    await A.call('answerDebrief', a, { id, answer: 'I should have blocked column 0.' });
    A.advance(1000);
    await A.call('answerDebrief', b, { id, answer: `  ${'x'.repeat(700)}` });
    A.advance(1000);
    await A.call('answerDebrief', c, { id, answer: 'Watching was fun' }); // observers join the debrief
    A.advance(1000);
    await A.call('answerDebrief', a, { id, answer: 'On reflection: play the centre.' });
    const d = await A.call('debrief', b, { id });
    expect(d.answers.map((x) => [x.name, x.answer.slice(0, 12)]).sort()).toEqual([['Alice', 'On reflectio'], ['Bob', 'xxxxxxxxxxxx'], ['Carol', 'Watching was']]);
    expect(d.answers.find((x) => x.userId === b.id).answer).toHaveLength(500);
    expect(A.c.debriefs.count((x) => x.tableId === id)).toBe(3);
    expect(a.reputation.debriefs).toBe(1); // counted once, however many edits
    expect(a.reputation.score).toBe(102); // answering is not worth reputation points by itself
    expect((await err(A.call('answerDebrief', out, { id, answer: 'me too' }))).status).toBe(403);
    expect((await err(A.call('answerDebrief', a, { id, answer: '   ' }))).message).toMatch(/sentence/);
    expect((await err(A.call('answerDebrief', a, { id, answer: { text: 'x' } }))).message).toMatch(/sentence/);
    expect(A.events.some((e) => e.room === `t:${id}` && e.event === 'debrief')).toBe(true);
    // The stored question is the one the table was asked.
    expect(A.c.debriefs.get(`${id}:${a.id}`).question).toBe(d.question);
  });
});

describe('peer feedback: one word and kudos', () => {
  async function finished(A) {
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol'); const out = await member(A, 'Out');
    const id = await table(A, a, b, [c]);
    return { a, b, c, out, id };
  }

  it('only after the game, only from people who were there, only to people who played', async () => {
    const A = makeArena();
    const { a, b, c, out, id } = await finished(A);
    // Kudos are for a game that was played, not for sitting down.
    expect((await err(A.call('giveFeedback', a, { id, toId: b.id, kudos: true }))).status).toBe(403);
    expect(b.reputation.kudos).toBe(0);
    await winFor(A, id, 0);
    expect((await err(A.call('giveFeedback', out, { id, toId: a.id, chip: 'bold', kudos: true }))).status).toBe(403);
    expect((await err(A.call('giveFeedback', a, { id, toId: a.id, kudos: true }))).message).toMatch(/someone you played with/);
    expect((await err(A.call('giveFeedback', a, { id, toId: c.id, kudos: true }))).message).toMatch(/someone you played with/); // Carol watched
    expect((await err(A.call('giveFeedback', a, { id, toId: out.id, kudos: true }))).message).toMatch(/someone you played with/);
    expect((await err(A.call('giveFeedback', a, { id, toId: 'arena', kudos: true }))).message).toMatch(/someone you played with/);
    expect((await err(A.call('giveFeedback', a, { id: 'nope', toId: b.id, kudos: true }))).status).toBe(403);
    for (const u of [a, b, c, out]) { expect(u.reputation.kudos).toBe(0); expect(u.chips).toEqual({}); }
    // An observer may thank a player.
    expect((await A.call('giveFeedback', c, { id, toId: a.id, chip: 'fun' })).given).toEqual({ chip: 'fun', kudos: false });
    expect(a.chips).toEqual({ fun: 1 });
  });

  it('changing the chip moves the count; kudos count once and are worth 3 reputation', async () => {
    const A = makeArena();
    const { a, b, id } = await finished(A);
    await winFor(A, id, 0);
    const rep = b.reputation.score;
    expect((await A.call('giveFeedback', a, { id, toId: b.id, chip: 'bold' })).given).toEqual({ chip: 'bold', kudos: false });
    expect(b.chips).toEqual({ bold: 1 });
    expect((await A.call('giveFeedback', a, { id, toId: b.id, chip: 'sharp' })).given).toEqual({ chip: 'sharp', kudos: false });
    expect(b.chips).toEqual({ bold: 0, sharp: 1 });
    await A.call('giveFeedback', a, { id, toId: b.id, chip: 'sharp' });
    expect(b.chips).toEqual({ bold: 0, sharp: 1 });
    // Kudos: once.
    expect((await A.call('giveFeedback', a, { id, toId: b.id, kudos: true })).given).toEqual({ chip: 'sharp', kudos: true });
    await A.call('giveFeedback', a, { id, toId: b.id, kudos: true });
    await A.call('giveFeedback', a, { id, toId: b.id, chip: 'patient', kudos: true });
    expect(b.reputation.kudos).toBe(1);
    expect(b.reputation.score).toBe(rep + 3);
    expect(b.chips).toEqual({ bold: 0, sharp: 0, patient: 1 });
    // A word that is not on the list changes nothing (problems go through Report, never a chip).
    expect((await A.call('giveFeedback', a, { id, toId: b.id, chip: 'rude' })).given).toEqual({ chip: 'patient', kudos: true });
    expect((await A.call('giveFeedback', a, { id, toId: b.id, chip: '__proto__' })).given.chip).toBe('patient');
    expect(Object.keys(b.chips).every((k) => CHIPS.includes(k))).toBe(true);
    // What I gave comes back in the debrief, and only mine.
    expect((await A.call('debrief', a, { id })).given).toEqual({ [b.id]: { chip: 'patient', kudos: true } });
    expect((await A.call('debrief', b, { id })).given).toEqual({});
    expect(A.card(b, a)).toMatchObject({ kudos: 1, chips: { patient: 1 } });
    expect(A.c.peerFeedback.size).toBe(1);
  });

  it('each pair at each table is its own row: two games, two kudos', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const g1 = await game(A, a, b, 0); const g2 = await game(A, a, b, 1);
    await A.call('giveFeedback', a, { id: g1, toId: b.id, chip: 'fun', kudos: true });
    await A.call('giveFeedback', a, { id: g2, toId: b.id, chip: 'fun', kudos: true });
    await A.call('giveFeedback', b, { id: g1, toId: a.id, kudos: true });
    expect(b.chips).toEqual({ fun: 2 });
    expect(b.reputation.kudos).toBe(2);
    expect(a.reputation.kudos).toBe(1);
  });
});

describe('vouching', () => {
  it('CEO members only, once per person, worth 25 reputation', async () => {
    const A = makeArena();
    const ceo = await member(A, 'Ceo', { tier: 'ceo' }); const vip = await member(A, 'Vip', { tier: 'vip' }); const u = await member(A, 'Ursula');
    const e = await err(A.call('vouch', vip, { userId: u.id }));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/CEO/);
    expect(u.reputation).toMatchObject({ score: 100, vouches: 0 });
    expect(await A.call('vouch', ceo, { userId: u.id })).toEqual({ ok: true });
    expect(await A.call('vouch', ceo, { userId: u.id })).toEqual({ ok: true });
    expect(u.reputation).toMatchObject({ score: 125, vouches: 1 });
    expect(A.card(u, vip).vouches).toBe(1);
    expect((await A.call('inbox', u)).notes.filter((n) => /vouched for you/.test(n.body))).toHaveLength(1);
    expect((await err(A.call('vouch', ceo, { userId: ceo.id }))).message).toMatch(/yourself/);
    expect((await err(A.call('vouch', ceo, { userId: 'nope' }))).status).toBe(404);
    // A second CEO is a second vouch.
    const ceo2 = await member(A, 'Ceo2', { tier: 'ceo' });
    await A.call('vouch', ceo2, { userId: u.id });
    expect(u.reputation).toMatchObject({ score: 150, vouches: 2 });
    // A lapsed CEO plan cannot vouch.
    ceo2.tierExpiresAt = A.now() - 1;
    expect((await err(A.call('vouch', ceo2, { userId: vip.id }))).status).toBe(403);
  });

  it('the arena\'s own account cannot be vouched for (and the attempt does not crash)', async () => {
    const A = makeArena();
    const ceo = await member(A, 'Ceo', { tier: 'ceo' });
    const e = await err(A.call('vouch', ceo, { userId: 'arena' }));
    expect(e.status).toBeGreaterThanOrEqual(400);
    expect(e.status).toBeLessThan(500);
  });

  it('reputation bands and reputation floors', async () => {
    expect(repBand(100).label).toBe('Good standing');
    expect(repBand(150).label).toBe('Trusted');
    expect(repBand(49).label).toBe('New');
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    b.reputation.score = 4;
    const id = await table(A, a, b);
    await A.call('leaveTable', b, { id }); await tick(10);
    expect(b.reputation.score).toBe(0); // never negative
  });
});

describe('records', () => {
  it("other people's history: 30 days for free viewers, everything for Subscribers, everything of your own", async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const sub = await member(A, 'Sub', { tier: 'member' }); const g = await guest(A);
    const old = await game(A, a, b, 0);
    A.advance(31 * DAY);
    const recent = await game(A, a, b, 1);
    const ids = (r) => r.recent.map((x) => x.tableId);
    const free = await A.call('profile', b, { id: a.id });
    expect(ids(free)).toEqual([recent]);
    expect(free.historyLimited).toBe(true);
    expect(ids(await A.call('profile', g, { id: a.id }))).toEqual([recent]);
    const paid = await A.call('profile', sub, { id: a.id });
    expect(ids(paid)).toEqual([recent, old]);
    expect(paid.historyLimited).toBe(false);
    const self = await A.call('profile', a, {});
    expect(ids(self)).toEqual([recent, old]);
    expect(self.historyLimited).toBe(false);
    expect(self.self).toBe(true);
    expect(self.recent[0]).toMatchObject({ gameId: GAME, gameName: 'Four in a Row', placement: 2, players: 2, won: false });
    expect(self.recent[0].delta).toBe(self.recent[0].ratingAfter - A.c.results.get(`${recent}:${a.id}`).ratingBefore);
    expect(self.recent[1]).toMatchObject({ placement: 1, delta: 20, won: true });
    // Ratings and rank are always visible.
    expect(free.ratings).toEqual([{ gameId: GAME, gameName: 'Four in a Row', rating: A.ratingOf(a.id, GAME), games: 2, wins: 1, rank: skillRank(A.ratingOf(a.id, GAME)) }]);
    expect(free.rank).toBe('Rookie');
  });

  it('history shows the 20 most recent games', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice');
    for (let i = 0; i < 25; i++) A.c.results.put({ id: `t${i}:${a.id}`, tableId: `t${i}`, userId: a.id, gameId: GAME, placement: 1, players: 2, ratingBefore: 1200, ratingAfter: 1204, won: true, at: A.now() - i * 1000 });
    const p = await A.call('profile', a, {});
    expect(p.recent).toHaveLength(20);
    expect(p.recent[0].tableId).toBe('t0');
  });

  it('points and the archetype suggestion are private; a profile is found by id or username', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    const mine = await A.call('profile', a, {});
    expect(mine.points).toBe(a.points);
    const theirs = await A.call('profile', b, { username: 'ALICE' });
    expect(theirs.card.id).toBe(a.id);
    expect(theirs.points).toBeUndefined();
    expect(theirs.self).toBe(false);
    expect(theirs).toMatchObject({ connection: 'none', canMessage: false });
    expect((await err(A.call('profile', a, { id: 'arena' }))).status).toBe(404);
    expect((await err(A.call('profile', a, { username: 'venturearena' }))).status).toBe(404);
    expect((await err(A.call('profile', a, { id: 'nope' }))).status).toBe(404);
    expect((await err(A.call('profile', a, { username: 'nobody' }))).status).toBe(404);
  });

  it('head-to-head is a VIP view', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob'); const c = await member(A, 'Carol');
    await game(A, a, b, 0); await game(A, a, b, 0); await game(A, a, b, 1); await game(A, a, c, 1);
    const id = await table(A, a, b); await endWith(A, id, [1, 1]); // a draw counts as a game, a win for neither
    for (const tier of ['free', 'member']) {
      a.tier = tier;
      expect(await A.call('profile', a, { id: b.id })).not.toHaveProperty('headToHead');
    }
    a.tier = 'vip';
    expect((await A.call('profile', a, { id: b.id })).headToHead).toEqual({ games: 4, aWins: 2, bWins: 1 });
    expect((await A.call('profile', a, { id: c.id })).headToHead).toEqual({ games: 1, aWins: 0, bWins: 1 });
    expect(await A.call('profile', a, {})).not.toHaveProperty('headToHead'); // not against yourself
    b.tier = 'ceo';
    expect((await A.call('profile', b, { id: a.id })).headToHead).toEqual({ games: 4, aWins: 1, bWins: 2 });
  });

  it('skill ranks and the Arena rank ladder', () => {
    expect([1149, 1150, 1299, 1300, 1449, 1450].map((r) => skillRank(r).name)).toEqual(['Apprentice', 'Operator', 'Operator', 'Shark', 'Shark', 'Mogul']);
    expect(arenaRank({})).toBe('Rookie');
    expect(arenaRank({ games: 2, rating: 2000, points: 5000 })).toBe('Rookie');
    expect(arenaRank({ games: 3 })).toBe('Founder');
    expect(arenaRank({ games: 10, rating: 1249 })).toBe('Founder');
    expect(arenaRank({ games: 10, rating: 1250 })).toBe('Operator');
    expect(arenaRank({ games: 20, rating: 1350, points: 599 })).toBe('Operator');
    expect(arenaRank({ games: 20, rating: 1350, points: 600 })).toBe('Partner');
    expect(arenaRank({ games: 40, rating: 1500, points: 1499 })).toBe('Partner');
    expect(arenaRank({ games: 40, rating: 1500, points: 1500 })).toBe('Mogul');
    expect(arenaRank({ games: 39, rating: 1500, points: 1500 })).toBe('Partner');
  });

  it('the card rank uses the best rating, total games and points', async () => {
    const A = makeArena();
    const a = await member(A, 'Alice'); const b = await member(A, 'Bob');
    expect(A.card(a, b).rank).toBe('Rookie');
    for (let i = 0; i < 3; i++) await game(A, a, b, 0);
    expect(A.card(a, b).rank).toBe('Founder');
    expect((await A.call('profile', b, { id: a.id })).rank).toBe('Founder');
  });
});
