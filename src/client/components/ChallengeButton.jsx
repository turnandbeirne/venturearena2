// Challenge someone to a game: pick the game, add a line, send. They have 48
// hours to answer; accepting opens a private table for the two of you.
import { useState } from 'react';
import { rpc } from '../api.js';
import { useGames } from '../games.js';
import { Drawer, useToast } from './ui.jsx';

export default function ChallengeButton({ card, className = 'btn sm', label = 'Challenge' }) {
  const games = useGames();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');
  if (!card || card.isBot) return null;
  const send = async (gameId) => {
    setErr('');
    try { await rpc('challenge', { userId: card.id, gameId, message }); setOpen(false); setMessage(''); toast(`Challenge sent to ${card.displayName}`); } catch (e) { setErr(e.message); }
  };
  return (
    <>
      <button type="button" className={className} onClick={() => { setErr(''); setOpen(true); }}>{label}</button>
      {open && (
        <Drawer title={`Challenge ${card.displayName}`} onClose={() => setOpen(false)}>
            <p className="small muted">Pick a game. They have 48 hours to answer; accepting opens a table for the two of you.</p>
            <input className="input" maxLength={200} placeholder="Add a line (optional)" value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Message" />
            {err && <div className="error" role="alert">{err}</div>}
            <div className="stack" style={{ gap: 8 }}>
              {!games && <div className="small muted">Loading the games{'…'}</div>}
              {(games ? games.games : []).map((g) => <button key={g.id} type="button" className="choice row" onClick={() => send(g.id)}><span aria-hidden="true" style={{ fontSize: 22 }}>{g.icon}</span><span className="grow"><b>{g.name}</b><div className="tiny muted">{g.minutes} min</div></span></button>)}
            </div>
        </Drawer>
      )}
    </>
  );
}
