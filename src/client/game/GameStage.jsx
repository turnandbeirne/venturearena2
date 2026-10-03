// The frame around every board: seats, whose turn, how to play, chat, leaving.
// A board only has to draw the game; everything a table needs is here once.
import { useEffect, useMemo, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';
import { rpc } from '../api.js';
import { loadGameClient } from '../../games/boards.js';
import GameInfo, { infoTabs } from './GameInfo.jsx';
import { TableClock, Countdown } from './clock.jsx';
import { useChangedAt } from './hooks.js';
import { actingSeats } from '../../games/kit.js';
import { useMatch } from './useMatch.js';
import { Avatar, Drawer, Loading } from '../components/ui.jsx';
import ChatPanel from '../components/ChatPanel.jsx';

/** True while the window is wide enough to keep the chat docked beside the board. */
const DOCK_QUERY = '(min-width: 1100px)';
function useDock() {
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DOCK_QUERY).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(DOCK_QUERY);
    const on = () => setWide(mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener(on); };
  }, []);
  return wide;
}

export default function GameStage({ table, game, me, chat, onSendChat }) {
  const nav = useNavigate();
  const [mod, setMod] = useState(null);
  const [access, setAccess] = useState(null);
  const [error, setError] = useState('');
  const [resignError, setResignError] = useState('');
  const [panel, setPanel] = useState(null); // 'chat' | 'info'
  // The info drawer: how to play, the key, progress, and what the dice have done.
  const [info, setInfo] = useState({ tab: 'help', focus: null });
  const [readCount, setReadCount] = useState(chat.length);
  // Table talk is always on screen. On a wide window it is a docked column
  // beside the board; on a phone, where there is no room for a window, it is
  // a one-line strip that shows the latest message and opens the full chat.
  // A fullscreen game (VentureFlow) brings its own chat panel and its own
  // "Table talk" link; docking a second chat beside it would be two chats.
  const wide = useDock();
  const dock = wide && !!mod && !mod.fullscreen;
  const dockRef = useRef(null);

  useEffect(() => {
    let alive = true;
    Promise.all([loadGameClient(table.gameId), rpc('seatAccess', { id: table.id })])
      .then(([m, a]) => { if (alive) { setMod(m); setAccess(a); } })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [table.id, table.gameId, table.me.seat]);

  const numPlayers = table.seats.length + (mod && mod.rules.arena && mod.rules.arena.house ? 1 : 0);
  const { G, ctx, moves, connected } = useMatch({
    rules: mod ? mod.rules : null, matchID: access ? access.matchID : null,
    playerID: access ? access.playerID : null, credentials: access ? access.credentials : null, numPlayers,
  });

  useEffect(() => { if (panel === 'chat' || dock) setReadCount(chat.length); }, [panel, dock, chat.length]);
  useEffect(() => { if (dock && panel === 'chat') setPanel(null); }, [dock, panel]);
  const unread = Math.max(0, chat.length - readCount);

  // The result banner, then the debrief. Boards that run their own end screen
  // (VentureFlow's report card) send people on themselves.
  const over = !!(G && G.over);
  const finished = table.status === 'finished';
  // (Bug: three and a half seconds after the last move the table was gone,
  // with nothing on screen to say so. The final position, or VentureBoom's
  // final standings, could not be read.) The move to the debrief is now
  // counted down in the foot of the table, and "Stay here" cancels it.
  const goneRef = useRef(false);
  const [stay, setStay] = useState(false);
  const [leaveAt, setLeaveAt] = useState(null);
  const endPause = mod && mod.endPauseMs ? mod.endPauseMs : END_PAUSE_MS;
  useEffect(() => {
    if (!finished || !mod || mod.fullscreen || goneRef.current || stay) { setLeaveAt(null); return undefined; }
    setLeaveAt(Date.now() + endPause);
    const t = setTimeout(() => { goneRef.current = true; nav(`/debrief/${table.id}`, { replace: true }); }, endPause);
    return () => clearTimeout(t);
  }, [finished, mod, nav, table.id, stay, endPause]);

  // Everything that has happened since this browser sat down, beyond the
  // eighty entries the game itself keeps (kit.js LOG_CAP), for the drawer's
  // "What happened" list.
  const history = useRef({ list: [], lastN: 0 });
  if (G && Array.isArray(G.log)) {
    for (const e of G.log) if (e.n > history.current.lastN) { history.current.list.push(e); history.current.lastN = e.n; }
    if (history.current.list.length > 1500) history.current.list.splice(0, history.current.list.length - 1500);
  }
  const changedAt = useChangedAt(G);

  const acting = useMemo(() => (G ? actingSeats(G) : []), [G]);
  const mySeat = access && access.playerID !== null ? Number(access.playerID) : null;
  // Stopping on purpose is one flow with a double check, for every game: the
  // Resign button opens a dialog that says exactly what each choice does
  // (concede, hand the seat to a bot, or just step away), and nothing happens
  // until one of them is pressed. (It used to be the back arrow with a
  // browser confirm box, which offered one outcome and did not say which.)
  const canResign = !!table.resign && mySeat !== null && !over;
  const [busy, setBusy] = useState(false);
  const leave = async () => {
    if (canResign) { setPanel('resign'); return; }
    try { await rpc('leaveTable', { id: table.id }); } catch { /* already gone */ }
    nav('/play');
  };
  const resign = async (how) => {
    setBusy(true); setError('');
    try {
      await rpc('resignTable', { id: table.id, how });
      setPanel(null);
      // The seat is a bot's now: ask again who this browser is at the table (a spectator).
      if (how === 'bot') setAccess(await rpc('seatAccess', { id: table.id }));
    } catch (e) { setPanel(null); setResignError(e.message); }
    setBusy(false);
  };

  if (error) return <div className="stage"><div className="main"><div className="error" role="alert">{error}</div><button className="btn" style={{ marginTop: 12 }} onClick={() => nav('/play')}>Back to the lobby</button></div></div>;
  if (!mod || !access || !G) return <div className="stage"><Loading what={connected || !mod ? 'Setting the table' : 'Connecting'} /></div>;

  const { Board } = mod;
  // With the chat docked, "open chat" means "put the cursor in it".
  const openChat = () => {
    if (!dock) { setPanel('chat'); return; }
    const input = dockRef.current && dockRef.current.querySelector('input');
    if (input) input.focus();
  };
  // Open the info drawer on one tab; `focus` is the Key entry to open at (a card's "?").
  const openInfo = (tab = 'help', focus = null) => { setInfo({ tab, focus }); setPanel('info'); };
  const tabs = infoTabs(mod.info, G);
  const has = (id) => tabs.some((t) => t.id === id);
  const rollsTab = tabs.find((t) => t.id === 'rolls');
  const clock = <TableClock table={table} />;
  const setPace = (pace) => rpc('setPace', { id: table.id, pace }).catch((e) => setError(e.message));
  const shell = { leave, openChat, openHelp: () => openInfo('help'), openInfo, tabs, clock, unread, debriefUrl: `/debrief/${table.id}`, finished, pace: table.pace, canPace: !!table.canPace && !finished, setPace, canResign, resign: () => setPanel('resign') };
  // A live seat that sits on its move is finished by a bot (tables.js). Say so in the last minute.
  const idleAt = changedAt && table.idleLimitMs && acting.includes(mySeat) && !over ? changedAt + table.idleLimitMs : null;
  const infoTitle = { help: `How to play ${game.name}`, key: `Key to ${game.name}`, moves: `${game.name}: what happened`, progress: `${game.name}: progress`, rolls: `${game.name}: ${rollsTab ? rollsTab.label.toLowerCase() : 'rolls'}` };
  const last = chat.length ? chat[chat.length - 1] : null;
  const canChat = table.me.role !== null;
  const banner = over
    ? resultLine(G, mySeat, table)
    : acting.includes(mySeat) ? <><b className="gold">Your move</b><IdleWarning until={idleAt} /></>
      : acting.length ? `${mySeat === null ? 'Watching · ' : ''}Waiting for ${acting.map((s) => table.seats[s] ? table.seats[s].name : 'the table').join(', ')}` : 'Working…';

  return (
    <div className={`stage${dock ? ' stage--dock' : ''}`} data-game={table.gameId}>
      <div className="stage__main">
        {!mod.fullscreen && (
          <>
            <div className="stage__bar">
              {canResign
                ? <button className="btn sm stage__resign" onClick={() => setPanel('resign')}><span className="stage__wide" aria-hidden="true">{'\u{1F3F3}\uFE0F'}</span> Resign</button>
                : <button className="btn sm" onClick={leave} aria-label="Leave the table">{'←'}</button>}
              <h1 className="grow truncate" style={{ fontSize: '1rem', fontWeight: 700 }}>{game.name}</h1>
              {has('progress')
                ? <button className="btn sm stage__prog" onClick={() => openInfo('progress')}><span>Progress</span>{clock}</button>
                : clock}
              {rollsTab && <button className="btn sm stage__wide" onClick={() => openInfo('rolls')}>{rollsTab.label}</button>}
              {has('key') && <button className="btn sm" onClick={() => openInfo('key')}>Key</button>}
              <button className="btn sm stage__help" onClick={() => openInfo('help')} aria-label="How to play"><span className="stage__wide">How to play</span><span className="stage__narrow" aria-hidden="true">?</span></button>
            </div>
            <div className="stage__seats">
              {table.seats.map((s) => (
                <div key={s.seat} className={`stage__seat${acting.includes(s.seat) && !over ? ' turn' : ''}`}>
                  <span className="swatch" style={{ width: 10, height: 10, borderRadius: '50%', background: s.hex, flex: 'none' }} />
                  <Avatar p={s.card || { avatar: s.avatar }} size={22} />
                  <span className="truncate">{s.name}</span>
                  {/* Outside the truncated name: on a 360px screen "(you)" was the part that got cut off. */}
                  {s.seat === mySeat && <span style={{ flex: 'none', opacity: 0.8 }}>(you)</span>}
                  {s.takeover && <span style={{ flex: 'none', opacity: 0.8 }}>{'·'} bot</span>}
                </div>
              ))}
            </div>
            <div className="stage__status">
              <div className="stage__banner" role="status" aria-live="polite">{banner}</div>
              {!dock && (
                <button type="button" className={`stage__ticker${unread > 0 ? ' stage__ticker--new' : ''}`} onClick={() => setPanel('chat')} aria-label={unread > 0 ? `Chat, ${unread} new` : 'Chat'}>
                  <span aria-hidden="true">{'\u{1F4AC}'}</span>
                  <span className="stage__ticker-text">
                    {last ? (last.system ? <i>{last.body}</i> : <><b>{last.fromId === me.id ? 'You' : last.name}</b> {last.body}</>) : 'Table talk: say hello'}
                  </span>
                  {unread > 0 && <span className="stage__ticker-count" aria-hidden="true">{unread}</span>}
                </button>
              )}
            </div>
          </>
        )}
        <div className="stage__board" style={mod.fullscreen ? { padding: 0, overflow: 'auto' } : undefined}>
          <Board G={G} ctx={ctx} moves={moves} playerID={access.playerID} seats={table.seats} table={table} me={me} shell={shell} />
        </div>
        {!mod.fullscreen && finished && (
          <div className="stage__foot" data-end-bar>
            {/* The result is in the banner above the board; while the countdown runs the foot says only where the table is going. */}
            <div className="grow small">{leaveAt ? <Countdown until={leaveAt} prefix="To the debrief in " suffix="." /> : resultLine(G, mySeat, table)}</div>
            {leaveAt && <button className="btn sm" onClick={() => setStay(true)}>Stay here</button>}
            <button className="btn gold sm" onClick={() => nav(`/debrief/${table.id}`, { replace: true })}>See the debrief</button>
          </div>
        )}
      </div>
      {dock && (
        <aside className="stage__chat" aria-label="Table talk" ref={dockRef}>
          <h2 className="stage__chat-title">Table talk</h2>
          <ChatPanel chat={chat} me={me} onSend={onSendChat} canChat={canChat} />
        </aside>
      )}
      {resignError && <div className="toast" role="alert" onClick={() => setResignError('')}>{resignError}</div>}
      {panel === 'resign' && (
        <Drawer title="Resign this game?" onClose={() => setPanel(null)}>
          <ResignChoices table={table} mySeat={mySeat} busy={busy} onKeep={() => setPanel(null)} onResign={resign} onAway={() => nav('/play')} />
        </Drawer>
      )}
      {panel && panel !== 'resign' && (
        <Drawer title={panel === 'chat' ? 'Table talk' : infoTitle[has(info.tab) ? info.tab : 'help']} onClose={() => setPanel(null)} panelStyle={panel === 'chat' ? { height: '70dvh' } : tabs.length > 1 ? { height: '82dvh', maxWidth: 640 } : undefined}>
            {panel === 'chat' && <ChatPanel chat={chat} me={me} onSend={onSendChat} canChat={canChat} />}
            {panel === 'info' && (
              <GameInfo game={game} info={mod.info} keyArt={mod.keyArt} G={G} seats={table.seats} mySeat={mySeat} table={table} history={history.current.list} onPace={setPace}
                tab={info.tab} focus={info.focus} onTab={(tab) => setInfo({ tab, focus: null })} playing={mySeat !== null && !finished && !over} />
            )}
        </Drawer>
      )}
    </div>
  );
}

/**
 * "Are you sure?", with what each answer does. Nothing is decided by opening
 * this: every way out of it other than the two resign buttons keeps the game.
 */
function ResignChoices({ table, mySeat, busy, onKeep, onResign, onAway }) {
  const r = table.resign || {};
  const others = table.seats.filter((s) => s.seat !== mySeat);
  const rival = others.length === 1 ? others[0].name : 'the other player';
  const mins = table.idleLimitMs ? Math.round(table.idleLimitMs / 60000) : null;
  return (
    <div className="stack" data-resign>
      <p style={{ margin: 0 }}>Are you sure? This cannot be undone.</p>
      {r.concede && (
        <div className="card stack">
          <div><b>Concede</b><div className="small muted">The game ends now and {rival} wins. It is recorded as a finished game, and you go to the debrief together.</div></div>
          <button type="button" className="btn" disabled={busy} onClick={() => onResign('concede')}>Yes, concede the game</button>
        </div>
      )}
      {r.bot && (
        <div className="card stack">
          <div><b>Hand your seat to a bot</b><div className="small muted">{r.others > 0 ? 'The game goes on without you so the others can finish it. ' : 'Only bots are left, so the game is played out at once. '}The result still counts for you, and it counts against your reputation the same as leaving does.</div></div>
          <button type="button" className="btn" disabled={busy} onClick={() => onResign('bot')}>Yes, let a bot finish for me</button>
        </div>
      )}
      <button type="button" className="btn gold" disabled={busy} onClick={onKeep}>No, keep playing</button>
      <button type="button" className="btn" disabled={busy} onClick={onAway}>Step away, keep my seat</button>
      <p className="tiny muted" style={{ margin: 0 }}>Stepping away keeps your seat: come back from Play, under "Your tables".{mins ? ` If it is your move and you are gone for ${mins} minutes, a bot finishes the game for you.` : ''}</p>
    </div>
  );
}

/** How long a finished table stays up before it moves to the debrief; a game may ask for longer (client.js endPauseMs). */
const END_PAUSE_MS = 6000;
const IDLE_WARN_MS = 60000;

/** "a bot plays for you in 42s", shown for the last minute before the arena hands an idle seat to a bot. */
function IdleWarning({ until }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until || until - Date.now() > IDLE_WARN_MS) return null;
  return <span className="stage__idle" role="status"><Countdown until={until} prefix=" · a bot plays for you in " /></span>;
}

function resultLine(G, mySeat, table) {
  const p = G.over.placements || [];
  if (mySeat === null) { const w = p.indexOf(1); return p.filter((x) => x === 1).length > 1 ? 'Game over: a draw' : `Game over: ${table.seats[w] ? table.seats[w].name : 'someone'} won`; }
  if (p.every((x) => x === 1)) return 'A draw. Good game.';
  return p[mySeat] === 1 ? <b className="gold">You won!</b> : 'Game over. Good game.';
}
