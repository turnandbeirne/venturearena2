// Build an arena in memory with instant bots, the way the server wires it,
// minus the network.
import { Store, MemoryDriver } from '../src/server/store/index.js';
import { createBgio } from '../src/server/bgio.js';
import { createArena } from '../src/server/arena/index.js';
import { getGame } from '../src/games/registry.js';
import { actingSeats } from '../src/games/sim.js';

export function makeArena(config = {}) {
  const store = new Store(new MemoryDriver());
  const bgio = createBgio({ store });
  let clock = Date.now();
  const events = [];
  const A = createArena({ store, bgio, config: { instantBots: true, quickMatchBotAfterMs: 0, publicUrl: 'http://test', wipeMatchAfterMs: 3600000, ...config }, now: () => clock, emit: (room, event, payload) => events.push({ room, event, payload }) });
  A.advance = (ms) => { clock += ms; };
  A.events = events;
  return A;
}

export async function guest(A, name) {
  const { user } = await A.call('guest', null, {}, { ip: `ip-${Math.random()}` });
  const u = A.user(user.id);
  if (name) { u.displayName = name; A.c.users.put(u); }
  return u;
}

export async function member(A, name, extra = {}) {
  const u = await guest(A, name);
  await A.call('register', u, { email: `${name.toLowerCase().replace(/\W+/g, '')}@example.com`, password: 'correct horse', displayName: name }, { ip: `ip-${Math.random()}` });
  Object.assign(u, extra); A.c.users.put(u);
  A.recomputeSurvey(u);
  return u;
}

export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** Play the human seats of a table with the game's own bot until it ends. */
export async function playToEnd(A, tableId, { maxSteps = 5000 } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    const t = A.c.tables.get(tableId);
    if (!t || t.status !== 'playing') return t;
    const state = A.bgio.state(tableId);
    const g = getGame(t.gameId);
    const seat = actingSeats(state.G).find((s) => t.seats[s] && t.seats[s].userId && !t.seats[s].takeover);
    if (seat === undefined) { await tick(3); continue; }
    const view = A.bgio.processed[t.gameId].playerView({ G: state.G, ctx: state.ctx, playerID: String(seat) });
    const act = g.bot({ G: view, ctx: state.ctx, seat, level: 1 });
    if (!act) { await tick(3); continue; }
    await A.bgio.submit(tableId, t.gameId, seat, act.move, act.args || []);
    await tick(1);
  }
  throw new Error('game did not finish');
}
