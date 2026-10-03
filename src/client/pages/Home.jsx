// Home: the living room. Who is around, what is waiting for you, and the two
// daily rituals (a real business question, a one-question quiz).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useEvent } from '../realtime.js';
import { Avatar, PersonRow, useAction, useToast } from '../components/ui.jsx';
import InvitePanel from '../components/InvitePanel.jsx';
import { PERSONAS, timeAgo } from '../../shared/profile.js';
import { PAID_PROGRAMS, TIER_INFO, TIER_RANK } from '../../shared/tiers.js';

export function AccessNotice() {
  const { user } = useAuth();
  if (!user) return null;
  const a = user.access;
  if (a.level === 'anonymous') return <div className="notice">You are playing as a guest. <Link to="/signin?mode=create">Create a free account</Link> to keep your record, get a player card and meet the people you play with.</div>;
  if (a.level === 'unverified') return <div className="notice">Confirm your email (check your inbox) to keep your record and unlock introductions.</div>;
  if (a.level === 'verified') return <div className="notice">Complete your profile to see bios, get introductions and earn bonus points. <Link to="/me">Finish your profile ({a.surveyScore}%)</Link></div>;
  return null;
}

export default function Home() {
  const { user, refresh, tier } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [lobby, setLobby] = useState(null);
  const [daily, setDaily] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [take, setTake] = useState('');
  const { error, run } = useAction();

  const loadDaily = useCallback(() => rpc('daily').then(setDaily).catch(() => {}), []);
  const loadInbox = useCallback(() => rpc('inbox').then(setInbox).catch(() => {}), []);
  const loadLobby = useCallback(() => rpc('lobby').then(setLobby).catch(() => {}), []);
  useEffect(() => {
    // The daily check-in happens by showing up: no button to forget.
    rpc('checkin').then((r) => { setCheckin(r); if (r.awarded) { toast(`Day ${r.streak} streak: +${r.awarded} Arena Points`); refresh().catch(() => {}); } }).catch(() => {});
    loadDaily(); loadInbox(); loadLobby();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEvent('inbox', loadInbox);
  useEvent('lobby', loadLobby);
  useEvent('daily', loadDaily);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const card = user.card;
  const answer = (choice) => run(async () => { const r = await rpc('answerQuiz', { id: daily.quiz.id, choice }); setDaily((d) => ({ ...d, quiz: { ...d.quiz, answered: true, ...r } })); if (r.awarded) { toast(`+${r.awarded} Arena Points`); refresh().catch(() => {}); } });
  const post = () => run(async () => { const r = await rpc('replyTopic', { body: take }); setTake(''); await loadDaily(); if (r.awarded) { toast(`+${r.awarded} Arena Points`); refresh().catch(() => {}); } });
  const answerChallenge = (id, accept) => run(async () => { const r = await rpc('answerChallenge', { id, accept }); if (r.tableId) nav(`/t/${r.tableId}`); else loadInbox(); });
  const pending = inbox ? inbox.challenges.filter((c) => c.status === 'pending') : [];
  const accepted = inbox ? inbox.challenges.filter((c) => c.status === 'accepted' && c.tableId) : [];

  return (
    <div className="stack-lg">
      <div className="card pad-lg stack">
        <div><div className="eyebrow">{greeting}</div><h1>{user.isGuest && /^guest$/i.test(user.displayName) ? 'Welcome, guest' : user.displayName}</h1>
          <p className="muted">{card.personaLabel ? <>You play like a <b style={{ color: 'var(--ink)' }}>{card.personaLabel}</b>. {PERSONAS[card.personaLabel]}</> : 'Play your first game and the arena will start reading your style.'}</p></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          <div className="pcard"><div className="stat" data-stat="streak"><b>{checkin ? checkin.streak : user.streak || 0}</b><span>Day streak</span></div></div>
          <div className="pcard"><div className="stat" data-stat="points"><b>{user.points || 0}</b><span title="Arena Points">Points</span></div></div>
          <div className="pcard"><div className="stat" data-stat="rank"><b>{card.rank}</b><span>Rank</span></div></div>
        </div>
        {user.stats && user.stats.games > 0 && <div><Link className="btn sm" to="/history">Your game history and chats</Link></div>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <AccessNotice />

      {lobby && lobby.mine.length > 0 && (
        <section className="stack">
          <h2>Your games</h2>
          {lobby.mine.map((t) => (
            <button key={t.id} type="button" className={`card row choice${t.myTurn ? ' on' : ''}`} onClick={() => nav(`/t/${t.id}`)}>
              <span className="grow"><b>{t.gameName}</b> <span className="chip">{t.status === 'open' ? 'seating' : t.myTurn ? 'your move' : 'in play'}</span><span className="tiny muted" style={{ display: 'block' }}>{t.status === 'open' ? 'Waiting for players' : 'Continue the game'}</span></span><span aria-hidden="true" className="gold" style={{ fontSize: '1.3rem' }}>{'›'}</span>
            </button>
          ))}
        </section>
      )}

      {(pending.length > 0 || accepted.length > 0) && (
        <section className="stack">
          <h2>Challenges</h2>
          {pending.map((c) => (c.incoming ? (
            <div key={c.id} className="card hot stack">
              <div className="row"><Avatar p={c.from} size={36} /><div className="grow"><b>{c.from ? c.from.displayName : 'Someone'}</b> challenged you to {c.gameName}{c.message && <div className="small muted"><i>{'“'}{c.message}{'”'}</i></div>}</div></div>
              <div className="row-wrap"><button className="btn gold sm" onClick={() => answerChallenge(c.id, true)}>Accept</button><button className="btn sm" onClick={() => answerChallenge(c.id, false)}>Decline</button></div>
            </div>
          ) : <div key={c.id} className="card small between"><span className="grow">Waiting for <b>{c.to ? c.to.displayName : 'them'}</b> to answer your {c.gameName} challenge.</span><button type="button" className="btn sm" onClick={() => run(async () => { await rpc('cancelChallenge', { id: c.id }); loadInbox(); })}>Cancel</button></div>))}
          {accepted.map((c) => <button key={c.id} type="button" className="card choice on" onClick={() => nav(`/t/${c.tableId}`)}><b>{c.from.displayName} vs {c.to.displayName}</b><span className="tiny muted" style={{ display: 'block' }}>{c.gameName} {'·'} open the table</span></button>)}
        </section>
      )}

      <section className="stack">
        <div className="between"><h2>In the arena now</h2><Link className="btn sm" to="/people">See everyone</Link></div>
        {lobby && lobby.onlineSample.length > 0
          ? <div className="hscroll">{lobby.onlineSample.map((o) => <Link key={o.id} to={`/p/${o.username}`} className="card center" style={{ width: 104, color: 'inherit', textDecoration: 'none', padding: 10 }}><Avatar p={o} size={44} dot /><div className="small truncate" style={{ fontWeight: 650, marginTop: 4 }}>{o.displayName}</div><div className="tiny muted truncate">{o.personaLabel || (o.isGuest ? 'guest' : 'member')}</div></Link>)}</div>
          : <div className="card small muted">Nobody else is online right now. Play a bot, or challenge someone and they will get it when they are back.</div>}
      </section>

      <div className="card band pad-lg stack">
        <h2>Get in the game</h2>
        <p className="small muted">Every game here ends with a question worth answering and a person worth knowing. Five to twenty minutes, with friends or bots.</p>
        <Link className="btn gold" to="/play">Pick a game</Link>
      </div>

      {daily && (
        <section className="grid two">
          <div className="card stack">
            <div className="eyebrow">Topic of the day {'·'} {daily.topic.theme}</div>
            <h2>{daily.topic.title}</h2>
            <p className="small">{daily.topic.prompt}</p>
            <div className="stack" style={{ gap: 8 }}>
              {daily.topic.replies.length === 0 && <div className="small muted">No takes yet. Be the first.</div>}
              {daily.topic.replies.map((r) => <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}><Avatar p={r} size={26} /><div className="small grow"><b>{r.name}</b> <span className="muted tiny">{timeAgo(r.at)}</span><div>{r.body}</div></div></div>)}
            </div>
            {user.isGuest ? <div className="small muted">Create a free account to join the conversation.</div> : (
              <div className="row"><input className="input" maxLength={1000} placeholder="Your take (earns 5 points)" value={take} onChange={(e) => setTake(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && take.trim()) post(); }} aria-label="Your take" /><button className="btn gold" disabled={!take.trim()} onClick={post}>Post</button></div>
            )}
          </div>
          <div className="card stack">
            <div className="eyebrow">Daily quiz {'·'} {daily.quiz.theme}</div>
            <h2>{daily.quiz.question}</h2>
            <div className="stack" style={{ gap: 8 }}>
              {daily.quiz.options.map((opt, i) => {
                const q = daily.quiz; const right = q.answered && i === q.answerIndex; const wrong = q.answered && i === q.myChoice && !q.correct;
                return <button key={i} type="button" className="choice" data-quiz-option={right ? 'right' : wrong ? 'wrong' : q.answered ? 'other' : 'open'} disabled={q.answered} onClick={() => answer(i)} style={{ borderColor: right ? 'var(--ok)' : wrong ? 'var(--warn)' : undefined, opacity: q.answered && !right && !wrong ? 0.7 : 1 }}><b>{'ABCD'[i]}</b> {opt}{right && <span className="good small"> {'✓'} correct answer</span>}{wrong && <span className="bad small"> {'✗'} your answer</span>}</button>;
              })}
            </div>
            {daily.quiz.answered && <p className="small" role="status" data-quiz-result={daily.quiz.correct ? 'correct' : 'incorrect'}><b className={daily.quiz.correct ? 'good' : 'bad'}>{daily.quiz.correct ? 'Correct.' : 'Not quite.'}</b> {daily.quiz.explanation}</p>}
          </div>
        </section>
      )}

      {!user.isGuest && <InvitePanel compact title="Invite a friend" />}

      <section className="card stack">
        <div className="between"><h2>Member programs</h2><Link className="btn sm" to="/membership">{TIER_RANK[tier] >= 2 ? 'Manage plan' : 'See plans'}</Link></div>
        <div className="row-wrap">{PAID_PROGRAMS.map((p) => { const open = TIER_RANK[tier] >= TIER_RANK[p.tier]; return <Link key={p.id} to="/membership" className="chip" title={`${p.label}: ${TIER_INFO[p.tier].name} and up`}>{open ? '✓' : '\u{1F512}'} {p.short}</Link>; })}</div>
      </section>
    </div>
  );
}
