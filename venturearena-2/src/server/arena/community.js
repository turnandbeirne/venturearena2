// The daily rhythm (topic of the day, quiz), the opportunities board, the
// feedback loop and membership billing.
import crypto from 'node:crypto';
import { clean } from './context.js';
import { TOPICS, QUIZ } from '../data/daily-content.js';
import { TIER_RANK } from '../../shared/tiers.js';
import { POINTS } from '../../shared/profile.js';

const FEEDBACK_KINDS = ['general', 'suggestion', 'problem'];
/** kind -> the feature needed to post it. Asks are open to every registered member. */
export const OPPORTUNITY_KINDS = {
  seeking_cofounder: { label: 'Looking for a cofounder', feature: 'post_ask' },
  seeking_mentor: { label: 'Looking for a mentor', feature: 'post_ask' },
  seeking_role: { label: 'Looking for a role or internship', feature: 'post_ask' },
  seeking_clients: { label: 'Looking for first customers', feature: 'post_ask' },
  role: { label: 'Role or internship on offer', feature: 'post_offer' },
  incubation: { label: 'Incubation: teams and companies wanted', feature: 'post_venture_call' },
  investment: { label: 'Investing: what I want to see', feature: 'post_venture_call' },
  challenge: { label: 'Business challenge: team wanted', feature: 'post_venture_call' },
};

/** Own keys only: "constructor" and "__proto__" are not kinds. */
const kindOf = (kind) => (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(OPPORTUNITY_KINDS, kind) ? OPPORTUNITY_KINDS[kind] : null);

export function install(A) {
  const { users, topicReplies, quizAnswers, feedback, opportunities, waitlist } = A.c;

  // ---- topic of the day and daily quiz --------------------------------------------------
  // The bank rotates by day-of-epoch, so it never runs dry and every member
  // sees the same item on the same UTC day.
  const dayIndex = (n) => Math.floor(A.now() / 86400000) % n;
  const topicToday = () => { const i = dayIndex(TOPICS.length); const [theme, title, prompt] = TOPICS[i]; return { id: `topic-${i}`, theme, title, prompt }; };
  const quizToday = () => { const i = dayIndex(QUIZ.length); const [theme, question, options, answerIndex, explanation] = QUIZ[i]; return { id: `quiz-${i}`, theme, question, options, answerIndex, explanation }; };

  // The bank repeats (89 questions, one a day), so an answer only counts for
  // the day it was given. (Bug: answers were looked up by question alone, so
  // from the second lap on every day's quiz arrived already answered, with
  // the answer showing and nothing to earn. The bank "never runs dry" only
  // if a lap later the question is a question again.)
  const answerToday = (me, quiz) => {
    const row = quizAnswers.get(`${me.id}:${quiz.id}`);
    return row && A.day(row.at) === A.day() ? row : null;
  };

  A.rpc.daily = (me) => {
    const topic = topicToday();
    const quiz = quizToday();
    const mine = answerToday(me, quiz);
    return {
      topic: {
        ...topic,
        replies: topicReplies.filter((r) => r.topicId === topic.id).sort((a, b) => a.at - b.at).slice(-50).map((r) => { const u = users.get(r.userId); return { id: r.id, body: r.body, at: r.at, name: u ? u.displayName : 'Member', avatar: u ? u.avatar : null, userId: r.userId }; }),
      },
      quiz: {
        id: quiz.id, theme: quiz.theme, question: quiz.question, options: quiz.options, answered: !!mine,
        // The answer is only sent once this member has committed to one.
        ...(mine ? { myChoice: mine.choice, correct: mine.correct, answerIndex: quiz.answerIndex, explanation: quiz.explanation } : {}),
      },
    };
  };

  A.rpc.replyTopic = (me, args) => {
    if (me.isGuest) throw A.err('Create a free account to join the conversation.', 403);
    const body = clean(args.body, 1000);
    if (!body) throw A.err('Write your take first.');
    A.limit(`topic:${me.id}`, 10, 3600000);
    const topic = topicToday();
    topicReplies.put({ id: A.id(), topicId: topic.id, userId: me.id, body, at: A.now() });
    // First reply to the topic OF THE DAY: the key carries the day because the
    // bank repeats every 90 days (same reasoning as answerToday above).
    const awarded = A.award(me, 'topic_reply', POINTS.topicReply, { ref: topic.id, once: `${topic.id}:${A.day()}` }) ? POINTS.topicReply : 0;
    A.emit('lobby', 'daily', {});
    return { awarded };
  };

  A.rpc.answerQuiz = (me, args) => {
    const quiz = quizToday();
    // Only today's question can be answered (the earlier build accepted any id).
    if (args.id !== quiz.id) throw A.err('That question has rotated out. Refresh for today\'s.');
    const id = `${me.id}:${quiz.id}`;
    let row = answerToday(me, quiz);
    let awarded = 0;
    if (!row) {
      // A number or a numeric string. (Bug: Number(null), Number('') and
      // Number([]) are 0, so a request with no choice was recorded as
      // answer A and could not be changed.)
      const raw = args.choice;
      const choice = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
      if (!Number.isInteger(choice) || choice < 0 || choice >= quiz.options.length) throw A.err('Pick one of the answers.');
      row = { id, userId: me.id, quizId: quiz.id, choice, correct: choice === quiz.answerIndex, at: A.now() };
      quizAnswers.put(row);
      const amount = row.correct ? POINTS.quizRight : POINTS.quizWrong;
      awarded = A.award(me, 'quiz', amount, { once: A.day() }) ? amount : 0;
    }
    return { correct: row.correct, myChoice: row.choice, answerIndex: quiz.answerIndex, explanation: quiz.explanation, awarded };
  };

  // ---- opportunities board ----------------------------------------------------------------
  // Both sides of the community in one list: people asking (a cofounder, a
  // mentor, a role, first customers) and people offering (roles, incubation,
  // capital, real business challenges for a team to tackle).
  const oppView = (o, me) => ({ id: o.id, kind: o.kind, kindLabel: kindOf(o.kind).label, title: o.title, body: o.body, at: o.at, mine: o.userId === me.id, responded: (o.responders || []).includes(me.id), responses: o.userId === me.id ? (o.responders || []).length : undefined, by: A.card(users.get(o.userId), me) });

  A.rpc.opportunities = (me, args) => {
    const kind = kindOf(args.kind) ? args.kind : null;
    const list = opportunities.filter((o) => o.status === 'open' && kindOf(o.kind) && (!kind || o.kind === kind) && users.get(o.userId))
      .sort((a, b) => (TIER_RANK[A.tier(users.get(b.userId))] === 4) - (TIER_RANK[A.tier(users.get(a.userId))] === 4) || b.at - a.at).slice(0, 60);
    const canPost = {};
    for (const [k, v] of Object.entries(OPPORTUNITY_KINDS)) canPost[k] = A.allows(me, v.feature);
    return { items: list.map((o) => oppView(o, me)), kinds: Object.entries(OPPORTUNITY_KINDS).map(([id, v]) => ({ id, label: v.label, canPost: canPost[id], feature: v.feature })) };
  };
  A.rpc.postOpportunity = (me, args) => {
    const def = kindOf(args.kind);
    if (!def) throw A.err('Pick what kind of post this is.');
    if (me.isGuest) throw A.err('Create a free account to post.', 403);
    A.need(me, def.feature, def.feature === 'post_venture_call' ? 'Incubation, investment and challenge posts are a VIP feature.' : 'Posting roles is a Subscriber feature.');
    const title = clean(args.title, 100); const body = clean(args.body, 1200);
    if (title.length < 6 || body.length < 20) throw A.err('Give it a clear title and a few sentences of detail.');
    if (opportunities.count((o) => o.userId === me.id && o.status === 'open') >= 5) throw A.err('You have 5 open posts. Close one first.');
    const o = { id: A.id(), userId: me.id, kind: args.kind, title, body, status: 'open', responders: [], at: A.now() };
    opportunities.put(o);
    return { item: oppView(o, me) };
  };
  A.rpc.closeOpportunity = (me, args) => {
    const o = opportunities.get(args.id);
    if (!o || o.userId !== me.id) throw A.err('That is not your post.');
    o.status = 'closed'; opportunities.put(o);
    return { ok: true };
  };
  A.rpc.respondOpportunity = (me, args) => {
    const o = opportunities.get(args.id);
    if (!o || o.status !== 'open') throw A.err('That post has closed.');
    if (o.userId === me.id) throw A.err('That is your own post.');
    const owner = A.mustUser(o.userId);
    // A response is an introduction: the poster accepts or declines in their Inbox.
    A.requestIntro(me, owner, 'opportunity', `Re: ${o.title}. ${clean(args.note, 240)}`, o.id);
    o.responders = o.responders || [];
    if (!o.responders.includes(me.id)) { o.responders.push(me.id); opportunities.put(o); }
    return { ok: true };
  };

  // ---- feedback loop ------------------------------------------------------------------------
  A.rpc.sendFeedback = (me, args) => {
    const kind = FEEDBACK_KINDS.includes(args.kind) ? args.kind : 'general';
    const body = clean(args.body, 4000);
    if (body.length < 3) throw A.err('Tell us a little more.');
    A.limit(`feedback:${me.id}`, 10, 3600000);
    const scope = clean(args.scope, 40) || 'arena';
    const n = feedback.size + 1;
    const f = { id: String(n), userId: me.id, kind, scope, body, page: clean(args.page, 200), status: 'new', response: null, at: A.now() };
    feedback.put(f);
    const what = kind === 'problem' ? 'problem report' : kind === 'suggestion' ? 'suggestion' : 'feedback';
    A.notify(me.id, `Thanks for the ${what} about ${scope}. We read every one; you will hear back here once it has been acted on.`);
    return { id: f.id };
  };

  // ---- membership ---------------------------------------------------------------------------
  const stripe = A.config.stripe || {};
  const stripeReady = () => !!(stripe.secret && stripe.prices && stripe.prices.member);
  // price id -> tier, configured prices only. A Map, and no empty ids. (Bug:
  // this was a plain object built from every plan, so with PRICE_VIP and
  // PRICE_CEO unset the id "" meant "ceo", and a price id of "constructor"
  // was stored as the member's tier.)
  const tierForPrice = new Map(Object.entries(stripe.prices || {}).filter(([, price]) => typeof price === 'string' && price).map(([tier, price]) => [price, tier]));
  async function stripeCall(path, params) {
    const body = new URLSearchParams(params).toString();
    const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${stripe.secret}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await res.json();
    if (!res.ok) throw A.err(data.error && data.error.message ? data.error.message : 'Billing is unavailable right now.', 502);
    return data;
  }

  A.rpc.membership = (me) => ({ tier: A.tier(me), billingLive: stripeReady(), waitlisted: !!waitlist.get(me.id), expiresAt: me.tierExpiresAt || null });

  A.rpc.checkout = async (me, args) => {
    const tier = ['member', 'vip', 'ceo'].includes(args.tier) ? args.tier : null;
    if (!tier) throw A.err('Unknown plan.');
    if (me.isGuest || !me.email) throw A.err('Create a free account first, then pick a plan.', 403);
    if (!stripeReady()) {
      // Billing not switched on yet: record exactly which plan they wanted.
      waitlist.put({ id: me.id, tier, at: A.now() });
      return { waitlisted: true, tier };
    }
    if (!stripe.prices[tier]) throw A.err('That plan is not on sale yet.');
    if (!me.stripeCustomerId) {
      const c = await stripeCall('customers', { email: me.email, 'metadata[user_id]': me.id });
      me.stripeCustomerId = c.id; users.put(me);
    }
    const s = await stripeCall('checkout/sessions', {
      customer: me.stripeCustomerId, mode: 'subscription', 'line_items[0][price]': stripe.prices[tier], 'line_items[0][quantity]': '1',
      allow_promotion_codes: 'true', success_url: `${A.config.publicUrl}/membership?upgraded=1`, cancel_url: `${A.config.publicUrl}/membership`,
    });
    return { url: s.url };
  };
  A.rpc.billingPortal = async (me) => {
    if (!stripeReady() || !me.stripeCustomerId) throw A.err('No billing account yet.');
    const s = await stripeCall('billing_portal/sessions', { customer: me.stripeCustomerId, return_url: `${A.config.publicUrl}/membership` });
    return { url: s.url };
  };

  /** Verify a Stripe webhook signature (t=...,v1=...) without the SDK. */
  A.verifyStripeSignature = (rawBody, header, secret = stripe.webhookSecret, toleranceSec = 300) => {
    if (!header || !secret) return false;
    const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')));
    if (!parts.t || !parts.v1) return false;
    // A timestamp that is not a number fails. (Bug: NaN compared false, so
    // "t=abc" skipped the freshness check entirely.)
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(A.now() / 1000 - t) > toleranceSec) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(parts.v1);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  /** The webhook is the ONLY writer of a paid tier (besides the admin tool). */
  A.stripeWebhook = async (rawBody, signature) => {
    if (!A.verifyStripeSignature(rawBody, signature)) throw A.err('bad signature', 400);
    const event = JSON.parse(rawBody);
    const apply = (sub) => {
      // An event with no customer matches nobody. (Bug: `null === null`
      // matched the first account that had never paid, and gave it the tier.)
      const u = typeof sub.customer === 'string' && sub.customer ? users.find((x) => x.stripeCustomerId === sub.customer) : null;
      if (!u) return;
      const item = sub.items && sub.items.data && sub.items.data[0];
      const active = sub.status === 'active' || sub.status === 'trialing';
      u.tier = active ? tierForPrice.get(item && item.price && item.price.id) || 'free' : 'free';
      const period = sub.current_period_end || (item && item.current_period_end);
      // A few days of grace so a late renewal webhook never downgrades a paying member.
      u.tierExpiresAt = active && period ? period * 1000 + 3 * 86400000 : null;
      users.put(u);
      A.emit(`u:${u.id}`, 'me', {});
    };
    if (event.type === 'checkout.session.completed' && event.data.object.subscription) {
      const res = await fetch(`https://api.stripe.com/v1/subscriptions/${event.data.object.subscription}`, { headers: { Authorization: `Bearer ${stripe.secret}` } });
      if (res.ok) apply(await res.json());
    } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
      apply(event.data.object);
    }
    return { received: true };
  };

  // ---- admin (ADMIN_TOKEN) --------------------------------------------------------------------
  A.admin = {
    setTier(usernameOrEmail, tier) {
      if (!Object.prototype.hasOwnProperty.call(TIER_RANK, tier) || tier === 'anonymous') throw A.err('Unknown tier.');
      const key = typeof usernameOrEmail === 'string' ? usernameOrEmail.trim().toLowerCase() : '';
      const u = key ? users.find((x) => x.username === key || x.email === key) : null;
      if (!u) throw A.err('No such member.', 404);
      u.tier = tier; u.tierExpiresAt = null; users.put(u);
      A.emit(`u:${u.id}`, 'me', {});
      return { username: u.username, tier };
    },
    feedback(status) { return feedback.filter((f) => !status || f.status === status).sort((a, b) => b.at - a.at).slice(0, 200).map((f) => ({ ...f, by: (users.get(f.userId) || {}).username })); },
    respondFeedback(id, status, response) {
      const f = feedback.get(String(id));
      if (!f) throw A.err('No such feedback.', 404);
      f.status = clean(status, 20) || 'done'; f.response = clean(response, 1000); f.respondedAt = A.now(); feedback.put(f);
      A.notify(f.userId, `Your ${f.kind} #${f.id}: ${f.status}. ${f.response} Thank you for helping the arena get better for every entrepreneur learning with VentureMaker.`);
      return f;
    },
    /** A one-hour reset link the operator sends by hand (no mail provider, or a member who lost the email). */
    resetLink(usernameOrEmail) {
      const key = typeof usernameOrEmail === 'string' ? usernameOrEmail.trim().toLowerCase() : '';
      const u = key ? users.find((x) => !x.isBot && !x.isGuest && (x.username === key || x.email === key)) : null;
      if (!u) throw A.err('No such member.', 404);
      return { username: u.username, link: A.makeResetLink(u), validMinutes: 60 };
    },
    reports() { return A.c.reports.all().sort((a, b) => b.at - a.at).slice(0, 200); },
    waitlist() { return waitlist.all().map((w) => ({ ...w, email: (users.get(w.id) || {}).email })); },
    stats() {
      const us = users.filter((u) => !u.isBot);
      return { members: us.filter((u) => !u.isGuest).length, guests: us.filter((u) => u.isGuest).length, online: us.filter((u) => A.isOnline(u)).length, tablesOpen: A.c.tables.count((t) => t.status === 'open'), tablesPlaying: A.c.tables.count((t) => t.status === 'playing'), gamesFinished: A.c.tables.count((t) => t.status === 'finished'), byTier: us.reduce((m, u) => { const t = A.tier(u); m[t] = (m[t] || 0) + 1; return m; }, {}) };
    },
  };
}
