// An invite link: /join/<code> seats you, /join/<code>/watch seats you as an
// observer. Works signed out: you are let in as a guest first.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { rpc } from '../api.js';

export default function Join({ watch = false }) {
  const { code } = useParams();
  const { loading, enterAsGuest } = useAuth();
  const nav = useNavigate();
  const [err, setErr] = useState('');
  const ran = useRef(false);
  useEffect(() => {
    if (loading || ran.current) return;
    ran.current = true;
    (async () => {
      try {
        await enterAsGuest();
        const r = await rpc('joinTable', { code, role: watch ? 'observer' : 'player' });
        nav(`/t/${r.table.id}`, { replace: true });
      } catch (e) { setErr(e.message); }
    })();
  }, [loading, code, watch, nav, enterAsGuest]);
  if (!err) return <div className="main muted" role="status">Finding your table{'…'}</div>;
  return (
    <div className="main stack" style={{ maxWidth: 520, paddingTop: 28 }}>
      <div className="brand" style={{ fontSize: '1.4rem' }}>Venture<b>Arena</b><small>by VentureMaker{'™'}</small></div>
      <div className="card stack" role="alert"><h2>This invite did not work</h2><p className="muted">{err}</p><p className="small muted">The table may have finished or been closed. Ask whoever invited you for a new link, or find a game in the lobby.</p></div>
      <div><button type="button" className="btn gold" onClick={() => nav('/play')}>Go to the lobby</button></div>
    </div>
  );
}
