// The Debrief replaces a bare "game over": the result, one question everyone
// answers, two taps on how each other played, and a way to stay in touch.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useEvent, useTableRoom } from '../realtime.js';
import { Avatar, Confetti, Loading, useAction, useToast } from '../components/ui.jsx';
import { CHIPS, ordinal } from '../../shared/profile.js';

export default function Debrief() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [gone, setGone] = useState(null); // { title, text, to, cta }
  const [mine, setMine] = useState('');
  const [sent, setSent] = useState({});
  const { error, run } = useAction();

  const load = useCallback(() => rpc('debrief', { id }).then(setD).catch(() => {}), [id]);
  // The result is recorded a moment after the last move; retry briefly. But
  // only when there is a result to wait for: a table that never existed, was
  // private, or is still being played says so at once instead of showing
  // "Recording the result" for seven seconds first.
  useEffect(() => {
    let tries = 0; let timer; let alive = true;
    const none = { title: 'No debrief here', text: 'That game does not exist, or it was closed before it finished.', to: '/play', cta: 'Back to the arena' };
    const attempt = async () => {
      try { const r = await rpc('debrief', { id }); if (alive) setD(r); return; } catch (e) {
        if (!alive) return;
        if (e.status === 403) { setGone({ ...none, title: 'That table was private', text: 'Only the people who were at a private table can open its debrief.' }); return; }
        if (tries === 0) {
          try {
            const r = await rpc('table', { id });
            if (!alive) return;
            if (r.table.status === 'open' || r.table.status === 'playing' || r.table.status === 'starting') { setGone({ title: 'That game is not over yet', text: 'The debrief opens when the game ends.', to: `/t/${id}`, cta: 'Go to the table' }); return; }
            if (r.table.status === 'abandoned') { setGone({ ...none, text: 'That game was abandoned before it finished, so there is no result to debrief.' }); return; }
          } catch (e2) { if (!alive) return; if (e2.status === 404 || e2.status === 403) { setGone(none); return; } }
        }
        if (++tries < 6) timer = setTimeout(attempt, 1200); else setGone({ ...none, text: e.message });
      }
    };
    attempt();
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);
  useTableRoom(id);
  useEvent('debrief', (p) => { if (p.id === id) load(); });

  if (gone) return <div className="stack" style={{ maxWidth: 520 }}><div className="card stack" role="alert"><h2>{gone.title}</h2><p className="muted">{gone.text}</p></div><div><Link className="btn gold" to={gone.to}>{gone.cta}</Link></div></div>;
  if (!d) return <Loading what="Recording the result" />;

  const me = d.mine;
  const myAnswer = d.answers.find((a) => a.userId === user.id);
  const others = d.standings.filter((s) => s.userId && s.userId !== user.id && s.card);
  const delta = me ? me.ratingAfter - me.ratingBefore : 0;
  const give = (toId, chip, kudos) => run(async () => { const r = await rpc('giveFeedback', { id, toId, chip, kudos }); setD((x) => ({ ...x, given: { ...x.given, [toId]: r.given } })); });
  const connect = (toId) => run(async () => { await rpc('connect', { userId: toId, source: 'table' }); setSent((s) => ({ ...s, [toId]: 'Requested' })); });
  const rematch = (toId) => run(async () => { await rpc('challenge', { userId: toId, gameId: d.table.gameId, message: 'Rematch?' }); toast('Rematch challenge sent'); });
  const again = () => run(async () => { const r = await rpc('playBots', { gameId: d.table.gameId }); nav(`/t/${r.table.id}`); });
  // "Runner-up" only means something when there was a third place to beat.
  const title = me ? (me.won ? 'You won!' : me.placement === 1 ? 'A draw' : me.placement === 2 && d.standings.length > 2 ? 'Runner-up' : 'Good game') : d.watched ? 'You watched' : 'Game over';

  return (
    <div className="stack-lg" style={{ maxWidth: 680, margin: '0 auto' }}>
      {me && me.won && <Confetti />}
      <div className={`card pad-lg stack${me && me.won ? ' hot' : ''}`}>
        <div><div className="eyebrow">Result {'·'} {d.table.gameName}</div><h1>{title}</h1>
          {me && me.won && <p className="gold small">Winner's circle. Your rating, reputation and this result are now on your card and in your history.</p>}
          {d.watched && <p className="small muted">Observers do not get a rating change, but your take on the game counts in the debrief.</p>}</div>
        {me && (
          <div className="stack">
            <div className="row-wrap">
              <span className="chip" style={{ fontSize: '0.9rem', padding: '6px 12px' }} title={`${me.wins} wins in ${me.games} games`}>{me.rank.icon} Skill rank: <b>{me.rank.name}</b> {'·'} {me.ratingAfter} <span className={delta >= 0 ? 'good' : 'bad'}>({delta >= 0 ? '+' : ''}{delta})</span></span>
            </div>
            {me.insight && <p className="small">{me.insight}</p>}
            {me.observations.length > 0 && <div className="small"><div className="eyebrow">How you played</div><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{me.observations.map((o) => <li key={o}>{o}</li>)}</ul></div>}
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          {d.standings.map((s) => (
            <div key={s.seat} className="row small">
              <span className="muted" style={{ width: 30 }}>{ordinal(s.placement)}</span>
              <Avatar p={s.card || { avatar: s.avatar }} size={24} />
              <span className="grow truncate" style={{ fontWeight: 600 }}>{s.card ? <Link to={`/p/${s.card.username}`} style={{ color: 'inherit' }}>{s.name}</Link> : s.name}{s.bot ? ' (bot)' : ''}{s.takeover ? ' (finished by a bot)' : ''}</span>
              {s.score !== null && s.score !== undefined && <span className="muted">{typeof s.score === 'number' ? s.score.toLocaleString() : s.score}</span>}
              {s.ratingAfter !== null && <span className={s.ratingAfter >= s.ratingBefore ? 'good' : 'bad'}>{s.ratingAfter - s.ratingBefore >= 0 ? '+' : ''}{s.ratingAfter - s.ratingBefore} {'→'} {s.ratingAfter}</span>}
            </div>
          ))}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
      </div>

      <div className="card pad-lg stack">
        <div><div className="eyebrow">Reflection</div><h2>{d.question}</h2></div>
        {myAnswer ? <p className="small"><span className="muted">You:</span> {myAnswer.answer}</p> : (
          <div className="row"><input className="input" maxLength={500} placeholder="One or two sentences" value={mine} onChange={(e) => setMine(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && mine.trim()) run(async () => { await rpc('answerDebrief', { id, answer: mine }); load(); }); }} aria-label="Your reflection" />
            <button className="btn gold" disabled={!mine.trim()} onClick={() => run(async () => { await rpc('answerDebrief', { id, answer: mine }); load(); })}>Post</button></div>
        )}
        {d.answers.filter((a) => a.userId !== user.id).map((a) => <p key={a.userId} className="small pop" data-answer={a.userId}><b>{a.name}:</b> {a.answer}</p>)}
        {d.lesson && (d.lessonLocked
          ? <p className="small"><span className="gold">Lesson card:</span> {d.lesson} <Link to="/membership">Full lessons for Subscribers</Link></p>
          : <details className="small"><summary className="gold" style={{ cursor: 'pointer' }}>The lesson</summary><p style={{ marginTop: 8 }}>{d.lesson}</p></details>)}
      </div>

      {others.length > 0 && (
        <div className="card pad-lg stack">
          <div className="eyebrow">People</div>
          {others.map((o) => {
            const g = d.given[o.userId] || {};
            return (
              <div key={o.userId} className="stack" style={{ gap: 8 }} data-person={o.userId}>
                <div className="row"><Avatar p={o.card} size={32} /><Link to={`/p/${o.card.username}`} className="grow truncate" style={{ fontWeight: 650, color: 'inherit' }}>{o.name}</Link></div>
                <div className="tiny muted">One word for how they played</div>
                <div className="row-wrap" role="group" aria-label={`One word for how ${o.name} played`}>{CHIPS.map((c) => <button key={c} type="button" aria-pressed={g.chip === c} className={`chip${g.chip === c ? ' on' : ''}`} style={{ textTransform: 'capitalize' }} onClick={() => give(o.userId, c, !!g.kudos)}>{c}</button>)}</div>
                <div className="row-wrap">
                  <button className="btn sm" disabled={!!g.kudos} onClick={() => give(o.userId, g.chip || null, true)}>{g.kudos ? 'Kudos sent' : 'Kudos'}</button>
                  {!user.isGuest && !o.card.isGuest && <button className="btn sm" disabled={!!sent[o.userId]} onClick={() => connect(o.userId)}>{sent[o.userId] || '+ Connect'}</button>}
                  <button className="btn sm" onClick={() => rematch(o.userId)}>Rematch</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {user.isGuest && <div className="notice">That game is on your guest record. <Link to="/signin?mode=create">Create a free account</Link> to keep it and get your player card.</div>}
      <div className="row-wrap"><button className="btn gold" onClick={again}>Play again</button>{!user.isGuest && d.mine && <Link to={`/guides/coach?game=${id}`} className="btn">Talk it through with the Coach</Link>}<Link to="/play" className="btn">Back to the arena</Link></div>
    </div>
  );
}
