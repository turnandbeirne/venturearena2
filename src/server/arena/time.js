// Time invested: how long a member has put into each game, and into each
// piece of their own work (an AI guide now; an idea, a project or a venture
// once the business sandbox is here).
//
// Two sources, kept apart on purpose:
//
//  * GAMES are measured by the table, never reported by a browser. Each
//    result row carries `ms`, written when the game ends (A.gameMs), and the
//    totals are added up from the result rows. There is no second counter to
//    drift from the record.
//  * WORK that is not a game has no table to measure it, so the page says
//    "still here" every half minute (timeBeat) and the server credits the gap
//    since the previous beat, on its own clock, never more than a beat's
//    worth. A tab left open overnight earns nothing: no beats arrive from a
//    hidden or idle page, and one late beat only starts a new session.
import { getGame } from '../../games/registry.js';
import { GUIDES } from '../../shared/guides.js';

/** A realtime game cannot count for more than this, whatever the clock says. */
const GAME_CAP_MS = 6 * 60 * 60 * 1000;
/** Beats are 30 s apart; one that arrives later than this starts a new session instead of being credited. */
export const BEAT_MAX_MS = 90 * 1000;

export function install(A) {
  const { results, tables } = A.c;
  const time = A.c.time;

  // What may be timed besides games: kind -> (member, ref) => a label, or null to refuse.
  // The sandbox registers 'idea', 'project' and 'venture' here when it exists.
  A.timeKinds = {
    guide: (me, ref) => { const g = GUIDES.find((x) => x.id === ref); return g && !me.isGuest ? g.name : null; },
  };

  /**
   * What one seat put into a finished table.
   * Realtime: everyone was at the table from start to end. A seat a bot took
   * over, and any seat at a turn-based table (where nobody waits at the table
   * between moves), gets the time that seat spent on its own moves; each move
   * is already capped at five minutes where it is recorded (tables.js).
   */
  A.gameMs = (t, seat) => {
    const s = t.seats && t.seats[seat];
    const think = t.think && t.think[seat] ? Math.max(0, t.think[seat].ms || 0) : 0;
    if (t.mode === 'turn_based' || (s && s.takeover)) return think;
    if (!t.startedAt) return think;
    return Math.min(GAME_CAP_MS, Math.max(0, (t.endedAt || A.now()) - t.startedAt));
  };

  /** A result row's time. Rows written before time was recorded are worked out from their table, if it is still there. */
  A.resultMs = (r) => {
    if (Number.isFinite(r.ms)) return r.ms;
    const t = tables.get(r.tableId);
    return t ? A.gameMs(t, r.seat) : 0;
  };

  A.rpc.timeInvested = (me) => {
    const games = {};
    for (const r of results.filter((x) => x.userId === me.id)) {
      if (!games[r.gameId]) { const g = getGame(r.gameId); games[r.gameId] = { gameId: r.gameId, gameName: g ? g.meta.name : r.gameId, icon: g ? g.meta.icon : '', ms: 0, played: 0 }; }
      games[r.gameId].ms += A.resultMs(r); games[r.gameId].played += 1;
    }
    const work = time.filter((x) => x.userId === me.id && x.ms > 0).sort((a, b) => b.ms - a.ms)
      .map((x) => ({ kind: x.kind, ref: x.ref, label: x.label, ms: x.ms, sessions: x.sessions, lastAt: x.lastAt }));
    const gameMs = Object.values(games).reduce((a, g) => a + g.ms, 0);
    const workMs = work.reduce((a, w) => a + w.ms, 0);
    return { total: gameMs + workMs, gameMs, workMs, games: Object.values(games).sort((a, b) => b.ms - a.ms), work };
  };

  /** "Still here": credit the time since this member's previous beat on the same piece of work. */
  A.rpc.timeBeat = (me, args) => {
    const kind = typeof args.kind === 'string' ? args.kind : '';
    const ref = typeof args.ref === 'string' ? args.ref.slice(0, 80) : '';
    const check = Object.prototype.hasOwnProperty.call(A.timeKinds, kind) ? A.timeKinds[kind] : null;
    const label = check && ref ? check(me, ref) : null;
    if (!label) throw A.err('That cannot be timed.', 400);
    A.limit(`beat:${me.id}`, 12, 60000);
    const now = A.now();
    const id = `${me.id}:${kind}:${ref}`;
    const doc = time.get(id) || { id, userId: me.id, kind, ref, label, ms: 0, sessions: 0, firstAt: now, beatAt: 0, lastAt: now };
    const gap = now - (doc.beatAt || 0);
    if (doc.beatAt && gap > 0 && gap <= BEAT_MAX_MS) doc.ms += gap;
    else if (!doc.beatAt || gap > BEAT_MAX_MS) doc.sessions += 1;
    doc.beatAt = now; doc.lastAt = now; doc.label = label;
    time.put(doc);
    return { ms: doc.ms, sessions: doc.sessions };
  };
}
