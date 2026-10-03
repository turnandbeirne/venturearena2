// People: connections, direct messages, introductions, challenges, invites,
// who is online and who you have played with.
//
// Guardrails carried over from the design work:
//  * no match or introduction without opt-in on both sides
//  * mentors and investors are protected first and can cap their volume
//  * a declined request is simply declined (the earlier build silently
//    BLOCKED the requester when a request was declined)
import { clean } from './context.js';
import { getGame } from '../../games/registry.js';
import { CHALLENGE_LIMIT, CONNECTION_LIMIT } from '../../shared/tiers.js';
import { POINTS } from '../../shared/profile.js';

const CHALLENGE_TTL_MS = 48 * 3600 * 1000;
const pairId = (a, b) => [a, b].sort().join(':');

export function install(A) {
  const { users, connections, messages, introductions, challenges, invites, tables, results, reports } = A.c;

  // ---- connections -------------------------------------------------------------------
  const conn = (a, b) => connections.get(pairId(a, b));
  const accepted = (a, b) => { const c = conn(a, b); return !!c && c.status === 'accepted'; };
  const blocked = (a, b) => { const c = conn(a, b); return !!c && c.status === 'blocked'; };
  A.areConnected = accepted;
  A.areBlocked = blocked;
  A.connectionState = (me, other) => {
    const c = conn(me.id, other.id);
    if (!c) return 'none';
    if (c.status === 'accepted') return 'connected';
    if (c.status === 'blocked') return 'blocked';
    return c.requesterId === me.id ? 'requested' : 'incoming';
  };
  const countConnections = (uid) => connections.count((c) => c.status === 'accepted' && (c.requesterId === uid || c.addresseeId === uid));

  /** May this member take on one more connection? Throws the reason if not. */
  function roomFor(u) {
    if (u.isGuest) throw A.err('Create a free account to connect with people.', 403);
    if (countConnections(u.id) >= CONNECTION_LIMIT[A.tier(u)]) throw A.err('Registered members can hold 25 connections. Subscribers have no limit.', 403);
  }

  function request(from, to, source, { bypass = false } = {}) {
    if (from.id === to.id) throw A.err('That is you.');
    if (to.isBot || to.isArena) throw A.err('Bots do not take connection requests.');
    if (!bypass) roomFor(from);
    const id = pairId(from.id, to.id);
    const c = connections.get(id);
    if (c) {
      if (c.status === 'blocked') throw A.err('You cannot connect with this member.');
      // They had already asked: asking back is a yes.
      if (c.status === 'pending' && c.addresseeId === from.id) { c.status = 'accepted'; c.answeredAt = A.now(); connections.put(c); A.emit(`u:${to.id}`, 'inbox', { kind: 'connection' }); }
      return c;
    }
    const row = { id, requesterId: from.id, addresseeId: to.id, status: 'pending', source: source || 'profile', at: A.now() };
    connections.put(row);
    A.emit(`u:${to.id}`, 'inbox', { kind: 'connection' });
    return row;
  }
  A.hooks.connectRequest = request;

  A.rpc.connect = (me, args) => {
    const to = A.mustUser(args.userId);
    request(me, to, clean(args.source, 30));
    return { state: A.connectionState(me, to) };
  };
  A.rpc.answerConnection = (me, args) => {
    const c = conn(me.id, args.userId);
    if (!c || c.status !== 'pending' || c.addresseeId !== me.id) throw A.err('No pending request from that member.');
    // The limit is on connections HELD, so accepting is checked like asking.
    // (Bug: only the sender was checked; a guest, limit 0, could accept, and
    // a Registered member could pass 25 by accepting instead of asking.)
    if (args.accept) roomFor(me);
    if (args.accept) { c.status = 'accepted'; c.answeredAt = A.now(); connections.put(c); A.emit(`u:${c.requesterId}`, 'inbox', { kind: 'connection' }); }
    else connections.delete(c.id);
    return { ok: true };
  };
  A.rpc.block = (me, args) => {
    const to = A.mustUser(args.userId);
    if (to.id === me.id) throw A.err('That is you.');
    connections.put({ id: pairId(me.id, to.id), requesterId: me.id, addresseeId: to.id, status: 'blocked', at: A.now() });
    return { ok: true };
  };

  // ---- messages -----------------------------------------------------------------------
  A.canMessage = (from, to) => !from.isGuest && !to.isBot && !blocked(from.id, to.id) && (accepted(from.id, to.id) || A.allows(from, 'dm_anyone'));

  A.rpc.sendMessage = (me, args) => {
    const to = A.mustUser(args.toId);
    if (!A.canMessage(me, to)) throw A.err('You can message your connections. Messaging anyone is a Subscriber feature.', 403);
    const body = clean(args.body, 2000);
    if (!body) throw A.err('Write something first.');
    A.limit(`dm:${me.id}`, 40, 60000);
    const m = { id: A.id(), fromId: me.id, toId: to.id, body, at: A.now() };
    messages.put(m);
    A.emit(`u:${to.id}`, 'inbox', { kind: 'message', fromId: me.id });
    return { message: m };
  };
  A.rpc.thread = (me, args) => {
    const other = A.mustUser(args.userId);
    return {
      with: A.card(other, me),
      canMessage: A.canMessage(me, other),
      messages: messages.filter((m) => !m.tableId && ((m.fromId === me.id && m.toId === other.id) || (m.fromId === other.id && m.toId === me.id))).sort((a, b) => a.at - b.at).slice(-200),
    };
  };

  A.rpc.inbox = (me) => {
    const mine = connections.filter((c) => c.requesterId === me.id || c.addresseeId === me.id);
    const otherOf = (c) => users.get(c.requesterId === me.id ? c.addresseeId : c.requesterId);
    const lastWith = (uid) => messages.filter((m) => !m.tableId && ((m.fromId === me.id && m.toId === uid) || (m.fromId === uid && m.toId === me.id))).sort((a, b) => b.at - a.at)[0] || null;
    const intros = introductions.filter((i) => i.fromId === me.id || i.toId === me.id).sort((a, b) => b.at - a.at);
    const introView = (i) => ({ id: i.id, kind: i.kind, reason: i.reason, status: i.status, at: i.at, from: A.card(users.get(i.fromId), me), to: A.card(users.get(i.toId), me) });
    // Threads with people who messaged me without a connection (Subscribers can).
    const strangers = new Set(messages.filter((m) => !m.tableId && m.toId === me.id && m.fromId !== 'arena' && !accepted(me.id, m.fromId)).map((m) => m.fromId));
    return {
      notes: messages.filter((m) => m.toId === me.id && m.fromId === 'arena').sort((a, b) => b.at - a.at).slice(0, 20),
      requests: mine.filter((c) => c.status === 'pending' && c.addresseeId === me.id).map((c) => ({ from: A.card(otherOf(c), me), source: c.source, at: c.at })).filter((r) => r.from),
      connections: mine.filter((c) => c.status === 'accepted').map((c) => { const o = otherOf(c); return o ? { card: A.card(o, me), last: lastWith(o.id) } : null; }).filter(Boolean)
        .sort((a, b) => (b.last ? b.last.at : 0) - (a.last ? a.last.at : 0)),
      others: [...strangers].map((id) => { const o = users.get(id); return o ? { card: A.card(o, me), last: lastWith(id) } : null; }).filter(Boolean),
      introsIn: intros.filter((i) => i.toId === me.id && i.status === 'pending').map(introView),
      introsOut: intros.filter((i) => i.fromId === me.id).slice(0, 20).map(introView),
      challenges: challengeList(me),
    };
  };

  // ---- introductions (mentor / investor / cofounder / opportunity) --------------------------
  A.requestIntro = (from, to, kind, reason, ref = null) => {
    if (from.isGuest) throw A.err('Create a free account to ask for an introduction.', 403);
    if (!A.canSeeBios(from)) throw A.err('Verify your email and complete your profile to ask for introductions.', 403);
    if (from.id === to.id) throw A.err('That is you.');
    if (blocked(from.id, to.id)) throw A.err('You cannot contact this member.');
    if (kind === 'mentor') {
      A.need(from, 'mentor_match', 'Mentor introductions are a Subscriber feature.');
      // Mentors set how many people they will take on a quarter; protect that.
      const since = A.now() - 90 * 86400000;
      const taken = introductions.count((i) => i.toId === to.id && i.kind === 'mentor' && i.status === 'accepted' && i.at > since);
      if (!(to.offers || []).includes('mentoring') || (to.openToMentoring || 0) <= taken) throw A.err('This mentor is not taking new people right now.');
    }
    // No introduction without opt-in on BOTH sides (the header's first
    // guardrail). (Bug: only mentor checked the other person; a Subscriber
    // could ask anyone to be a cofounder and a VIP could send an "investor"
    // introduction to members who never offered capital or asked for it.)
    const has = (u, list, v) => (u[list] || []).includes(v);
    if (kind === 'cofounder') {
      A.need(from, 'cofounder_match', 'Cofounder introductions are a Subscriber feature.');
      if (!has(to, 'intent', 'cofounder')) throw A.err('This member is not looking for a cofounder.');
    }
    if (kind === 'investor') {
      A.need(from, 'investor_match', 'Investor introductions are a VIP feature.');
      // The same pairs the recommender makes (matching.js "venture"), plus a
      // founder asking a member who offers capital.
      const backerAsks = (has(from, 'offers', 'investing') && has(to, 'intent', 'investor'))
        || (has(from, 'offers', 'incubating') && ['mentor', 'investor', 'cofounder'].some((v) => has(to, 'intent', v)));
      const founderAsks = has(to, 'offers', 'investing') && has(from, 'intent', 'investor');
      if (!backerAsks && !founderAsks) throw A.err('Investor introductions need both of you to have opted in.');
    }
    const existing = introductions.find((i) => i.fromId === from.id && i.toId === to.id && i.kind === kind && i.status === 'pending');
    if (existing) return existing;
    A.limit(`intro:${from.id}`, 10, 86400000);
    const row = { id: A.id(), kind, fromId: from.id, toId: to.id, reason: clean(reason, 300), ref, status: 'pending', at: A.now() };
    introductions.put(row);
    A.emit(`u:${to.id}`, 'inbox', { kind: 'intro' });
    return row;
  };
  A.rpc.requestIntro = (me, args) => {
    // "opportunity" is not on this list: that kind exists only as a response
    // to a post on the board (community.js respondOpportunity). (Bug: asked
    // for directly it had no tier or opt-in check at all, so any member could
    // put 300 characters in front of any other member, ten times a day: the
    // "message anyone" Subscriber feature by another name.)
    const kind = ['mentor', 'investor', 'cofounder'].includes(args.kind) ? args.kind : 'cofounder';
    return { intro: A.requestIntro(me, A.mustUser(args.userId), kind, args.reason) };
  };
  A.rpc.answerIntro = (me, args) => {
    const i = introductions.get(args.id);
    if (!i || i.toId !== me.id || i.status !== 'pending') throw A.err('That introduction was already answered.');
    // (Bug: accepting wrote an "accepted" connection over whatever row the
    // pair had, including a block placed after the request was sent.)
    if (args.accept && blocked(me.id, i.fromId)) throw A.err('You cannot connect with this member.');
    i.status = args.accept ? 'accepted' : 'declined'; i.answeredAt = A.now(); introductions.put(i);
    if (args.accept) {
      // Accepting an introduction opens the door: the two are connected.
      const from = users.get(i.fromId);
      if (from) { connections.put({ id: pairId(me.id, from.id), requesterId: from.id, addresseeId: me.id, status: 'accepted', source: `intro:${i.kind}`, at: A.now(), answeredAt: A.now() }); A.notify(from.id, `${me.displayName} accepted your ${i.kind} introduction. You are connected: say hello from your Inbox.`); }
    }
    return { ok: true };
  };

  // ---- challenges -------------------------------------------------------------------------
  function expire(c) { if (c.status === 'pending' && A.now() > c.expiresAt) { c.status = 'expired'; challenges.put(c); } return c; }
  function challengeView(c, me) {
    const g = getGame(c.gameId);
    return { id: c.id, gameId: c.gameId, gameName: g ? g.meta.name : c.gameId, icon: g ? g.meta.icon : '', message: c.message, status: c.status, at: c.at, expiresAt: c.expiresAt, tableId: c.tableId || null, incoming: c.toId === me.id, from: A.card(users.get(c.fromId), me), to: A.card(users.get(c.toId), me) };
  }
  function challengeList(me) {
    return challenges.filter((c) => c.fromId === me.id || c.toId === me.id).map(expire)
      .filter((c) => c.status === 'pending' || (c.status === 'accepted' && tables.get(c.tableId) && tables.get(c.tableId).status !== 'finished'))
      .sort((a, b) => b.at - a.at).slice(0, 30).map((c) => challengeView(c, me));
  }

  A.rpc.challenge = (me, args) => {
    const to = A.mustUser(args.userId);
    const gameId = clean(args.gameId, 40);
    if (!getGame(gameId)) throw A.err('That game is not playable here yet.');
    if (to.id === me.id) throw A.err('You cannot challenge yourself.');
    if (to.isBot) throw A.err('Use "Play a bot" for that.');
    if (blocked(me.id, to.id)) throw A.err('You cannot challenge this member.');
    const sent = challenges.count((c) => c.fromId === me.id && A.now() - c.at < 86400000);
    if (sent >= CHALLENGE_LIMIT[A.tier(me)]) throw A.err('Daily challenge limit reached. Subscribers have unlimited challenges.', 403);
    const c = { id: A.id(), fromId: me.id, toId: to.id, gameId, message: clean(args.message, 200) || null, status: 'pending', at: A.now(), expiresAt: A.now() + CHALLENGE_TTL_MS };
    challenges.put(c);
    A.emit(`u:${to.id}`, 'inbox', { kind: 'challenge' });
    return { challenge: challengeView(c, me) };
  };
  A.rpc.answerChallenge = async (me, args) => {
    const c = challenges.get(args.id);
    if (!c || c.toId !== me.id) throw A.err('That is not your challenge.');
    expire(c);
    if (c.status === 'expired') throw A.err('This challenge has expired.');
    if (c.status !== 'pending') throw A.err('This challenge was already answered.');
    c.answeredAt = A.now();
    if (!args.accept) { c.status = 'declined'; challenges.put(c); return { ok: true }; }
    const challenger = A.mustUser(c.fromId);
    // The challenger hosts; the table is private to the two of them plus bots.
    const t = {
      id: A.id(), gameId: c.gameId, hostId: challenger.id, visibility: 'private', mode: 'realtime', status: 'open', solo: true,
      inviteCode: A.code(8), createdAt: A.now(), lastMoveAt: A.now(), players: [challenger.id, me.id], observers: [], seats: null,
      settings: { size: getGame(c.gameId).meta.seats.defaultSize || getGame(c.gameId).meta.seats.max, fillBots: true, botLevel: 2 },
      question: 'What would it take for you two to work together?', auto: false, autoStartAt: null, challengeId: c.id,
    };
    if (getGame(c.gameId).normalizeSettings) t.settings = getGame(c.gameId).normalizeSettings(t.settings);
    tables.put(t);
    c.status = 'accepted'; c.tableId = t.id; challenges.put(c);
    A.award(me, 'challenge_accepted', POINTS.challengeAccepted, { ref: c.id, once: c.id });
    A.emit(`u:${challenger.id}`, 'inbox', { kind: 'challenge', tableId: t.id });
    A.notify(challenger.id, `${me.displayName} accepted your ${getGame(c.gameId).meta.name} challenge. The table is open: start when you are both there.`);
    return { tableId: t.id };
  };
  A.rpc.cancelChallenge = (me, args) => {
    const c = challenges.get(args.id);
    if (!c || c.fromId !== me.id || c.status !== 'pending') throw A.err('Nothing to cancel.');
    c.status = 'cancelled'; challenges.put(c);
    return { ok: true };
  };

  // ---- invites --------------------------------------------------------------------------------
  A.rpc.inviteInfo = (me) => ({
    code: A.referralCode(me),
    history: invites.filter((i) => i.inviterId === me.id).sort((a, b) => b.at - a.at).slice(0, 20)
      .map((i) => ({ channel: i.channel, name: i.name, contact: i.contact, tableCode: i.tableCode, at: i.at, joined: !!i.joinedUserId })),
  });
  A.rpc.logInvite = (me, args) => {
    if (me.isGuest) throw A.err('Create a free account to invite friends. Guests can still share a table link from the table.', 403);
    const channel = ['sms', 'email', 'share', 'link'].includes(args.channel) ? args.channel : 'link';
    A.limit(`invite:${me.id}`, 60, 3600000);
    invites.put({ id: A.id(), inviterId: me.id, channel, contact: clean(args.contact, 120), name: clean(args.name, 40), tableCode: clean(args.tableCode, 16), code: A.referralCode(me), at: A.now() });
    return { code: me.referralCode };
  };

  // ---- presence and history -----------------------------------------------------------------------
  A.rpc.online = (me) => ({
    members: users.filter((u) => !u.isBot && u.id !== me.id && A.isOnline(u)).sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 30).map((u) => A.card(u, me)),
  });
  A.rpc.tablemates = (me) => {
    const seen = new Map();
    for (const r of results.filter((x) => x.userId === me.id)) {
      for (const o of results.filter((x) => x.tableId === r.tableId && x.userId !== me.id)) {
        const cur = seen.get(o.userId) || { games: 0, last: 0 };
        cur.games += 1; cur.last = Math.max(cur.last, o.at); seen.set(o.userId, cur);
      }
    }
    return { members: [...seen.entries()].sort((a, b) => b[1].last - a[1].last).slice(0, 12).map(([id, v]) => ({ card: A.card(users.get(id), me), games: v.games, last: v.last })).filter((x) => x.card) };
  };

  A.rpc.report = (me, args) => {
    const body = clean(args.body, 1000);
    if (!body) throw A.err('Tell us what happened.');
    A.limit(`report:${me.id}`, 10, 86400000);
    // Ids are short strings. (Bug: userId and tableId were stored as sent,
    // so a report could carry 250 KB of arbitrary JSON into the store.)
    reports.put({ id: A.id(), reporterId: me.id, reportedId: clean(args.userId, 64) || null, tableId: clean(args.tableId, 64) || null, body, at: A.now(), status: 'new' });
    return { ok: true };
  };
}
