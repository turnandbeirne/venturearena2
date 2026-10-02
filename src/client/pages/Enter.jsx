// The front door inside the app. The static landing page (built for search
// engines) links here; so do venturemaker.org's "Play now" buttons:
//   /enter?go=guest            straight in as a guest, no click
//   /enter?play=<gameId>       straight into a game against bots
//   /enter?next=/t/abc         back to where you were going
//   ?from=venturemaker|ventureflow shows a welcome strip
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { rpc } from '../api.js';
import { ARCHETYPES } from '../../shared/profile.js';

export default function Enter() {
  const { user, loading, enterAsGuest } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const from = params.get('from');
  const play = params.get('play');
  const next = params.get('next');
  const auto = params.get('go') === 'guest' || !!play;
  const ran = useRef(false);

  const go = async () => {
    setBusy(true); setErr('');
    try {
      await enterAsGuest();
      if (play) { const r = await rpc('playBots', { gameId: play }); nav(`/t/${r.table.id}`, { replace: true }); return; }
      nav(next && next.startsWith('/') && !next.startsWith('//') ? next : '/play', { replace: true });
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  useEffect(() => {
    if (loading || ran.current) return;
    if (user || auto) { ran.current = true; go(); }
  }, [loading, user, auto]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || ((user || auto) && !err)) return <div className="main muted">Opening the doors{'…'}</div>;

  return (
    <div className="main stack-lg" style={{ maxWidth: 640, paddingTop: 28 }}>
      <div className="between"><div className="brand" style={{ fontSize: '1.4rem' }}>VentureArena<small>by VentureMaker</small></div><Link className="btn sm" to={`/signin${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link></div>
      {from === 'ventureflow' && <div className="notice">Coming from VentureFlow? Enter, pick a name, and open a VentureFlow table to play others live.</div>}
      {from === 'venturemaker' && <div className="notice">Welcome from VentureMaker. Play as a guest with no signup, or add an email later to keep your history and meet other founders.</div>}
      {typeof localStorage !== 'undefined' && localStorage.getItem('va.ref') && <div className="notice">You were invited by a friend. Create a free account and you will be connected automatically.</div>}
      <div className="stack">
        <h1>Play business. Meet your people.</h1>
        <p className="muted">A community of entrepreneurs who play: aspiring founders, mentors, investors and seasoned operators. Strategy games where every round is a business decision, then the conversation that follows.</p>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      <div className="stack">
        <button className="btn gold block" style={{ minHeight: 54, fontSize: '1.1rem' }} onClick={go} disabled={busy}>{busy ? 'Opening the doors…' : 'Enter the Arena'}</button>
        <div className="small muted center">No signup. Play first; add an email later to keep your record.</div>
      </div>
      <div className="row-wrap">{Object.entries(ARCHETYPES).map(([k, a]) => <span key={k} className="chip"><span className="pip" style={{ background: a.color }} aria-hidden="true" />{a.name}</span>)}</div>
      <p className="tiny muted">Five archetypes. Find yours in three minutes, then find your complement.</p>
    </div>
  );
}
