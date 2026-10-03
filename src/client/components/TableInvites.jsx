// Inviting people to a table inside the arena: no email, no text, no link.
//
//  InviteConnections  at a table: the people you are connected to, each with
//                     an Invite button. The invitation lands in their Inbox
//                     and on their Play page, and a notice reaches them
//                     wherever they are.
//  TableInvitations   the other end: the invitations waiting for you, each
//                     with Join and Not now.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc } from '../api.js';
import { localEvent, useEvent } from '../realtime.js';
import { Avatar, useToast } from './ui.jsx';

export function InviteConnections({ tableId, gameName }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => rpc('tableInvitables', { id: tableId }).then(setList).catch(() => setList({ people: [] })), [tableId]);
  useEffect(() => { load(); }, [load]);
  useEvent('table', (p) => { if (p.id === tableId && p.status !== 'closed') load(); });

  const invite = async (person) => {
    setBusy(person.card.id); setError('');
    try { await rpc('inviteToTable', { id: tableId, userId: person.card.id }); toast(`Invited ${person.card.displayName}`); await load(); } catch (e) { setError(e.message); }
    setBusy('');
  };

  if (!list) return null;
  return (
    <section className="card stack" aria-labelledby="invite-conn-h" data-invite-connections>
      <div>
        <h2 id="invite-conn-h">Invite your connections</h2>
        <p className="small muted">They get the invitation here in VentureArena: in their Inbox, on their Play page, and as a notice if they are in the arena now.</p>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {list.guest ? <p className="small muted">Guests have no connections yet. <Link to="/signin?mode=create">Create a free account</Link> to connect with the people you play.</p>
        : list.people.length === 0 ? <p className="small muted">You have no connections to invite yet. Connect with people from the <Link to="/people">People</Link> tab or after a game, or use the link below.</p> : (
          <ul className="invlist">
            {list.people.map((p) => (
              <li key={p.card.id} className="row" data-invitable={p.card.username}>
                <Avatar p={p.card} size={32} dot={p.online} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="truncate" style={{ display: 'block', fontWeight: 650 }}>{p.card.displayName}</span>
                  <span className="tiny muted">{p.here ? 'At this table' : p.online ? 'In the arena now' : 'Not here right now: they will see it when they come back'}</span>
                </span>
                {p.here ? <span className="chip" style={{ flex: 'none' }}>Here</span>
                  : p.invited ? <span className="chip" style={{ flex: 'none' }}>Invited</span>
                    : p.declined ? <span className="chip" style={{ flex: 'none' }}>Passed</span>
                      : <button type="button" className="btn gold sm" style={{ flex: 'none' }} disabled={busy === p.card.id} onClick={() => invite(p)} aria-label={`Invite ${p.card.displayName} to this ${gameName || ''} table`}>Invite</button>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

export function TableInvitations({ invites, onChange, title = 'You are invited' }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!invites || invites.length === 0) return null;
  const answer = async (i, accept) => {
    setBusy(i.tableId); setError('');
    try {
      const r = await rpc('answerTableInvite', { tableId: i.tableId, accept });
      localEvent('inbox', { kind: 'answered' });
      if (accept && r.table) { nav(`/t/${r.table.id}`); return; }
      if (onChange) onChange();
    } catch (e) { setError(e.message); if (onChange) onChange(); }
    setBusy('');
  };
  return (
    <section className="stack" aria-label={title} data-table-invitations>
      <div className="eyebrow">{title}</div>
      {error && <div className="error" role="alert">{error}</div>}
      {invites.map((i) => (
        <div key={i.tableId} className="card hot stack" data-table-invitation={i.gameId}>
          <div className="row">
            <Avatar p={i.from} size={32} />
            <div className="grow small" style={{ minWidth: 0 }}>
              <b>{i.from ? i.from.displayName : 'Someone'}</b> invited you to {i.started ? 'watch' : 'play'} <span aria-hidden="true">{i.icon}</span> {i.gameName}
              <div className="tiny muted">{i.started ? 'The game is under way: you would join as a spectator.' : i.seatFree ? `A seat is free. ${i.people} at the table.` : 'The seats are taken: you would watch and join the debrief.'}</div>
            </div>
          </div>
          <div className="row-wrap">
            <button type="button" className="btn gold sm" disabled={busy === i.tableId} onClick={() => answer(i, true)}>{i.started || !i.seatFree ? 'Watch' : 'Join'}</button>
            <button type="button" className="btn sm" disabled={busy === i.tableId} onClick={() => answer(i, false)}>Not now</button>
          </div>
        </div>
      ))}
    </section>
  );
}
