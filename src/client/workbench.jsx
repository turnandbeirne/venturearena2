// Board workbench (development only): run any game's board against its own
// rules and bot in the browser, with no server, no account and no table.
//
//   npm run dev   then open   /workbench.html?game=fourinarow
//     &seats=2        how many seats
//     &seat=0         which seat you are (or seat=watch)
//     &auto=1         bots play every seat, yours included
//     &delay=400      ms between bot moves
//     &seed=7         the same deal every time
//
// The match runs through games/sim.js, the same reducer path the server uses,
// and the board receives the same stripped view a browser at that seat would.
// The layout tests (tests/e2e) drive this page to measure boards at phone size.
import { StrictMode, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { createMatch } from '../games/sim.js';
import { actingSeats } from '../games/kit.js';
import { COLORS } from '../shared/profile.js';

const q = new URLSearchParams(window.location.search);
const gameId = q.get('game') || 'fourinarow';
const delay = Number(q.get('delay') || 450);
const auto = q.get('auto') === '1';
const NAMES = ['You', 'Robo-Trader', 'Ledger Lee', 'Margin Mo', 'Runway Rae', 'Pivot Pat'];

const mods = import.meta.glob('../games/*/client.js');
const bots = import.meta.glob('../games/*/bot.js');
const metas = import.meta.glob('../games/*/meta.js');
const rulesMods = import.meta.glob('../games/*/rules.js');

function Workbench({ mod, botMod, meta, rulesMod }) {
  const nSeats = Number(q.get('seats') || meta.seats.defaultSize || meta.seats.max);
  const seatParam = q.get('seat');
  const mySeat = seatParam === 'watch' ? null : Number(seatParam || 0);
  const seats = useMemo(() => Array.from({ length: nSeats }, (_, i) => ({ seat: i, name: i === mySeat ? 'You' : NAMES[i] || `Bot ${i}`, avatar: i === mySeat ? '\u{1F98A}' : '\u{1F916}', hex: COLORS[i % COLORS.length].hex, color: COLORS[i % COLORS.length].id, kind: i === mySeat ? 'human' : 'bot', bot: i === mySeat ? null : { level: 2 }, card: null })), [nSeats, mySeat]);
  const [, bump] = useReducer((n) => n + 1, 0);
  const [err, setErr] = useState('');
  const match = useRef(null);
  if (!match.current) {
    let settings = {};
    try { settings = JSON.parse(q.get('settings') || '{}'); } catch { /* ignore */ }
    const base = { size: nSeats, fillBots: true, botLevel: 2, ...settings };
    // &seed=7 deals the same cards every time (boardgame.io seeds its shuffle
    // from the game object, not from the setup data).
    const rules = q.get('seed') ? { ...mod.rules, seed: q.get('seed') } : mod.rules;
    match.current = createMatch(rules, nSeats, { arena: true, seats: seats.map((s) => ({ name: s.name, avatar: s.avatar, bot: !!s.bot, botSpec: s.bot, color: s.color })), settings: rulesMod.normalizeSettings ? rulesMod.normalizeSettings(base) : base, seed: Number(q.get('seed') || 12345) });
  }
  const m = match.current;
  window.__match = m; // for the layout tests

  const moves = useMemo(() => {
    const out = {};
    for (const name of Object.keys(mod.rules.moves)) out[name] = (...args) => { if (mySeat === null) return; if (!m.move(mySeat, name, ...args)) setErr(`"${name}" was refused`); else setErr(''); bump(); };
    return out;
  }, [mod, m, mySeat]);

  // Bots and the house seat, one action per tick.
  useEffect(() => {
    if (m.G.over) return undefined;
    const t = setTimeout(() => {
      const acting = actingSeats(m.G).filter((s) => auto || s !== mySeat);
      for (const seat of acting) {
        const act = botMod.bot({ G: m.view(seat), ctx: m.ctx, seat, level: 2, spec: seats[seat] ? seats[seat].bot || {} : {} });
        if (act) { if (!m.move(seat, act.move, ...(act.args || []))) setErr(`bot move ${act.move} by seat ${seat} was refused`); bump(); return; }
      }
      if (actingSeats(m.G).some((s) => !auto && s === mySeat)) return;
      const chore = rulesMod.housekeeping ? rulesMod.housekeeping(m.G, { seats, now: Date.now() }) : null;
      if (chore) { if (!m.move(m.house(), chore.move, ...(chore.args || []))) setErr(`house move ${chore.move} was refused`); bump(); }
    }, delay);
    return () => clearTimeout(t);
  });

  const { Board } = mod;
  const acting = actingSeats(m.G);
  const shell = { leave: () => {}, openChat: () => {}, openHelp: () => {}, unread: 0, debriefUrl: '#', finished: !!m.G.over };
  return (
    <div className="stage" data-game={gameId} data-over={m.G.over ? '1' : '0'}>
      {!mod.fullscreen && (
        <>
          <div className="stage__bar"><div className="grow truncate" style={{ fontWeight: 700 }}>{meta.name} <span className="tiny muted">workbench</span></div><button className="btn sm" onClick={() => window.location.reload()}>Restart</button></div>
          <div className="stage__seats">{seats.map((s) => <div key={s.seat} className={`stage__seat${acting.includes(s.seat) && !m.G.over ? ' turn' : ''}`}><span style={{ width: 10, height: 10, borderRadius: '50%', background: s.hex }} />{s.name}</div>)}</div>
          <div className="stage__banner">{m.G.over ? `Game over: placements ${JSON.stringify(m.G.over.placements)}` : acting.includes(mySeat) ? <b className="gold">Your move</b> : `Waiting for ${acting.map((s) => seats[s] ? seats[s].name : s).join(', ') || 'the house'}`}{err && <span className="bad"> {'·'} {err}</span>}</div>
        </>
      )}
      <div className="stage__board" style={mod.fullscreen ? { padding: 0, overflow: 'auto' } : undefined}>
        <Board G={m.view(mySeat)} ctx={m.ctx} moves={moves} playerID={mySeat === null ? null : String(mySeat)} seats={seats} table={{ id: 'workbench', gameId, seats, settings: {} }} me={{ id: 'me', displayName: 'You' }} shell={shell} />
      </div>
    </div>
  );
}

async function boot() {
  const key = (map, file) => Object.keys(map).find((k) => k.includes(`/${gameId}/${file}`));
  const [mod, botMod, meta, rulesMod] = await Promise.all([mods[key(mods, 'client.js')](), bots[key(bots, 'bot.js')](), metas[key(metas, 'meta.js')](), rulesMods[key(rulesMods, 'rules.js')]()]);
  createRoot(document.getElementById('root')).render(<StrictMode><Workbench mod={mod} botMod={botMod} meta={meta.default} rulesMod={rulesMod} /></StrictMode>);
}
boot().catch((e) => { document.getElementById('root').textContent = `Workbench: ${e.message}`; });
