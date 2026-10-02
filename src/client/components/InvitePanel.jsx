// Invite by text, email, the phone's share sheet or a copied link. Nothing is
// sent from the server: the member's own phone or mail app does the sending,
// and the link carries their referral code.
import { useEffect, useState } from 'react';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from './ui.jsx';

export default function InvitePanel({ title, tableCode = '', gameName = '', compact = false, showHistory = false }) {
  const { user } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { if (user && !user.isGuest) rpc('inviteInfo').then(setInfo).catch(() => {}); }, [user && user.id, user && user.isGuest]); // eslint-disable-line react-hooks/exhaustive-deps

  const code = info ? info.code : null;
  const link = tableCode
    ? `${window.location.origin}/join/${tableCode}${code ? `?ref=${code}` : ''}`
    : `${window.location.origin}/${code ? `?ref=${code}` : ''}`;
  const prefix = name.trim() ? `${name.trim()}, ` : '';
  const message = tableCode
    ? `${prefix}come play ${gameName || 'a game'} with me at VentureArena. Tap to grab a seat at my table: ${link}`
    : `${prefix}I'm playing business strategy games with founders at VentureArena. Come play me: ${link}`;
  const subject = tableCode ? 'Join my table at VentureArena' : 'Come play me at VentureArena';

  const log = async (channel) => {
    setError('');
    if (user.isGuest) {
      // Guests can always share a table link; only the referral credit needs an account.
      if (!tableCode) { setError('Create a free account to invite friends.'); return false; }
      return true;
    }
    try { await rpc('logInvite', { channel, contact, name, tableCode }); return true; } catch (e) { setError(e.message); return false; }
  };
  const text = async () => { if (await log('sms')) window.location.href = `sms:${contact.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(message)}`; };
  const email = async () => { if (await log('email')) window.location.href = `mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`; };
  const share = async () => { if (await log('share')) { try { await navigator.share({ title: 'VentureArena', text: message, url: link }); toast('Shared'); } catch { /* cancelled */ } } };
  const copy = async () => { if (await log('link')) { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast(link); } } };

  return (
    <div className="card stack">
      <div><h2>{title || (tableCode ? 'Invite someone to this table' : 'Invite a friend to play')}</h2>
        {!compact && <p className="small muted">Send a text or email from your phone, or share the link anywhere. When they join, you both get a connection request and you earn 20 Arena Points.</p>}</div>
      <div className="grid two">
        <input className="input" maxLength={40} placeholder="Their name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Their name" />
        <input className="input" maxLength={120} placeholder="Phone or email (optional)" value={contact} onChange={(e) => setContact(e.target.value)} aria-label="Phone or email" />
      </div>
      <div className="row-wrap">
        <button className="btn sm" onClick={text}>Text</button>
        <button className="btn sm" onClick={email}>Email</button>
        {typeof navigator !== 'undefined' && navigator.share && <button className="btn sm" onClick={share}>Share{'…'}</button>}
        <button className="btn sm gold" onClick={copy}>Copy link</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {showHistory && info && info.history.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="eyebrow">Your invites</div>
          {info.history.map((h, i) => <div key={i} className="small"><span className={h.joined ? 'good' : 'muted'}>{h.joined ? 'joined' : 'sent'}</span> {'·'} {h.name || h.contact || 'a friend'} {'·'} via {h.channel}{h.tableCode ? ' · to a table' : ''}</div>)}
        </div>
      )}
    </div>
  );
}
