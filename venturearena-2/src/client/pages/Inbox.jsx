// Inbox: notes from the arena, introductions, connection requests, and
// conversations. Introductions are kept apart from chat on purpose: they are
// decisions, not messages.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useEvent, localEvent } from '../realtime.js';
import { Avatar, Loading, useAction } from '../components/ui.jsx';
import { timeAgo } from '../../shared/profile.js';

export default function Inbox() {
  const { userId } = useParams();
  const nav = useNavigate();
  const { user, allows } = useAuth();
  const [box, setBox] = useState(null);
  const [thread, setThread] = useState(null);
  const [text, setText] = useState('');
  const logRef = useRef(null);
  const { error, run } = useAction();

  const load = useCallback(() => rpc('inbox').then(setBox).catch(() => {}), []);
  // The tab-bar badge is counted by the Layout: tell it when a request here was
  // answered (it used to keep showing the old number until the next page).
  const answered = () => { localEvent('inbox', { kind: 'answered' }); };
  const loadThread = useCallback(() => { if (userId) rpc('thread', { userId }).then(setThread).catch((e) => setThread({ failed: e.message })); else setThread(null); }, [userId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadThread(); }, [loadThread]);
  useEvent('inbox', (p) => { load(); if (p && p.kind === 'message' && p.fromId === userId) loadThread(); });
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread && thread.messages && thread.messages.length]);

  if (!box) return <Loading />;
  const send = () => run(async () => { const body = text.trim(); if (!body) return; setText(''); await rpc('sendMessage', { toId: userId, body }); loadThread(); });
  const pendingChallenges = box.challenges.filter((c) => c.incoming && c.status === 'pending');

  if (userId && thread && thread.failed) return <div className="stack" style={{ maxWidth: 520 }}><div className="card stack" role="alert"><h2>No conversation here</h2><p className="muted">{thread.failed}</p></div><div><Link className="btn gold" to="/inbox">Back to the inbox</Link></div></div>;
  if (userId) {
    return (
      <div className="stack" style={{ height: 'calc(100dvh - var(--tabbar) - 80px)', minHeight: 380 }}>
        <div className="row"><button type="button" className="btn sm" onClick={() => nav('/inbox')} aria-label="Back to the inbox">{'←'}</button>
          {thread && <><Avatar p={thread.with} size={32} /><Link to={`/p/${thread.with.username}`} className="grow truncate" style={{ fontWeight: 650, color: 'inherit' }}>{thread.with.displayName}</Link></>}</div>
        <div className="card chat grow">
          <div className="chat__log" ref={logRef}>
            {thread && thread.messages.length === 0 && <div className="tiny muted">Starter: ask what their last game taught them about cash.</div>}
            {!thread && <div className="tiny muted">Opening the conversation{'…'}</div>}
            {thread && thread.messages.map((m) => <div key={m.id} className={`bubble${m.fromId === user.id ? ' mine' : ''}`}><span className="sr-only">{m.fromId === user.id ? 'You: ' : `${thread.with.displayName}: `}</span>{m.body}</div>)}
          </div>
          {error && <div className="error" role="alert">{error}</div>}
          {thread && !thread.canMessage ? <div className="small muted" style={{ marginTop: 8 }}>You can message your connections. Messaging anyone is a Subscriber feature.</div> : (
            <div className="row" style={{ marginTop: 8 }}><input className="input" maxLength={2000} value={text} placeholder="Message" disabled={!thread} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} aria-label="Message" /><button className="btn gold" disabled={!text.trim()} onClick={send}>Send</button></div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 680 }}>
      <h1>Inbox</h1>
      {error && <div className="error" role="alert">{error}</div>}
      {pendingChallenges.length > 0 && <section className="stack"><div className="eyebrow">Challenges</div>{pendingChallenges.map((c) => (
        <div key={c.id} className="card hot stack"><div className="row"><Avatar p={c.from} size={32} /><div className="grow small"><b>{c.from.displayName}</b> challenged you to {c.gameName}{c.message ? <div className="muted"><i>{'“'}{c.message}{'”'}</i></div> : null}</div></div>
          <div className="row-wrap"><button className="btn gold sm" onClick={() => run(async () => { const r = await rpc('answerChallenge', { id: c.id, accept: true }); nav(`/t/${r.tableId}`); })}>Accept</button><button className="btn sm" onClick={() => run(async () => { await rpc('answerChallenge', { id: c.id, accept: false }); answered(); })}>Decline</button></div></div>
      ))}</section>}
      {box.introsIn.length > 0 && <section className="stack"><div className="eyebrow">Introductions</div>{box.introsIn.map((i) => (
        <div key={i.id} className="card stack"><div className="row"><Avatar p={i.from} size={32} /><Link to={`/p/${i.from.username}`} className="grow truncate" style={{ fontWeight: 650, color: 'inherit' }}>{i.from.displayName}</Link><span className="chip" style={{ textTransform: 'capitalize', flex: 'none' }}>{i.kind}</span></div>
          {i.reason && <p className="small muted">{i.reason}</p>}
          <div className="row-wrap"><button className="btn gold sm" onClick={() => run(async () => { await rpc('answerIntro', { id: i.id, accept: true }); answered(); })}>Accept</button><button className="btn sm" onClick={() => run(async () => { await rpc('answerIntro', { id: i.id, accept: false }); answered(); })}>Not now</button></div></div>
      ))}</section>}
      {box.requests.length > 0 && <section className="stack"><div className="eyebrow">Connection requests</div>{box.requests.map((r) => (
        // Name on its own line, buttons under it: beside the buttons a long name was squeezed to one letter per line.
        <div key={r.from.id} className="card stack"><div className="row"><Avatar p={r.from} size={32} /><Link to={`/p/${r.from.username}`} className="grow truncate" style={{ fontWeight: 650, color: 'inherit' }}>{r.from.displayName}</Link></div>
          <div className="row-wrap"><button className="btn gold sm" onClick={() => run(async () => { await rpc('answerConnection', { userId: r.from.id, accept: true }); answered(); })}>Accept</button><button className="btn sm" onClick={() => run(async () => { await rpc('answerConnection', { userId: r.from.id, accept: false }); answered(); })}>Decline</button></div></div>
      ))}</section>}
      <section className="stack"><div className="eyebrow">Connections</div>
        {box.connections.length === 0 && box.others.length === 0 && <div className="small muted">Connect with someone after a game and they will appear here.{allows('dm_anyone') ? ' As a Subscriber you can also message anyone from their profile.' : ''}</div>}
        {[...box.connections, ...box.others].map((c) => (
          <Link key={c.card.id} to={`/inbox/${c.card.id}`} className="card row tap"><Avatar p={c.card} size={36} dot={c.card.online} /><div className="grow"><div className="truncate" style={{ fontWeight: 650 }}>{c.card.displayName}</div><div className="tiny muted truncate">{c.last ? c.last.body : 'Say hello'}</div></div>{c.last && <span className="tiny muted">{timeAgo(c.last.at)}</span>}</Link>
        ))}
      </section>
      {box.notes.length > 0 && <section className="stack"><div className="eyebrow">From the arena</div>{box.notes.map((n) => <div key={n.id} className="card small"><div>{n.body}</div><div className="tiny muted" style={{ marginTop: 4 }}>{timeAgo(n.at)}</div></div>)}</section>}
      {box.introsOut.length > 0 && <section className="stack"><div className="eyebrow">Sent</div>{box.introsOut.map((i) => <div key={i.id} className="small muted">{i.kind} intro to {i.to.displayName}: {i.status === 'declined' ? 'not now' : i.status}</div>)}</section>}
    </div>
  );
}
