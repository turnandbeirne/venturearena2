// What happens when a game ends: results, ratings, reputation, points, the
// play-style read, and the Debrief room that replaces a bare "game over".
//
// Reputation measures reliability (finishing, showing up, kudos), never
// personality and never losing.
import { clean } from './context.js';
import { getGame } from '../../games/registry.js';
import { HISTORY_DAYS } from '../../shared/tiers.js';
import { CHIPS, STYLE_DIMS, personaLabel, PERSONAS, styleInsight, skillRank, arenaRank, POINTS } from '../../shared/profile.js';

const START_RATING = 1200;
const BOT_RATING = 1200;
const BOT_K = 8; // beating a bot barely moves a rating, so nobody farms them

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const PERSONA_TO_ARCHETYPE = { Dealmaker: 'trader', Wildcard: 'trader', Connector: 'backer', Closer: 'operator', Builder: 'builder', Strategist: 'analyst', Operator: 'operator' };

/** Pairwise Elo. Humans weigh K/(humans-1) each; bots are a fixed 1200 at K=8. */
export function eloDeltas(seats) {
  // seats: [{ rating, games, placement, human }]
  const humans = seats.filter((s) => s.human).length;
  return seats.map((me, i) => {
    if (!me.human) return 0;
    const baseK = me.games < 10 ? 40 : 20;
    let delta = 0;
    seats.forEach((o, j) => {
      if (i === j) return;
      const oRating = o.human ? o.rating : BOT_RATING;
      const S = me.placement < o.placement ? 1 : me.placement === o.placement ? 0.5 : 0;
      const E = 1 / (1 + 10 ** ((oRating - me.rating) / 400));
      const K = o.human ? baseK / Math.max(1, humans - 1) : BOT_K;
      delta += K * (S - E);
    });
    return Math.round(delta);
  });
}

export function install(A) {
  const { users, tables, results, ratings, debriefs, peerFeedback } = A.c;

  function ratingRow(userId, gameId) {
    const id = `${userId}:${gameId}`;
    return ratings.get(id) || { id, userId, gameId, rating: START_RATING, games: 0, wins: 0 };
  }

  function refreshStats(u) {
    const rows = ratings.filter((r) => r.userId === u.id);
    const games = rows.reduce((a, r) => a + r.games, 0);
    u.stats = {
      games,
      wins: rows.reduce((a, r) => a + r.wins, 0),
      best: rows.length ? Math.max(...rows.map((r) => r.rating)) : START_RATING,
      avg: rows.length ? Math.round(rows.reduce((a, r) => a + r.rating * Math.max(1, r.games), 0) / rows.reduce((a, r) => a + Math.max(1, r.games), 0)) : START_RATING,
    };
  }

  /** Fold one game's signals into the member's running play style. */
  function updatePersona(u, signals) {
    const p = u.persona || { counts: {}, games: 0 };
    for (const d of STYLE_DIMS) {
      if (typeof signals[d] !== 'number') continue;
      const n = p.counts[d] || 0;
      p[d] = Math.round(((p[d] ?? 50) * n + signals[d]) / (n + 1));
      p.counts[d] = n + 1;
    }
    for (const d of STYLE_DIMS) if (typeof p[d] !== 'number') p[d] = 50;
    p.games = (p.games || 0) + 1;
    p.label = personaLabel(p);
    u.persona = p;
    // After five games the arena may SUGGEST a different archetype. The
    // member's own label is never changed for them.
    const hint = PERSONA_TO_ARCHETYPE[p.label];
    u.suggestedArchetype = p.games >= 5 && hint && u.archetype && hint !== u.archetype ? hint : null;
  }

  function median(list) { if (!list || !list.length) return null; const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }

  A.hooks.matchOver = async (t, state) => {
    if (t.status !== 'playing') return; // recorded exactly once
    const G = state.G;
    // A result is what the RULES wrote (finish() sets G.over). (Bug: this
    // fell back to boardgame.io's ctx.gameover, which a browser could set to
    // anything with an "endGame" event; the placements it carried were
    // recorded as the result. The socket guard in bgio.js refuses those
    // events now; this keeps a forged ending from ever becoming a rating.)
    const over = G && G.over;
    if (!over || !Array.isArray(over.placements)) {
      console.error(`[play] table ${t.id} ended without a result from the rules; nothing recorded`);
      A.finishTable(t, 'abandoned');
      return;
    }
    const g = getGame(t.gameId);
    const n = t.seats.length;
    const placements = over.placements;
    A.finishTable(t, 'finished');

    const seats = t.seats.map((s, i) => {
      const row = s.userId ? ratingRow(s.userId, t.gameId) : null;
      return { seat: i, userId: s.userId, human: !!s.userId, rating: row ? row.rating : BOT_RATING, games: row ? row.games : 0, placement: placements[i] };
    });
    const deltas = eloDeltas(seats);
    const humans = seats.filter((s) => s.human).length;
    const firsts = placements.filter((p) => p === 1).length;
    const summary = [];

    for (const s of seats) {
      const tSeat = t.seats[s.seat];
      let tele = {};
      try { tele = g.telemetry ? g.telemetry(G, s.seat) || {} : {}; } catch (e) { console.error('[play] telemetry failed:', e.message); }
      const score = over.scores ? over.scores[s.seat] : (tele.metrics && typeof tele.metrics.score === 'number' ? tele.metrics.score : null);
      summary.push({ seat: s.seat, userId: s.userId, name: tSeat.name, avatar: tSeat.avatar, bot: !!tSeat.bot, takeover: tSeat.takeover || null, placement: s.placement, score });
      if (!s.human) continue;
      const u = users.get(s.userId);
      if (!u) continue;

      // --- style signals: the game's own read plus what the arena measured
      const signals = { ...(tele.signals || {}) };
      const think = t.think && t.think[s.seat];
      const med = think ? median(think.list) : null;
      if (med !== null) {
        const pace = g.meta.paceSec || 8;
        signals.speed = clamp(50 + 25 * Math.log2(pace / Math.max(1, med)));
      }
      const chats = (t.chatCount && t.chatCount[u.id]) || 0;
      signals.cooperation = clamp((signals.cooperation ?? 35) + Math.min(chats, 8) * 8 - (tSeat.takeover ? 30 : 0));
      if (typeof tele.midRank === 'number' && n > 1) {
        signals.resilience = clamp(50 + (tele.midRank - s.placement) * 20 + (tele.midRank > 1 && s.placement === 1 ? 15 : 0));
      }

      const row = ratingRow(u.id, t.gameId);
      const before = row.rating;
      row.rating = before + deltas[s.seat];
      row.games += 1;
      const won = s.placement === 1 && firsts < n; // everyone tying is a draw, not a win
      if (won) row.wins += 1;
      ratings.put(row);

      results.put({
        id: `${t.id}:${u.id}`, tableId: t.id, userId: u.id, gameId: t.gameId, seat: s.seat, placement: s.placement, players: n, humans,
        score, ratingBefore: before, ratingAfter: row.rating, signals, metrics: tele.metrics || {}, skillTags: tele.skillTags || [],
        takeover: tSeat.takeover || null, won, at: A.now(),
      });

      refreshStats(u);
      if (!tSeat.takeover) u.reputation.score += 2; // finished what they started
      updatePersona(u, signals);
      u.playStyle = describeStyle(u);
      users.put(u);
      A.award(u, won ? 'game_won' : 'game_played', won ? POINTS.gameWon : POINTS.gamePlayed, { ref: t.id, once: t.id });
    }

    t.result = { placements, scores: over.scores || null, reason: over.reason || null, summary };
    tables.put(t);
    A.emit(`t:${t.id}`, 'table', { id: t.id, status: 'finished' });
    // The match state has done its job; the table keeps the summary.
    if (A.bgio && !A.config.keepFinishedMatches) {
      const timer = setTimeout(() => A.bgio.wipe(t.id).catch(() => {}), A.config.wipeMatchAfterMs ?? 10 * 60 * 1000);
      if (timer.unref) timer.unref();
    }
  };

  /** One line on how the arena sees a member, from their results so far. */
  function describeStyle(u) {
    if (!u.persona) return null;
    const mine = results.filter((r) => r.userId === u.id);
    let line = null;
    // A game may contribute its own, more specific read (VentureFlow does).
    for (const gameId of new Set(mine.map((r) => r.gameId))) {
      const g = getGame(gameId);
      if (g && g.playStyle) { line = g.playStyle(mine.filter((r) => r.gameId === gameId).map((r) => r.metrics)); if (line) break; }
    }
    if (!line) line = `${u.persona.label}: ${PERSONAS[u.persona.label]}`;
    if (u.stats.games >= 3 && u.stats.wins / u.stats.games >= 0.5) line += ' Wins more than half their games.';
    return line;
  }

  // ---- debrief -----------------------------------------------------------------------------
  function wasAt(t, uid) { return t.players.includes(uid) || t.observers.includes(uid); }
  function questionFor(t, g) {
    const qs = g.meta.reflection || [];
    if (!qs.length) return 'What would you do differently next time?';
    let h = 0; for (const c of t.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return qs[h % qs.length];
  }
  function observations(g, r) {
    const out = g.observations ? g.observations(r.metrics || {}, r.placement, r.players) || [] : [];
    if (r.takeover) out.push(r.takeover === 'resigned' ? 'A bot finished this game after you resigned' : 'A bot finished this game for you');
    if (r.won && r.players > 1) out.push(`Won against ${r.players - 1} other${r.players - 1 === 1 ? '' : 's'}`);
    return out;
  }

  A.rpc.debrief = (me, args) => {
    const t = tables.get(args.id);
    if (!t || t.status !== 'finished' || !t.result) throw A.err('That game has no debrief yet.', 404);
    if (t.visibility === 'private' && !wasAt(t, me.id)) throw A.err('That table was private.', 403);
    const g = getGame(t.gameId);
    const rows = results.filter((r) => r.tableId === t.id);
    const mine = rows.find((r) => r.userId === me.id) || null;
    const full = A.allows(me, 'full_lessons');
    const lesson = g.meta.lesson || null;
    const standings = [...t.result.summary].sort((a, b) => a.placement - b.placement || a.seat - b.seat).map((s) => {
      const r = rows.find((x) => x.userId === s.userId);
      return {
        ...s, card: s.userId ? A.card(users.get(s.userId), me) : null,
        ratingBefore: r ? r.ratingBefore : null, ratingAfter: r ? r.ratingAfter : null,
        rank: r ? skillRank(r.ratingAfter) : null, metrics: r ? r.metrics : null,
      };
    });
    const row = mine ? ratings.get(`${me.id}:${t.gameId}`) : null;
    return {
      table: { id: t.id, gameId: t.gameId, gameName: g.meta.name, endedAt: t.endedAt, reason: t.result.reason },
      standings,
      mine: mine ? {
        placement: mine.placement, won: mine.won, ratingBefore: mine.ratingBefore, ratingAfter: mine.ratingAfter,
        rank: skillRank(mine.ratingAfter), games: row ? row.games : 1, wins: row ? row.wins : 0,
        observations: observations(g, mine), insight: styleInsight(mine.signals), signals: mine.signals,
      } : null,
      watched: !mine && wasAt(t, me.id),
      question: questionFor(t, g),
      answers: debriefs.filter((d) => d.tableId === t.id).sort((a, b) => a.at - b.at).map((d) => { const u = users.get(d.userId); return { userId: d.userId, name: u ? u.displayName : 'Player', avatar: u ? u.avatar : null, answer: d.answer, at: d.at }; }),
      lesson: lesson ? (full ? lesson : `${lesson.split('. ')[0]}.`) : null,
      lessonLocked: !!lesson && !full,
      given: Object.fromEntries(peerFeedback.filter((f) => f.tableId === t.id && f.fromId === me.id).map((f) => [f.toId, { chip: f.chip, kudos: f.kudos }])),
      canRematch: true,
    };
  };

  A.rpc.answerDebrief = (me, args) => {
    const t = tables.get(args.id);
    if (!t || t.status !== 'finished' || !wasAt(t, me.id)) throw A.err('You were not at this table.', 403);
    const answer = clean(args.answer, 500);
    if (!answer) throw A.err('Write a sentence or two.');
    const id = `${t.id}:${me.id}`;
    const first = !debriefs.get(id);
    debriefs.put({ id, tableId: t.id, userId: me.id, question: questionFor(t, getGame(t.gameId)), answer, at: A.now() });
    if (first) { me.reputation.debriefs += 1; users.put(me); }
    A.emit(`t:${t.id}`, 'debrief', { id: t.id });
    return { ok: true };
  };

  // Two taps after a game: one word for how they played, and kudos.
  A.rpc.giveFeedback = (me, args) => {
    const t = tables.get(args.id);
    // After the game, as the heading says. (Bug: there was no status check,
    // so two accounts could sit down at an open table, trade kudos for +3
    // reputation each, close it and repeat without ever playing.)
    if (!t || t.status !== 'finished' || !wasAt(t, me.id)) throw A.err('You were not at this table.', 403);
    const to = users.get(args.toId);
    if (!to || to.id === me.id || !t.players.includes(to.id)) throw A.err('Pick someone you played with.');
    const chip = CHIPS.includes(args.chip) ? args.chip : null;
    const id = `${t.id}:${me.id}:${to.id}`;
    const prev = peerFeedback.get(id);
    const next = { id, tableId: t.id, fromId: me.id, toId: to.id, chip: chip || (prev ? prev.chip : null), kudos: !!args.kudos || !!(prev && prev.kudos), at: A.now() };
    peerFeedback.put(next);
    to.chips = to.chips || {};
    if (prev && prev.chip && prev.chip !== next.chip) to.chips[prev.chip] = Math.max(0, (to.chips[prev.chip] || 1) - 1);
    if (next.chip && (!prev || prev.chip !== next.chip)) to.chips[next.chip] = (to.chips[next.chip] || 0) + 1;
    if (next.kudos && !(prev && prev.kudos)) { to.reputation.score += 3; to.reputation.kudos += 1; }
    users.put(to);
    return { given: { chip: next.chip, kudos: next.kudos } };
  };

  A.rpc.vouch = (me, args) => {
    A.need(me, 'vouch', 'Vouching is for CEO members.');
    const to = A.mustUser(args.userId);
    if (to.id === me.id) throw A.err('You cannot vouch for yourself.');
    // (Bug: vouching for the arena's own account threw a TypeError, a 500,
    // because that account carries no reputation.)
    if (to.isBot || to.isArena || !to.reputation) throw A.err('You can vouch for members only.');
    to.vouchedBy = to.vouchedBy || [];
    if (to.vouchedBy.includes(me.id)) return { ok: true };
    to.vouchedBy.push(me.id); to.reputation.score += 25; to.reputation.vouches += 1; users.put(to);
    A.notify(to.id, `${me.displayName} vouched for you. That is worth 25 reputation and it shows on your card.`);
    return { ok: true };
  };

  // ---- records ---------------------------------------------------------------------------------
  function historyFor(u, viewer) {
    const self = viewer.id === u.id;
    const days = self ? Infinity : HISTORY_DAYS[A.tier(viewer)];
    const since = days === Infinity ? 0 : A.now() - days * 86400000;
    return results.filter((r) => r.userId === u.id && r.at >= since).sort((a, b) => b.at - a.at).slice(0, 20).map((r) => {
      const g = getGame(r.gameId);
      return { tableId: r.tableId, gameId: r.gameId, gameName: g ? g.meta.name : r.gameId, placement: r.placement, players: r.players, score: r.score, ratingAfter: r.ratingAfter, delta: r.ratingAfter - r.ratingBefore, won: r.won, at: r.at };
    });
  }

  A.rpc.profile = (me, args) => {
    const u = args.username ? users.find((x) => x.username === clean(args.username, 40).toLowerCase()) : users.get(args.id || me.id);
    if (!u || u.isArena) throw A.err('No such member.', 404);
    const self = u.id === me.id;
    const rows = ratings.filter((r) => r.userId === u.id).map((r) => { const g = getGame(r.gameId); return { gameId: r.gameId, gameName: g ? g.meta.name : r.gameId, rating: r.rating, games: r.games, wins: r.wins, rank: skillRank(r.rating) }; });
    const out = {
      card: A.card(u, me), self,
      ratings: rows, recent: historyFor(u, me), historyLimited: !self && HISTORY_DAYS[A.tier(me)] !== Infinity,
      rank: arenaRank({ rating: u.stats.best, games: u.stats.games, points: u.points || 0 }),
      points: self ? u.points : undefined,
      connection: A.connectionState ? A.connectionState(me, u) : null,
      canMessage: A.canMessage ? A.canMessage(me, u) : false,
      suggestedArchetype: self ? u.suggestedArchetype || null : undefined,
    };
    if (!self && A.allows(me, 'head_to_head')) out.headToHead = headToHead(me.id, u.id);
    return out;
  };

  function headToHead(a, b) {
    const mine = results.filter((r) => r.userId === a);
    let games = 0, aWins = 0, bWins = 0;
    for (const r of mine) {
      const o = results.get(`${r.tableId}:${b}`);
      if (!o) continue;
      games++;
      if (r.placement < o.placement) aWins++; else if (o.placement < r.placement) bWins++;
    }
    return { games, aWins, bWins };
  }

  A.rpc.keepArchetype = (me, args) => {
    if (args.switch && me.suggestedArchetype) me.archetype = me.suggestedArchetype;
    me.suggestedArchetype = null; users.put(me);
    return { user: A.selfView(me) };
  };
}
