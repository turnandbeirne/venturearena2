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

export default function GameStage({ table, game, me, chat, onSendChat }) {
  const nav = useNavigate();
  const [mod, setMod] = useState(null);
  const [access, setAccess] = useState(null);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(null); // 'chat' | 'help' | 'menu'
  const [readCount, setReadCount] = useState(chat.length);

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

  useEffect(() => { if (panel === 'chat') setReadCount(chat.length); }, [panel, chat.length]);
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
  const shell = { leave, openChat: () => setPanel('chat'), openHelp: () => setPanel('help'), unread, debriefUrl: `/debrief/${table.id}`, finished };
  const banner = over
    ? resultLine(G, mySeat, table)
    : acting.includes(mySeat) ? <b className="gold">Your move</b>
      : acting.length ? `${mySeat === null ? 'Watching · ' : ''}Waiting for ${acting.map((s) => table.seats[s] ? table.seats[s].name : 'the table').join(', ')}` : 'Working…';

  return (
    <div className="stage" data-game={table.gameId}>
      {!mod.fullscreen && (
        <>
          <div className="stage__bar">
            <button className="btn sm" onClick={leave} aria-label="Leave the table">{'←'}</button>
            <h1 className="grow truncate" style={{ fontSize: '1rem', fontWeight: 700 }}>{game.name}</h1>
            <button className="btn sm" onClick={() => setPanel('help')}>How to play</button>
            <button className="btn sm" onClick={() => setPanel('chat')} style={{ position: 'relative' }} aria-label={unread > 0 ? `Chat, ${unread} new` : 'Chat'}>Chat{unread > 0 && <span className="badge" style={{ top: -6, right: -6 }} aria-hidden="true">{unread}</span>}</button>
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
          <div className="stage__banner" role="status" aria-live="polite">{banner}</div>
        </>
      )}
      <div className="stage__board" style={mod.fullscreen ? { padding: 0, overflow: 'auto' } : undefined}>
        <Board G={G} ctx={ctx} moves={moves} playerID={access.playerID} seats={table.seats} table={table} me={me} shell={shell} />
      </div>
      {!mod.fullscreen && finished && (
        <div className="stage__foot"><div className="grow small">{resultLine(G, mySeat, table)}</div><button className="btn gold sm" onClick={() => nav(`/debrief/${table.id}`, { replace: true })}>See the debrief</button></div>
      )}
      {panel && (
        <Drawer title={panel === 'chat' ? 'Table talk' : `How to play ${game.name}`} onClose={() => setPanel(null)} panelStyle={panel === 'chat' ? { height: '70dvh' } : undefined}>
            {panel === 'chat' && <ChatPanel chat={chat} me={me} onSend={onSendChat} canChat={table.me.role !== null} />}
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
