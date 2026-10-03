// A member's public page: card, bio (when you may see it), play style,
// ratings and recent games.
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PlayerCard, BioBlock, PersonaBlock, Loading, useAction, useToast } from '../components/ui.jsx';
import ChallengeButton from '../components/ChallengeButton.jsx';
import { ordinal, timeAgo } from '../../shared/profile.js';

export function Record({ data, own = false }) {
  return (
    <>
      <div className="card stack">
        <div className="between"><h2>Arena record</h2><span className="chip">Arena rank: {data.rank}</span></div>
        {data.ratings.length === 0 ? <p className="small muted">No rated games yet.</p> : (
          <div className="stack" style={{ gap: 6 }}>{data.ratings.map((r) => <div key={r.gameId} className="row small"><span className="grow truncate" style={{ fontWeight: 600 }}>{r.gameName}</span><span title="Skill rank">{r.rank.icon} {r.rank.name}</span><span className="muted">{r.rating}</span><span className="muted">{r.wins}/{r.games} won</span></div>)}</div>
        )}
      </div>
      <div className="card stack">
        <div className="between"><h2>Recent games</h2>{own ? <Link className="btn sm" to="/history">All games and chats</Link> : data.historyLimited && <span className="tiny muted">Last 30 days {'·'} <Link to="/membership">full history for Subscribers</Link></span>}</div>
        {data.recent.length === 0 ? <p className="small muted">No finished games yet.</p> : (
          <div className="stack" style={{ gap: 6 }}>{data.recent.map((h) => (
            <div key={h.tableId} className="row small" data-history={h.gameId}><span className={h.placement === 1 ? 'gold' : 'muted'} style={{ width: 34, flex: 'none' }}>{ordinal(h.placement)}</span>
              <span className="grow"><span className="truncate" style={{ display: 'block', fontWeight: 600 }}>{h.gameName}</span><span className="tiny muted">{h.players} players {'·'} {timeAgo(h.at)}</span></span>
              <span className={h.delta >= 0 ? 'good' : 'bad'}>{h.delta >= 0 ? '+' : ''}{h.delta}</span>{own ? <Link to={`/history/${h.tableId}`} className="btn sm" aria-label={`Record and chat of this ${h.gameName} game`}>Open</Link> : <Link to={`/debrief/${h.tableId}`} className="btn sm" aria-label={`Debrief of this ${h.gameName} game`}>Debrief</Link>}</div>
          ))}</div>
        )}
      </div>
    </>
  );
}

export default function Profile() {
  const { username } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [gone, setGone] = useState('');
  const { error, run } = useAction();
  const load = () => rpc('profile', { username }).then(setData).catch((e) => setGone(e.message));
  useEffect(() => { setData(null); setGone(''); load(); }, [username]); // eslint-disable-line react-hooks/exhaustive-deps
  if (gone) return <div className="stack" style={{ maxWidth: 520 }}><div className="card stack" role="alert"><h2>Nobody here by that name</h2><p className="muted">{gone}</p></div><div><Link className="btn gold" to="/people">See who is in the arena</Link></div></div>;
  if (!data) return <Loading />;
  if (data.self) return <Navigate to="/me" replace />;
  const c = data.card;
  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => (window.history.length > 1 ? nav(-1) : nav('/people'))}>{'←'} Back</button>
      <PlayerCard p={c} />
      {error && <div className="error" role="alert">{error}</div>}
      {!c.isBot && (
        <div className="row-wrap">
          <ChallengeButton card={c} className="btn gold" />
          {!user.isGuest && !c.isGuest && (data.connection === 'none' ? <button className="btn" onClick={() => run(async () => { await rpc('connect', { userId: c.id }); toast('Connection request sent'); load(); })}>+ Connect</button>
            : data.connection === 'incoming' ? <button className="btn" onClick={() => run(async () => { await rpc('answerConnection', { userId: c.id, accept: true }); load(); })}>Accept request</button>
              : <span className="chip">{data.connection === 'connected' ? 'Connected' : 'Requested'}</span>)}
          {data.canMessage && <Link className="btn" to={`/inbox/${c.id}`}>Message</Link>}
          {user.access.features.vouch && <button className="btn" onClick={() => run(async () => { await rpc('vouch', { userId: c.id }); toast('Vouched'); load(); })}>Vouch</button>}
          <button className="btn sm" onClick={() => { const body = window.prompt('What happened? This goes to the VentureArena team, not to the member.'); if (body) run(async () => { await rpc('report', { userId: c.id, body }); toast('Report sent. Thank you.'); }); }}>Report</button>
        </div>
      )}
      {c.locked && <div className="notice">Bio, goals and contact links are shown to members with a verified email and a completed profile. <Link to="/me">Finish yours</Link> to see them.</div>}
      <BioBlock p={c} />
      {data.headToHead && data.headToHead.games > 0 && <div className="card small"><span className="muted">Head to head:</span> {data.headToHead.games} games, you {data.headToHead.aWins} {'–'} {data.headToHead.bWins} them</div>}
      <PersonaBlock card={c} />
      <Record data={data} />
    </div>
  );
}
