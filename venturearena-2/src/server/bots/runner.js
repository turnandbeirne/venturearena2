// The bot runner. Bots that fill empty seats are what make a small games site
// feel alive, so every game ships with one and this file plays them.
//
// One timer per match. Every state change replans: if a bot seat (or a seat a
// bot has taken over) owes a move, play it after a human-feeling pause; if the
// game has housekeeping for the server's own seat (a timer running out, a
// robot inside the game's own engine), do that when it falls due.
//
// The bot is given exactly what a browser in its seat would receive (the
// playerView), never the full state, so a bot cannot peek at a hidden hand.
import { getGame } from '../../games/registry.js';
import { actingSeats } from '../../games/kit.js';

export function install(A) {
  const timers = new Map();   // matchID -> { timer, stateID }
  const strikes = new Map();  // matchID -> consecutive refused bot moves

  const isBotSeat = (t, seat) => !!t.seats[seat] && (!!t.seats[seat].bot || !!t.seats[seat].takeover);
  const humansLeft = (t) => t.seats.some((s) => s.userId && !s.takeover);

  function clear(matchID) {
    const cur = timers.get(matchID);
    if (cur) { clearTimeout(cur.timer); timers.delete(matchID); }
  }

  function schedule(t, stateID, delay, fn) {
    clear(t.id);
    const timer = setTimeout(() => {
      timers.delete(t.id);
      fn().catch((e) => console.error(`[bots] ${t.gameId} ${t.id}:`, e.message));
    }, Math.max(0, delay));
    if (timer.unref) timer.unref();
    timers.set(t.id, { timer, stateID });
  }

  function plan(t) {
    if (!t || t.status !== 'playing' || !A.bgio) return;
    const state = A.bgio.state(t.id);
    if (!state || state.ctx.gameover !== undefined) { clear(t.id); return; }
    const g = getGame(t.gameId);
    const G = state.G;
    // With nobody left to watch, there is no reason to act out thinking time.
    const watched = humansLeft(t) && !A.config.instantBots;
    const stateID = state._stateID;

    const seat = actingSeats(G).find((s) => isBotSeat(t, s));
    if (seat !== undefined) {
      const [lo, hi] = A.config.botDelayMs || [500, 1100];
      // A bot answering a reaction window (G.waiting) has nothing to "think"
      // about on stage. (Bug: five bots each taking a full think-pause to say
      // "no objection" made every card played in VentureBoom cost four seconds.)
      const reacting = Array.isArray(G.waiting) && G.waiting.length > 0;
      const delay = !watched ? 0 : reacting ? Math.min(lo, 150) + Math.random() * 120 : lo + Math.random() * (hi - lo);
      schedule(t, stateID, delay, async () => {
        const now = A.bgio.state(t.id);
        if (!now || now._stateID !== stateID || now.ctx.gameover !== undefined) return;
        const view = A.bgio.processed[t.gameId].playerView({ G: now.G, ctx: now.ctx, playerID: String(seat) });
        const spec = t.seats[seat].bot || {};
        const act = g.bot({ G: view, ctx: now.ctx, seat, level: spec.level || 2, spec });
        if (!act) { strike(t, `bot for seat ${seat} had no move`); return; }
        const ok = await A.bgio.submit(t.id, t.gameId, seat, act.move, act.args || []);
        if (ok) strikes.delete(t.id);
        else strike(t, `bot move ${act.move}(${JSON.stringify(act.args || [])}) by seat ${seat} was refused`);
      });
      return;
    }

    const chore = g.housekeeping ? g.housekeeping(G, { seats: t.seats, table: t, now: A.now() }) : null;
    if (chore && t.house !== null && t.house !== undefined) {
      // With nobody left to watch, pauses meant for people are skipped. A chore
      // marked `exact` is a real deadline (a turn clock) and always keeps its time.
      // (Bug: fired early, a clock's END_TURN was refused and counted as a strike.)
      const delay = watched || chore.exact ? (chore.afterMs || 0) : Math.min(chore.afterMs || 0, 120);
      schedule(t, stateID, delay, async () => {
        const now = A.bgio.state(t.id);
        if (!now || now._stateID !== stateID || now.ctx.gameover !== undefined) return;
        const again = g.housekeeping(now.G, { seats: t.seats, table: t, now: A.now() });
        if (!again || again.move !== chore.move) return;
        const ok = await A.bgio.submit(t.id, t.gameId, t.house, again.move, again.args || []);
        if (ok) strikes.delete(t.id);
        else strike(t, `house move ${again.move} was refused`);
      });
      return;
    }
    clear(t.id);
  }

  // A refused bot move means the bot and the validator disagree, which the
  // playout tests should have caught. Rather than spin forever, retry a couple
  // of times (the state may simply have moved on) and then stop and say so.
  function strike(t, why) {
    const n = (strikes.get(t.id) || 0) + 1;
    strikes.set(t.id, n);
    console.error(`[bots] ${t.gameId} ${t.id}: ${why} (strike ${n})`);
    if (n < 3) { const timer = setTimeout(() => plan(A.c.tables.get(t.id)), 1000); if (timer.unref) timer.unref(); }
  }

  A.hooks.planMatch = plan;
  A.stopRunner = () => { for (const id of [...timers.keys()]) clear(id); };

  /** After a restart: pick every live table back up. */
  A.resumeMatches = () => {
    let n = 0;
    for (const t of A.c.tables.filter((x) => x.status === 'playing')) { plan(t); n++; }
    // A table caught mid-start by a restart never got its match: reopen it.
    for (const t of A.c.tables.filter((x) => x.status === 'starting')) { t.status = 'open'; A.c.tables.put(t); }
    return n;
  };
}
