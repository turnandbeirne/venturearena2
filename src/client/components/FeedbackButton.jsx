// "Tell the arena": a control on every page. What a member sends is logged
// under their name with the page they were on; the thank-you and any later
// reply land in their Inbox.
//
// It sits in the header on a phone and at the foot of the side rail on a wide
// screen. (It used to float above the tab bar, where it covered whatever was
// in the bottom-right corner: "Host" on a game card, "Post" in the debrief.)
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { rpc } from '../api.js';
import { useGames } from '../games.js';
import { Drawer } from './ui.jsx';

const KINDS = [['suggestion', 'Make a suggestion'], ['problem', 'Report a problem'], ['general', 'General feedback']];

export default function FeedbackButton({ className = 'btn sm' }) {
  const loc = useLocation();
  const games = useGames();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('suggestion');
  const [scope, setScope] = useState('arena');
  const [body, setBody] = useState('');
  const [state, setState] = useState('idle');
  const [err, setErr] = useState('');
  const scopes = [['arena', 'VentureArena (site, tables, lobby)'], ...((games ? games.games : []).map((g) => [g.id, g.name])), ['matching', 'People and matching'], ['membership', 'Membership and billing'], ['other', 'Something else']];

  const send = async () => {
    setState('sending'); setErr('');
    try { await rpc('sendFeedback', { kind, scope, body: body.trim(), page: loc.pathname }); setState('sent'); setBody(''); } catch (e) { setState('error'); setErr(e.message); }
  };

  return (
    <>
      <button type="button" className={className} onClick={() => { setOpen(true); setState('idle'); setErr(''); }} title="Suggest something or report a problem">Feedback</button>
      {open && (
        <Drawer title="Tell the arena" onClose={() => setOpen(false)}>
            {state === 'sent' ? (
              <div className="stack" role="status"><div className="gold" style={{ fontWeight: 700 }}>Sent. Thank you.</div>
                <p className="small">It is logged under your name with the page you were on. You will get a note in your Inbox when it has been acted on, so you can see how you helped the arena get better.</p></div>
            ) : (
              <>
                <div className="row-wrap" role="group" aria-label="Kind of feedback">{KINDS.map(([id, label]) => <button key={id} type="button" aria-pressed={kind === id} className={`chip${kind === id ? ' on' : ''}`} onClick={() => setKind(id)}>{label}</button>)}</div>
                <div><label className="label" htmlFor="fb-scope">About</label>
                  <select id="fb-scope" className="input" value={scope} onChange={(e) => setScope(e.target.value)}>{scopes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
                <textarea className="input" rows={4} maxLength={4000} placeholder="What happened, or what would make this better?" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Your feedback" />
                {err && <div className="error" role="alert">{err}</div>}
                <button className="btn gold block" disabled={body.trim().length < 3 || state === 'sending'} onClick={send}>{state === 'sending' ? 'Sending…' : 'Send'}</button>
              </>
            )}
        </Drawer>
      )}
    </>
  );
}
