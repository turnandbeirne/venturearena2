// Game history: every game you finished, and for each one the result, who was
// there and what was said at the table. Your own history is complete at every
// membership level; a game's chat opens only for the people who were there.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Avatar, Loading } from '../components/ui.jsx';
import { ordinal, timeAgo } from '../../shared/profile.js';

const day = (ts) => new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const clock = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const lasted = (a, b) => { if (!a || !b || b <= a) return null; const m = Math.round((b - a) / 60000); return m < 1 ? 'under a minute' : m < 90 ? `${m} min` : `${Math.round(m / 60)} hours`; };

function GameList() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [gameId, setGameId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const load = useCallback((before = null) => {
    setBusy(true);
    return rpc('myGames', { gameId: gameId || undefined, before: before || undefined })
      .then((r) => { setData(r); setRows((old) => (before ? [...old, ...r.rows] : r.rows)); })
      .catch((e) => setFailed(e.message)).finally(() => setBusy(false));
  }, [gameId]);
  useEffect(() => { load(); }, [load]);

  if (failed) return <div className="error" role="alert">{failed}</div>;
  if (!data) return <Loading />;
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <div>
        <div className="eyebrow">Your record</div>
        <h1>Game history</h1>
        <p className="muted">{data.total === 0 ? 'Every game you finish is kept here, with the table chat.' : `${data.total} game${data.total === 1 ? '' : 's'} finished, ${data.wins} won. Open one to see how it went and what was said.`}</p>
      </div>
      {user.isGuest && data.total > 0 && <div className="notice">This history belongs to your guest session on this device. <Link to="/signin?mode=create">Create a free account</Link> to keep it.</div>}
      {data.games.length > 1 && (
        <div className="row-wrap" role="group" aria-label="Show games of">
          <button type="button" className={`chip${gameId === '' ? ' on' : ''}`} aria-pressed={gameId === ''} onClick={() => setGameId('')}>All games</button>
          {data.games.map((g) => <button key={g.gameId} type="button" className={`chip${gameId === g.gameId ? ' on' : ''}`} aria-pressed={gameId === g.gameId} onClick={() => setGameId(g.gameId)}><span aria-hidden="true">{g.icon}</span> {g.gameName} <span style={{ opacity: 0.75 }}>{g.played}</span></button>)}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="card stack"><p className="muted">No finished games yet.</p><div><Link className="btn gold" to="/play">Play a game</Link></div></div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {rows.map((h) => (
            <Link key={h.tableId} to={`/history/${h.tableId}`} className="card row tap" data-history-row={h.gameId}>
              <span className="histrank" data-won={h.won ? '1' : '0'}><b>{ordinal(h.placement)}</b><span>of {h.players}</span></span>
              <span className="grow">
                <span className="truncate" style={{ display: 'block', fontWeight: 700 }}><span aria-hidden="true">{h.icon}</span> {h.gameName}</span>
                <span className="tiny muted truncate" style={{ display: 'block' }}>{h.others.length ? `with ${h.others.map((o) => o.name).join(', ')}` : 'Solo'}</span>
                <span className="tiny muted" style={{ display: 'block' }}>{day(h.at)} {'·'} {timeAgo(h.at)}{h.chatCount > 0 ? ` · ${h.chatCount} message${h.chatCount === 1 ? '' : 's'}` : ''}{h.takeover ? ' · finished by a bot' : ''}</span>
              </span>
              <span className={h.delta >= 0 ? 'good' : 'bad'} style={{ fontWeight: 700, flex: 'none' }} aria-label={`Rating ${h.delta >= 0 ? 'up' : 'down'} ${Math.abs(h.delta)}`}>{h.delta >= 0 ? '+' : ''}{h.delta}</span>
              <span className="muted" aria-hidden="true" style={{ flex: 'none' }}>{'›'}</span>
            </Link>
          ))}
          {data.more && <button type="button" className="btn" disabled={busy} onClick={() => load(rows[rows.length - 1].at)}>{busy ? 'Loading…' : 'Show earlier games'}</button>}
        </div>
      )}
    </div>
  );
}

function GameRecord({ id }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rec, setRec] = useState(null);
  const [gone, setGone] = useState('');
  useEffect(() => { setRec(null); setGone(''); rpc('gameRecord', { id }).then(setRec).catch((e) => setGone(e.message)); }, [id]);

  if (gone) return <div className="stack" style={{ maxWidth: 520 }}><div className="card stack" role="alert"><h2>No record here</h2><p className="muted">{gone}</p></div><div><Link className="btn gold" to="/history">Back to your history</Link></div></div>;
  if (!rec) return <Loading />;
  const t = rec.table; const took = lasted(t.startedAt, t.endedAt);
  const said = rec.chat.filter((m) => !m.system).length;
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/history')}>{'←'} All games</button>
      <div>
        <div className="eyebrow">{t.endedAt ? `${day(t.endedAt)} · ${clock(t.endedAt)}` : 'Finished game'}{took ? ` · ${took}` : ''}</div>
        <h1><span aria-hidden="true">{t.icon}</span> {t.gameName}</h1>
        <p className="muted">{rec.mine ? (rec.mine.won ? 'You won this one.' : `You finished ${ordinal(rec.mine.placement)} of ${rec.standings.length}.`) : 'You watched this game.'}{rec.mine ? ` Rating ${rec.mine.ratingBefore} → ${rec.mine.ratingAfter}.` : ''}{rec.mine && rec.mine.takeover ? ' A bot finished it for you.' : ''}</p>
      </div>

      <section className="card stack" aria-labelledby="hist-standings">
        <h2 id="hist-standings">Final standings</h2>
        <div className="stack" style={{ gap: 6 }}>
          {rec.standings.map((s) => (
            <div key={s.seat} className="row small" data-you={s.you ? '1' : '0'} style={s.you ? { fontWeight: 700 } : undefined}>
              <span className={s.placement === 1 ? 'gold' : 'muted'} style={{ width: 34, flex: 'none', fontWeight: 700 }}>{ordinal(s.placement)}</span>
              <Avatar p={{ avatar: s.avatar }} size={28} />
              <span className="grow truncate">{s.username && !s.you ? <Link to={`/p/${s.username}`} style={{ color: 'inherit' }}>{s.name}</Link> : s.name}{s.you ? ' (you)' : ''}{s.bot ? <span className="muted"> {'·'} bot</span> : null}{s.takeover ? <span className="muted"> {'·'} finished by a bot</span> : null}</span>
              {s.score !== null && s.score !== undefined && <span className="muted">{s.score}</span>}
              {s.delta !== null && <span className={s.delta >= 0 ? 'good' : 'bad'} style={{ width: 40, textAlign: 'right', flex: 'none' }}>{s.delta >= 0 ? '+' : ''}{s.delta}</span>}
            </div>
          ))}
        </div>
        {t.hasDebrief && <div><Link className="btn sm" to={`/debrief/${t.id}`}>Open the debrief</Link></div>}
      </section>

      <section className="card stack" aria-labelledby="hist-chat">
        <div className="between"><h2 id="hist-chat">Table talk</h2><span className="tiny muted">{said === 0 ? 'Nothing was said' : `${said} message${said === 1 ? '' : 's'}`}</span></div>
        {rec.chat.length === 0 ? <p className="small muted">Nobody typed anything at this table.</p> : (
          <div className="histchat" role="log" aria-label="What was said at the table">
            {rec.chat.map((m) => (m.system
              ? <div key={m.id} className="chat__sys small">{m.body}</div>
              : <div key={m.id} className="histchat__line"><span className="histchat__who">{m.fromId === user.id ? 'You' : m.name}</span><span className="histchat__body">{m.body}</span><time className="histchat__at" dateTime={new Date(m.at).toISOString()}>{clock(m.at)}</time></div>))}
          </div>
        )}
        <p className="tiny muted">Only the people who were at this table can read this.</p>
      </section>

      {rec.answers.length > 0 && (
        <section className="card stack" aria-labelledby="hist-reflect">
          <div><div className="eyebrow">Reflection</div><h2 id="hist-reflect">{rec.question}</h2></div>
          {rec.answers.map((a) => <div key={`${a.userId}-${a.at}`} className="small"><b>{a.userId === user.id ? 'You' : a.name}:</b> {a.answer}</div>)}
        </section>
      )}
    </div>
  );
}

export default function History() {
  const { id } = useParams();
  return id ? <GameRecord id={id} /> : <GameList />;
}
