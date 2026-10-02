// The frame around every board: seats, whose turn, how to play, chat, leaving.
// A board only has to draw the game; everything a table needs is here once.
import { useEffect, useMemo, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';
import { rpc } from '../api.js';
import { loadGameClient } from '../../games/boards.js';
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
  const [panel, setPanel] = useState(null); // 'chat' | 'help' | 'menu'
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
  const goneRef = useRef(false);
  useEffect(() => {
    if (!finished || !mod || mod.fullscreen || goneRef.current) return undefined;
    const t = setTimeout(() => { goneRef.current = true; nav(`/debrief/${table.id}`, { replace: true }); }, 3500);
    return () => clearTimeout(t);
  }, [finished, mod, nav, table.id]);

  const acting = useMemo(() => (G ? actingSeats(G) : []), [G]);
  const mySeat = access && access.playerID !== null ? Number(access.playerID) : null;
  const leave = async () => {
    const playing = mySeat !== null && !over;
    if (playing && !window.confirm('Leave this game? A bot will finish your seat and it counts against your reputation.')) return;
    try { await rpc('leaveTable', { id: table.id }); } catch { /* already gone */ }
    nav('/play');
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
  const shell = { leave, openChat, openHelp: () => setPanel('help'), unread, debriefUrl: `/debrief/${table.id}`, finished };
  const last = chat.length ? chat[chat.length - 1] : null;
  const canChat = table.me.role !== null;
  const banner = over
    ? resultLine(G, mySeat, table)
    : acting.includes(mySeat) ? <b className="gold">Your move</b>
      : acting.length ? `${mySeat === null ? 'Watching · ' : ''}Waiting for ${acting.map((s) => table.seats[s] ? table.seats[s].name : 'the table').join(', ')}` : 'Working…';

  return (
    <div className={`stage${dock ? ' stage--dock' : ''}`} data-game={table.gameId}>
      <div className="stage__main">
        {!mod.fullscreen && (
          <>
            <div className="stage__bar">
              <button className="btn sm" onClick={leave} aria-label="Leave the table">{'←'}</button>
              <h1 className="grow truncate" style={{ fontSize: '1rem', fontWeight: 700 }}>{game.name}</h1>
              <button className="btn sm" onClick={() => setPanel('help')}>How to play</button>
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
          <div className="stage__foot"><div className="grow small">{resultLine(G, mySeat, table)}</div><button className="btn gold sm" onClick={() => nav(`/debrief/${table.id}`, { replace: true })}>See the debrief</button></div>
        )}
      </div>
      {dock && (
        <aside className="stage__chat" aria-label="Table talk" ref={dockRef}>
          <h2 className="stage__chat-title">Table talk</h2>
          <ChatPanel chat={chat} me={me} onSend={onSendChat} canChat={canChat} />
        </aside>
      )}
      {panel && (
        <Drawer title={panel === 'chat' ? 'Table talk' : `How to play ${game.name}`} onClose={() => setPanel(null)} panelStyle={panel === 'chat' ? { height: '70dvh' } : undefined}>
            {panel === 'chat' && <ChatPanel chat={chat} me={me} onSend={onSendChat} canChat={canChat} />}
            {panel === 'help' && (
              <div className="stack">
                <ol style={{ margin: 0, paddingLeft: 20 }} className="stack">{(game.howTo || []).map((step) => <li key={step}>{step}</li>)}</ol>
                {game.watchFor && <p className="notice"><b>What to watch for:</b> {game.watchFor}</p>}
              </div>
            )}
        </Drawer>
      )}
    </div>
  );
}

function resultLine(G, mySeat, table) {
  const p = G.over.placements || [];
  if (mySeat === null) { const w = p.indexOf(1); return p.filter((x) => x === 1).length > 1 ? 'Game over: a draw' : `Game over: ${table.seats[w] ? table.seats[w].name : 'someone'} won`; }
  if (p.every((x) => x === 1)) return 'A draw. Good game.';
  return p[mySeat] === 1 ? <b className="gold">You won!</b> : 'Game over. Good game.';
}
