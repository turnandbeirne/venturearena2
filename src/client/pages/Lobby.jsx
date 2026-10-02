// Play: every game, three ways in (a bot right now, a quick match, your own
// table), then your tables and everyone else's.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useEvent } from '../realtime.js';
import { useGames } from '../games.js';
import { Avatar, Loading, useAction } from '../components/ui.jsx';

export default function Lobby() {
  const { tier } = useAuth();
  const nav = useNavigate();
  const games = useGames();
  const [lobby, setLobby] = useState(null);
  const [recs, setRecs] = useState([]);
  const [note, setNote] = useState('');
  const { error, busy, run } = useAction();

  const load = useCallback(() => rpc('lobby').then(setLobby).catch(() => {}), []);
  useEffect(() => { load(); rpc('recommendations').then((r) => setRecs((r.by.playmate || []).slice(0, 3))).catch(() => {}); }, [load]);
  useEvent('lobby', load);

  const go = (name, args) => run(async () => { const r = await rpc(name, args); nav(`/t/${r.table.id}`); });
  const close = (staleOnly) => run(async () => { const r = await rpc('closeMyTables', { staleOnly }); setNote(r.closed ? `Closed ${r.closed} table${r.closed === 1 ? '' : 's'}.` : staleOnly ? 'No tables older than 2 hours.' : 'No open tables.'); load(); });

  if (!games || !lobby) return <Loading what="Opening the lobby" />;
  const name = (id) => (games.games.find((g) => g.id === id) || { name: id }).name;
  const families = [['venturemaker', 'VentureMaker games', 'Original games about entrepreneurship, business and finance.'], ['classic', 'Classic strategy', 'Timeless games, each with a business lesson attached.']];

  return (
    <div className="stack-lg">
      <div className="between">
        <div><h1>Play</h1><p className="small muted">{lobby.online} in the arena right now</p></div>
        <div className="row" style={{ gap: 0 }}>{lobby.onlineSample.slice(0, 6).map((o) => <Link key={o.id} to={`/p/${o.username}`} title={o.displayName} style={{ marginLeft: -6 }}><Avatar p={o} size={30} /></Link>)}</div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {note && <div className="notice">{note}</div>}

      {lobby.mine.length > 0 && (
        <section className="stack">
          <div className="between"><h2>Your tables</h2>
            <div className="row-wrap"><button className="btn sm" onClick={() => close(true)} title="Leave or close every table of yours older than 2 hours">Close stale</button><button className="btn sm" onClick={() => close(false)}>Close all</button></div></div>
          <div className="grid two">
            {lobby.mine.map((t) => (
              <div key={t.id} className={`card row${t.myTurn ? ' hot' : ''}`}>
                <div className="grow"><div style={{ fontWeight: 650 }}>{t.gameName} <span className="chip">{t.status === 'open' ? 'waiting' : t.myTurn ? 'your move' : 'in play'}</span></div>
                  <div className="tiny muted">{t.role === 'host' ? 'You host' : t.role === 'observer' ? 'You watch' : 'You play'} {'·'} {t.people} at the table{t.mode === 'turn_based' ? ' · turn-based' : ''}</div></div>
                <button className="btn gold sm" onClick={() => nav(`/t/${t.id}`)}>{t.status === 'open' ? 'Go to table' : 'Rejoin'}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {families.map(([family, title, blurb]) => {
        const list = games.games.filter((g) => g.family === family);
        if (!list.length) return null;
        return (
          <section key={family} className="stack">
            <div><h2>{title}</h2><p className="small muted">{blurb}</p></div>
            <div className="grid three">
              {list.map((g) => (
                <div key={g.id} className="card stack" data-game-card={g.id}>
                  <div className="row"><span style={{ fontSize: 26 }} aria-hidden="true">{g.icon}</span><div className="grow"><h3>{g.name}</h3><div className="tiny muted">{g.seats.min === g.seats.max ? `${g.seats.min} players` : `${g.seats.min}-${g.seats.max} players`} {'·'} {g.minutes} min</div></div></div>
                  <p className="small muted grow">{g.tagline}</p>
                  <div className="row-wrap">{g.skills.slice(0, 3).map((s) => <span key={s} className="chip">{s}</span>)}</div>
                  <div className="row-wrap">
                    <button className="btn gold sm grow" disabled={busy} onClick={() => go('playBots', { gameId: g.id })}>Play a bot</button>
                    <button className="btn sm" disabled={busy} onClick={() => go('quickMatch', { gameId: g.id })} title="Sit at an open table near your rating, or open one">Quick match</button>
                    <button className="btn sm" disabled={busy} onClick={() => go('createTable', { gameId: g.id })} title="Open your own table and invite people">Host</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <p className="tiny muted">Hosting several tables at once: guests and registered members 1, Subscribers 3, VIPs 10, CEOs unlimited.{tier === 'anonymous' ? ' Add an email on the Me tab to keep your history and meet the people you play.' : ''}</p>

      {recs.length > 0 && (
        <section className="stack">
          <h2>People who fit you</h2>
          <div className="grid three">{recs.map((r) => <Link key={r.userId} to={`/p/${r.card.username}`} className="card tap"><div className="row"><Avatar p={r.card} size={36} dot={r.card.online} /><div className="grow"><div className="truncate" style={{ fontWeight: 650 }}>{r.card.displayName}</div><div className="tiny muted">{r.reason}</div></div></div></Link>)}</div>
        </section>
      )}

      <section className="stack">
        <h2>Open tables</h2>
        {lobby.open.filter((t) => !t.role).length === 0 ? (
          <div className="card center muted small">No open tables right now. Quick match seats you with a bot if nobody shows. Up to 7 people can be at any table: players fill the seats, everyone else watches and joins the debrief.</div>
        ) : (
          <div className="grid two">
            {lobby.open.filter((t) => !t.role).map((t) => {
              const seatsFull = t.players.length >= t.maxSeats; const full = t.people >= 7;
              return (
                <div key={t.id} className="card row">
                  <div className="grow"><div style={{ fontWeight: 650 }}>{t.gameName} <span className="chip">{t.mode === 'turn_based' ? 'turn-based' : 'live'}</span></div>
                    <div className="tiny muted">Hosted by {t.host ? t.host.displayName : 'someone'} {'·'} {t.players.length}/{t.maxSeats} playing{t.watching ? ` · ${t.watching} watching` : ''}</div>
                    <div className="row" style={{ gap: 2, marginTop: 6 }}>{t.players.map((p) => <Avatar key={p.id} p={p} size={24} />)}</div></div>
                  <div className="stack" style={{ gap: 6 }}>
                    <button className="btn gold sm" disabled={seatsFull || full || busy} onClick={() => go('joinTable', { id: t.id, role: 'player' })}>{seatsFull ? 'Seats full' : 'Join'}</button>
                    <button className="btn sm" disabled={full || busy} onClick={() => go('joinTable', { id: t.id, role: 'observer' })}>Watch</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {lobby.live.filter((t) => !t.role).length > 0 && (
        <section className="stack">
          <h2>In play now</h2>
          <div className="grid two">{lobby.live.filter((t) => !t.role).map((t) => (
            <div key={t.id} className="card row"><div className="grow"><div style={{ fontWeight: 650 }}>{name(t.gameId)}</div><div className="tiny muted">{t.players.map((p) => p.name).join(', ')}{t.watching ? ` · ${t.watching} watching` : ''}</div></div>
              <button className="btn sm" disabled={busy} onClick={() => go('joinTable', { id: t.id, role: 'observer' })}>Watch</button></div>
          ))}</div>
        </section>
      )}

      {games.extras.length > 0 && (
        <section className="stack">
          <h2>More games</h2>
          <div className="grid three">
            {games.extras.map((g) => (
              <div key={g.id} className="card stack dashed">
                <div className="between"><h3><span aria-hidden="true">{g.icon}</span> {g.name}</h3><span className="chip">{g.status === 'soon' ? 'Coming soon' : 'Partner'}</span></div>
                <p className="small muted">{g.tagline}</p>
                {g.url && <a className="btn sm" href={g.url} target="_blank" rel="noopener noreferrer">Open {'↗'}</a>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
