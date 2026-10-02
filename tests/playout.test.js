// Bot-vs-bot playouts: every registered game, at every seat count it
// supports, played to a real result. This is the test that catches a bot and
// a validator that disagree, a stalemate with no mercy limit, and a field
// that setup() forgot.
import { describe, it, expect } from 'vitest';
import { GAMES } from '../src/games/registry.js';
import { playout } from '../src/games/sim.js';

const ROUNDS = 3;

for (const [id, g] of Object.entries(GAMES)) {
  describe(`playout: ${id}`, () => {
    const { min, max } = g.meta.seats;
    for (let n = min; n <= max; n++) {
      it(`${n} seats: bots reach a result`, () => {
        for (let round = 0; round < ROUNDS; round++) {
          const m = playout({ game: g.rules, bot: g.bot, housekeeping: g.housekeeping, numSeats: n, setupData: g.testSetup ? g.testSetup(n) : undefined });
          const over = m.G.over;
          expect(over, 'game ended').toBeTruthy();
          expect(over.placements).toHaveLength(n);
          expect(Math.min(...over.placements), 'someone placed first').toBe(1);
          for (const p of over.placements) expect(p).toBeGreaterThanOrEqual(1);
          // The log counter only ever goes up and the log stays capped.
          expect(m.G.logN).toBeGreaterThan(0);
          expect(m.G.log.length).toBeLessThanOrEqual(80);
          const ns = m.G.log.map((e) => e.n);
          expect([...ns].sort((a, b) => a - b)).toEqual(ns);
          // Telemetry never throws on a finished game.
          if (g.telemetry) for (let s = 0; s < n; s++) expect(() => g.telemetry(m.G, s)).not.toThrow();
        }
      });
    }
  });
}
