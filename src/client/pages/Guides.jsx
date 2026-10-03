// The AI guides: a coach, a mentor, a spark, a historian and a money guide,
// plus the member's own short list of next steps (which the Coach follows up
// on). Every guide is labelled as an AI on every screen it appears on.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Loading, useAction, useToast } from '../components/ui.jsx';
import { GUIDES, GUIDE_MAX_CHARS, GUIDE_NOTICE, guideById } from '../../shared/guides.js';
import { TIER_INFO } from '../../shared/tiers.js';
import { useTimeBeat } from '../timebeat.js';

function Allowance({ s, tier }) {
  if (!s || s.guest) return null;
  if (!s.enabled) return <div className="notice" data-guides="off">The guides are being set up and will be here soon. Your next steps below work already.</div>;
  return (
    <p className="small muted" data-guides="on" data-left={s.left}>
      <b style={{ color: 'var(--ink)' }}>{s.left}</b> of {s.limit} messages left today{tier !== 'ceo' && s.left === 0 ? <> {'·'} <Link to="/membership">a higher membership has more</Link></> : null}
    </p>
  );
}

function Steps() {
  const { user } = useAuth();
  const [steps, setSteps] = useState(null);
  const [text, setText] = useState('');
  const { error, run } = useAction();
  useEffect(() => { rpc('mySteps').then((r) => setSteps(r.steps)).catch(() => setSteps([])); }, []);
  if (user.isGuest) return null;
  const add = (e) => { e.preventDefault(); const t = text.trim(); if (!t) return; run(async () => { const r = await rpc('addStep', { text: t }); setSteps(r.steps); setText(''); }); };
  const open = steps ? steps.filter((s) => !s.done) : [];
  const done = steps ? steps.filter((s) => s.done) : [];
  return (
    <section className="card pad-lg stack" aria-labelledby="steps-title">
      <div><div className="eyebrow">Yours</div><h2 id="steps-title">My next steps</h2><p className="small muted">Small things you said you would do. The Coach sees this list and will ask how they went.</p></div>
      {error && <div className="error" role="alert">{error}</div>}
      {steps && steps.length === 0 && <p className="small muted">Nothing here yet. Add one, or ask the Coach to help you choose it.</p>}
      {open.length > 0 && <ul className="steps">{open.map((s) => (
        <li key={s.id} className="steps__row"><label className="check grow"><input type="checkbox" checked={false} onChange={() => run(async () => setSteps((await rpc('setStep', { id: s.id, done: true })).steps))} /><span>{s.text}</span></label>
          <button type="button" className="btn sm" aria-label={`Remove: ${s.text}`} onClick={() => run(async () => setSteps((await rpc('removeStep', { id: s.id })).steps))}>{'✕'}</button></li>
      ))}</ul>}
      <form className="row" onSubmit={add}><input className="input" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="A step small enough to do this week" aria-label="A new next step" /><button className="btn gold" disabled={!text.trim()}>Add</button></form>
      {done.length > 0 && <details className="small"><summary>Done ({done.length})</summary><ul className="steps">{done.slice(0, 20).map((s) => (
        <li key={s.id} className="steps__row"><label className="check grow"><input type="checkbox" checked onChange={() => run(async () => setSteps((await rpc('setStep', { id: s.id, done: false })).steps))} /><span className="muted" style={{ textDecoration: 'line-through' }}>{s.text}</span></label></li>
      ))}</ul></details>}
    </section>
  );
}

function GuideList() {
  const { user, tier } = useAuth();
  const [s, setS] = useState(null);
  useEffect(() => { rpc('guides').then(setS).catch(() => setS({ enabled: false, guides: [], limit: 0, left: 0, guest: user.isGuest })); }, [user.id, user.isGuest]);
  if (!s) return <Loading />;
  const count = Object.fromEntries((s.guides || []).map((g) => [g.id, g.messages]));
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div>
        <div className="eyebrow">AI guides</div>
        <h1>Your guides</h1>
        <p className="muted">Five AI guides for learning to start and run a business, and to handle money. Ask anything; they know your profile and how your games went.</p>
        <Allowance s={s} tier={tier} />
      </div>
      {s.guest && <div className="notice">The guides are for members. <Link to="/signin?mode=create">Create a free account</Link> to talk to them: {TIER_INFO.free.name} members get a few messages every day.</div>}
      <div className="grid two">
        {GUIDES.map((g) => (
          <Link key={g.id} to={`/guides/${g.id}`} className="card tap stack" data-guide={g.id} style={{ gap: 6 }}>
            <div className="row"><span className="guideicon" aria-hidden="true">{g.icon}</span><div className="grow"><h2>{g.name}</h2><div className="tiny muted">AI {g.role.toLowerCase()}{count[g.id] ? ` · conversation in progress` : ''}</div></div><span className="muted" aria-hidden="true">{'›'}</span></div>
            <p className="small muted">{g.blurb}</p>
          </Link>
        ))}
      </div>
      <Steps />
      <p className="tiny muted">{GUIDE_NOTICE}</p>
    </div>
  );
}

function Conversation({ guide }) {
  const { user, tier } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tableId = params.get('game') || undefined;
  const [t, setT] = useState(null);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(null); // the question being answered
  const [error, setError] = useState('');
  const logRef = useRef(null);

  const load = useCallback(() => rpc('guideThread', { guideId: guide.id, tableId }).then(setT).catch((e) => setError(e.message)), [guide.id, tableId]);
  // Time spent in this conversation counts toward the member's time invested.
  useTimeBeat('guide', guide.id, !user.isGuest);
  useEffect(() => { setT(null); setError(''); load(); }, [load]);
  const count = t ? t.messages.length : 0;
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [count, waiting]);

  const ask = async (q) => {
    const body = (q || text).trim();
    if (!body || waiting) return;
    setError(''); setWaiting(body); setText('');
    try {
      const r = await rpc('askGuide', { guideId: guide.id, text: body, tableId });
      setT((old) => ({ ...(old || {}), ...r }));
    } catch (e) { setError(e.message); setText(body); } finally { setWaiting(null); }
  };
  const startOver = async () => {
    if (!window.confirm(`Start over with ${guide.name}? This conversation will be removed.`)) return;
    await rpc('clearGuideThread', { guideId: guide.id }).catch(() => {});
    if (tableId) setParams({}, { replace: true });
    load();
  };
  const flag = async (m) => {
    const note = window.prompt('What was wrong with this reply? It goes to the VentureArena team.');
    if (note === null) return;
    try { await rpc('flagGuideReply', { guideId: guide.id, at: m.at, note }); toast('Thank you. The team will look at it.'); } catch (e) { setError(e.message); }
  };
  const saveStep = async () => {
    const step = window.prompt('Your next step, in your own words:');
    if (!step || !step.trim()) return;
    try { await rpc('addStep', { text: step.trim() }); toast('Saved to My next steps'); } catch (e) { setError(e.message); }
  };

  if (!t && !error) return <Loading />;
  const off = t && !t.enabled; const out = t && t.enabled && t.left <= 0; const guest = t && t.guest;
  const canAsk = t && t.enabled && !guest && t.left > 0;
  return (
    <div className="guide">
      <div className="row"><button type="button" className="btn sm" onClick={() => nav('/guides')} aria-label="Back to all guides">{'←'}</button>
        <span className="guideicon" aria-hidden="true">{guide.icon}</span>
        <div className="grow"><h1 className="guide__name">{guide.name}</h1><div className="tiny muted">AI {guide.role.toLowerCase()} {'·'} can be wrong {'·'} not financial, legal or tax advice</div></div>
        {t && t.messages.length > 0 && <button type="button" className="btn sm" onClick={startOver}>Start over</button>}
      </div>
      {t && t.game && <div className="notice small">About your <b>{t.game.gameName}</b> game: the guide can see how it went.</div>}
      <div className="card guide__log" ref={logRef} role="log" aria-label={`Conversation with ${guide.name}`} aria-busy={!!waiting}>
        {t && t.messages.length === 0 && !waiting && (
          <div className="stack">
            <p className="muted">{guide.blurb}</p>
            {canAsk && <div className="stack" style={{ gap: 6 }}><div className="eyebrow">Try asking</div>
              {(t.game ? [`What should I take from my ${t.game.gameName} game?`, ...guide.starters.slice(0, 2)] : guide.starters).map((q) => <button key={q} type="button" className="choice small" onClick={() => ask(q)}>{q}</button>)}</div>}
          </div>
        )}
        {t && t.messages.map((m) => (m.role === 'user'
          ? <div key={m.at} className="bubble mine"><span className="sr-only">You: </span>{m.text}</div>
          : <div key={m.at} className="guide__reply"><span className="sr-only">{guide.name}: </span><div className="bubble guide__text">{m.text}</div>
            <div className="guide__acts"><button type="button" className="linkbtn tiny" onClick={saveStep}>Save a next step</button><button type="button" className="linkbtn tiny" onClick={() => flag(m)}>Report this reply</button></div></div>))}
        {waiting && <><div className="bubble mine"><span className="sr-only">You: </span>{waiting}</div><div className="bubble guide__text muted" role="status">{guide.name} is thinking{'…'}</div></>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {guest ? <div className="notice">The guides are for members. <Link to="/signin?mode=create">Create a free account</Link> to ask.</div>
        : off ? <div className="notice" data-guides="off">The guides are being set up and will be here soon.</div>
          : out ? <div className="notice">You have used today{'’'}s {t.limit} messages. They reset at midnight UTC.{tier !== 'ceo' && <> <Link to="/membership">A higher membership has more.</Link></>}</div>
            : (
              <form className="guide__send" onSubmit={(e) => { e.preventDefault(); ask(); }}>
                <textarea className="input" rows={2} maxLength={GUIDE_MAX_CHARS} value={text} placeholder={`Ask ${guide.name}`} aria-label={`Ask ${guide.name}`} disabled={!!waiting}
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
                <button className="btn gold" disabled={!text.trim() || !!waiting}>{waiting ? '…' : 'Ask'}</button>
              </form>
            )}
      {t && t.enabled && !guest && <div className="tiny muted" data-left={t.left}>{t.left} of {t.limit} messages left today {'·'} {GUIDE_NOTICE.split('. ').slice(-1)[0]}</div>}
      {user.under18 && <div className="tiny muted">For anything about money, contracts or meeting people, involve a parent or guardian.</div>}
    </div>
  );
}

export default function Guides() {
  const { id } = useParams();
  if (!id) return <GuideList />;
  const guide = guideById(id);
  if (!guide) return <div className="stack" style={{ maxWidth: 520 }}><div className="card stack" role="alert"><h2>No such guide</h2><p className="muted">There are five: the Coach, the Mentor, the Spark, the Historian and the Money Guide.</p></div><div><Link className="btn gold" to="/guides">See the guides</Link></div></div>;
  return <Conversation guide={guide} key={guide.id} />;
}
