// The table: seats, observers, host settings, invite links, table talk, and
// once the host starts, the game itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useEvent, useTableRoom } from '../realtime.js';
import { useGames } from '../games.js';
import { loadGameClient } from '../../games/boards.js';
import { Avatar, ArchBadge, RepShield, Loading, useAction, useToast, stageLabel } from '../components/ui.jsx';
import ChatPanel from '../components/ChatPanel.jsx';
import InvitePanel from '../components/InvitePanel.jsx';
import { InviteConnections } from '../components/TableInvites.jsx';
import GameStage from '../game/GameStage.jsx';

export default function TableRoom() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, allows } = useAuth();
  const games = useGames();
  const toast = useToast();
  const [table, setTable] = useState(null);
  const [chat, setChat] = useState([]);
  const [gone, setGone] = useState('');
  const [Settings, setSettings] = useState(null);
  const { error, setError, busy, run } = useAction();

  const load = useCallback(async () => {
    try { const r = await rpc('table', { id }); setTable(r.table); setChat(r.chat); } catch (e) { setGone(e.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useTableRoom(id);
  useEvent('table', (p) => { if (p.id === id) { if (p.status === 'closed') setGone('The host closed this table.'); else load(); } });
  useEvent('chat', (m) => { setChat((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])); });

  const game = table && games ? games.games.find((g) => g.id === table.gameId) : null;
  useEffect(() => {
    if (!game || !game.hasSettings) return;
    let alive = true;
    loadGameClient(game.id).then((m) => { if (alive && m.Settings) setSettings(() => m.Settings); }).catch(() => {});
    return () => { alive = false; };
  }, [game && game.id, game && game.hasSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  // A finished table belongs to its debrief (boards with their own end screen
  // send people there themselves, so only redirect on a fresh load).
  const firstStatus = useRef(null);
  useEffect(() => {
    if (!table) return;
    if (firstStatus.current === null) { firstStatus.current = table.status; if (table.status === 'finished') nav(`/debrief/${table.id}`, { replace: true }); }
    if (table.status === 'abandoned') setGone('This table was abandoned.');
  }, [table, nav]);

  const act = (fn) => run(async () => { const r = await fn(); if (r && r.table) setTable(r.table); return r; });
  const send = (body) => rpc('sendChat', { id, body }).catch((e) => setError(e.message));
  // A host's choice shows at once and the server's answer replaces it. (The
  // controls used to wait for the round trip, so on a slow connection a tap
  // on the checkbox looked like it had done nothing.)
  const change = (patch) => act(async () => {
    setTable((t) => ({ ...t, settings: { ...t.settings, ...patch } }));
    try { return await rpc('setTableSettings', { id, settings: patch }); } catch (e) { load(); throw e; }
  });
  const saveSettings = async (settings, note) => {
    const r = await rpc('setTableSettings', { id, settings });
    setTable(r.table);
    if (note && table.people > 1) send(note);
  };

  if (gone) return <div className="stack" style={{ maxWidth: 520 }}><div className="card stack" role="alert"><h2>This table is not here</h2><p className="muted">{gone}</p></div><div><button className="btn gold" onClick={() => nav('/play')}>Back to the lobby</button></div></div>;
  if (!table || !game) return <Loading what="Finding the table" />;

  if (table.status === 'playing' || table.status === 'finished') {
    return <GameStage table={table} game={game} me={user} chat={chat} onSendChat={send} />;
  }

  const me = table.me;
  const isHost = table.hostId === user.id;
  const players = table.seats.filter((s) => s.kind === 'human');
  const seatsFull = players.length >= table.maxSeats;
  const tableFull = table.people >= table.capacity;
  const link = (watch) => `${window.location.origin}/join/${table.inviteCode}${watch ? '/watch' : ''}`;
  const copy = async (watch) => { try { await navigator.clipboard.writeText(link(watch)); toast(watch ? 'Watch link copied' : 'Invite link copied'); } catch { toast(link(watch)); } };
  const botsAtStart = table.settings.fillBots ? Math.max(0, Math.max(table.settings.size, table.minSeats) - players.length) : 0;
  const canStart = players.length + botsAtStart >= table.minSeats;
  const size = table.settings.size;
  const BOT_LEVELS = { 1: 'Rookie', 2: 'Sharp', 3: 'Shark' };
  const setupLine = [
    table.maxSeats > table.minSeats ? `${size} seats` : `${table.maxSeats} players`,
    table.settings.fillBots ? `bots fill empty seats${game.hasSettings ? '' : ` (${BOT_LEVELS[table.settings.botLevel] || 'Sharp'})`}` : 'no bots: empty seats stay empty',
    table.visibility === 'private' ? 'invite only' : 'listed in the public lobby',
  ].join(' · ');

  return (
    <div className="split">
      <div className="stack">
        <div className="between">
          <div><h1>{game.name}</h1><div className="tiny muted">{table.auto ? 'Quick match' : 'Open table'} {'·'} {table.mode === 'turn_based' ? 'turn-based' : 'live'} {'·'} {table.visibility}</div></div>
          <div className="row-wrap">
            <button className="btn sm" onClick={() => copy(false)}>Copy invite link</button>
            <button className="btn sm" onClick={() => copy(true)} title="A link that seats people as observers">Watch link</button>
            <button className="btn sm" onClick={() => run(async () => { await rpc('leaveTable', { id }); nav('/play'); })}>{me.role === 'observer' ? 'Stop watching' : 'Leave'}</button>
          </div>
        </div>
        {error && <div className="error" role="alert">{error}</div>}

        <div className="grid two">
          {table.seats.map((s) => (s.kind === 'human' ? (
            <div key={s.seat} className="card seat" data-seat={s.card && s.card.id === user.id ? 'you' : 'other'}>
              <Avatar p={s.card} size={36} dot={s.card && s.card.online} />
              {/* "you" and "host" sit outside the truncated name: with a long name they were the part that got cut. */}
              <div className="grow"><div className="row" style={{ gap: 6 }}><span className="truncate" style={{ fontWeight: 650 }}>{s.name}</span>{s.card && s.card.id === user.id && <span className="tiny muted" style={{ flex: 'none' }}>(you)</span>}{s.card && s.card.id === table.hostId && <span className="tiny gold" style={{ flex: 'none' }}>host</span>}</div>
                <div className="tiny muted">{s.card && s.card.stage ? stageLabel(s.card.stage) : 'new here'}</div></div>
              {s.card && s.card.archetype && <ArchBadge archetype={s.card.archetype} size={24} />}
              {s.card && <RepShield score={s.card.reputation} />}
            </div>
          ) : (
            <div key={s.seat} className="card seat dashed">
              <span style={{ fontSize: 22 }} aria-hidden="true">{s.botIfEmpty ? '\u{1F916}' : '○'}</span>
              <div className="grow"><div style={{ fontWeight: 650 }}>Open seat</div><div className="tiny muted">{s.botIfEmpty ? 'A bot plays here if nobody sits' : 'Stays empty unless someone sits'}</div></div>
            </div>
          )))}
        </div>

        {/* The one thing most people came to do sits right under the seats, not below the settings. */}
        <div className="card stack">
          <div className="row-wrap">
            {!me.role && <button className="btn gold" disabled={seatsFull || tableFull || busy} onClick={() => act(() => rpc('joinTable', { id, role: 'player' }))}>{seatsFull ? 'Seats full' : 'Take a seat'}</button>}
            {!me.role && <button className="btn" disabled={tableFull || busy} onClick={() => act(() => rpc('joinTable', { id, role: 'observer' }))}>Watch</button>}
            {me.role === 'observer' && <button className="btn gold" disabled={seatsFull || busy} onClick={() => act(() => rpc('setRole', { id, role: 'player' }))}>Take a seat instead</button>}
            {me.role === 'player' && <button className="btn" disabled={busy} onClick={() => act(() => rpc('setRole', { id, role: 'observer' }))}>Watch instead</button>}
            {isHost && <button className="btn gold" disabled={!canStart || busy} onClick={() => act(() => rpc('startTable', { id }))}>{busy ? 'Starting…' : botsAtStart > 0 ? `Start with ${botsAtStart} bot${botsAtStart === 1 ? '' : 's'}` : 'Start the game'}</button>}
            {!isHost && me.role && <span className="small muted">{me.role === 'observer' ? "You're watching. " : ''}Waiting for the host to start{'…'}</span>}
          </div>
          {isHost && !canStart && <div className="small muted">{game.name} needs at least {table.minSeats} players. Invite someone, or turn on bots.</div>}
          {table.auto && table.autoStartAt && players.length < size && <div className="small muted">Looking for players. A bot will take the empty seat{size - players.length === 1 ? '' : 's'} shortly if nobody joins.</div>}
          <div className="small"><span className="muted">Question of the table:</span> {table.question}</div>
        </div>
        <div className="card row-wrap small">
          <span className="muted">Watching ({table.observers.length}) {'·'} {table.capacity - table.people} spots left at this table</span>
          {table.observers.map((o) => <span key={o.id} className="chip"><Avatar p={o} size={18} /> {o.displayName}</span>)}
          {table.observers.length === 0 && <span className="muted">Nobody yet. Observers chat, watch the board and join the debrief.</span>}
        </div>

        {isHost && (
          <div className="card stack">
            <div className="between"><h2>Set up your table</h2><span className="tiny muted">Everyone at the table sees these</span></div>
            {table.maxSeats > table.minSeats && (
              <div><span className="label">Seats</span><div className="row-wrap">
                {Array.from({ length: table.maxSeats - table.minSeats + 1 }, (_, i) => table.minSeats + i).map((n) => (
                  <button key={n} type="button" aria-pressed={size === n} className={`chip${size === n ? ' on' : ''}`} disabled={n < players.length} onClick={() => change({ size: n })}>{n}</button>
                ))}</div></div>
            )}
            <label className="check small"><input type="checkbox" checked={!!table.settings.fillBots} onChange={(e) => change({ fillBots: e.target.checked })} /> Fill empty seats with bots when the game starts</label>
            {table.settings.fillBots && !game.hasSettings && (
              <div><span className="label">Bot skill</span><div className="row-wrap">
                {[[1, 'Rookie'], [2, 'Sharp'], [3, 'Shark']].map(([lv, name]) => <button key={lv} type="button" aria-pressed={table.settings.botLevel === lv} className={`chip${table.settings.botLevel === lv ? ' on' : ''}`} onClick={() => change({ botLevel: lv })}>{name}</button>)}
              </div></div>
            )}
            <div><span className="label">Who can find it</span><div className="row-wrap">
              <button type="button" aria-pressed={table.visibility === 'public'} className={`chip${table.visibility === 'public' ? ' on' : ''}`} onClick={() => act(() => rpc('setTableSettings', { id, settings: {}, visibility: 'public' }))}>Public lobby</button>
              <button type="button" aria-pressed={table.visibility === 'private'} className={`chip${table.visibility === 'private' ? ' on' : ''}`} onClick={() => act(() => rpc('setTableSettings', { id, settings: {}, visibility: 'private' }))} title={allows('private_table') ? '' : 'A Subscriber feature'}>Invite only{allows('private_table') ? '' : ' \u{1F512}'}</button>
            </div></div>
            <div><span className="label">Pace</span><div className="row-wrap">
              <button type="button" aria-pressed={table.mode !== 'turn_based'} className={`chip${table.mode !== 'turn_based' ? ' on' : ''}`} onClick={() => act(() => rpc('setTableSettings', { id, settings: {}, mode: 'realtime' }))}>Live</button>
              <button type="button" aria-pressed={table.mode === 'turn_based'} className={`chip${table.mode === 'turn_based' ? ' on' : ''}`} onClick={() => act(() => rpc('setTableSettings', { id, settings: {}, mode: 'turn_based' }))} title="Up to a day per move; come back when it is your turn">Turn-based (a day per move)</button>
            </div></div>
          </div>
        )}
        {!isHost && (
          // "Everyone at the table sees these": people who are not the host
          // used to see nothing of the setup, so a change by the host was invisible.
          <div className="card small" data-table-settings>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Table settings (set by the host)</div>
            <div>{setupLine}</div>
          </div>
        )}
        {Settings && <Settings settings={table.settings} isHost={isHost} locked={false} humans={players.length} maxSeats={table.maxSeats} canCustomize={allows('custom_settings')} onChange={saveSettings} onSuggest={me.role ? (text) => send(`\u{1F4A1} ${text}`) : undefined} />}

        {me.role && <InviteConnections tableId={table.id} gameName={game.name} />}
        <InvitePanel compact title="Or invite anyone with a link" tableCode={table.inviteCode} gameName={game.name} />
      </div>

      <div className="card chat table-chat">
        <div className="eyebrow" style={{ marginBottom: 6 }}>Table talk</div>
        <ChatPanel chat={chat} me={user} onSend={send} canChat={!!me.role} />
        {!allows('dm_anyone') && <div className="tiny muted" style={{ marginTop: 6 }}>Table chat is open to everyone. Direct messages to anyone are a Subscriber feature.</div>}
      </div>
    </div>
  );
}
