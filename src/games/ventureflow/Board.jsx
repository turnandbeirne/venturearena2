// VentureFlow's board on VentureArena.
//
// The game's own UI (vf/components) is used as it is. This file is the seam:
// it builds the `game` object those components were written against (what
// VentureFlow's useGame() hook returned: the state plus one function per
// action) from what the arena hands a board (G, moves, playerID, shell).
//
// What changed is only how an action travels. It used to be appended to a
// shared move list and replayed by every browser; now it is sent to the
// server as `moves.act(action)` and the server's state comes back. Nothing in
// here runs the game, a robot or a timer (HOUSE-RULES failure-table rows 7
// and 8), and whether an action may be sent is asked of rules.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
// The same weights VentureFlow's own main.jsx loads.
import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/dancing-script/600.css';
// Stylesheet ORDER is part of how VentureFlow looks. The game screens use
// classes from all four sheets, and where two sheets set the same thing the
// later one wins. On VentureFlow's own site theme.css ends up LAST (its recap
// page imports it again after everything else), so e.g. theme.css's Sell-button
// red wins over the darker red game.css declares. Same order here: setup,
// landing, game.css (imported by the components below), then theme.css after
// them. Measured against the original, pixel for pixel; do not reorder.
import './vf/styles/setup.css';
import './vf/styles/landing.css';
import GameBoard from './vf/components/GameBoard';
import GameOverScreen from './vf/components/GameOverScreen';
import './vf/styles/theme.css'; // after the components: see the note above
import { useGameSounds } from './vf/hooks/useGameSounds';
import { useChatSounds } from './vf/hooks/useChatSounds';
import { useProfile } from './vf/hooks/useProfile';
import { unlockAudio } from './vf/audio/soundEngine';
import { unlockMusic, stopMusic } from './vf/audio/musicEngine';
import { ARENA_TRADE_BATCH_MS } from './vf/arena/arenaConfig';
import { allowed, explain, hostSeat, stalledPlayer, playerIdOf } from './rules.js';

/** react-router's navigate, when the board is inside the app (the workbench has no router). */
function NavBridge({ navRef }) {
  const nav = useNavigate();
  useEffect(() => { navRef.current = nav; return () => { navRef.current = null; }; }, [nav, navRef]);
  return null;
}

/** The thin ribbon VentureFlow shows at an arena table (was src/arena/ArenaBanner.jsx). */
function ArenaRibbon({ people, seatLabel, isHost, watching, finished, shell, onDebrief }) {
  // Whole-pixel line height: a ribbon 33.5px tall would push the entire game
  // onto half pixels and soften every border under it.
  const style = { background: '#0b1530', color: '#f6f1e7', padding: '8px 14px', display: 'flex', gap: '4px 12px', alignItems: 'center', fontSize: 14, lineHeight: '20px', flexWrap: 'wrap' };
  const link = { marginLeft: 'auto', color: '#e8b64a', fontWeight: 600, background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 14, lineHeight: '20px', minHeight: 20, textDecoration: 'underline' };
  if (finished) {
    return (
      <div style={style}>
        <span>{'\u{1F3DF}️'} Results saved to the arena.</span>
        <a href={shell.debriefUrl} onClick={onDebrief} style={{ ...link, textDecoration: 'underline' }}>Go to the Debrief {'→'}</a>
      </div>
    );
  }
  return (
    <div style={style}>
      <span>{'\u{1F3DF}️'} VentureArena table {'·'} {people} {people === 1 ? 'player' : 'players'}{watching ? ' · you are watching' : seatLabel ? ` · you are ${seatLabel}` : ''}{isHost ? ' · host' : ''}</span>
      <span style={{ opacity: 0.7 }}>live{shell.clock ? <> {'·'} {shell.clock}</> : null}</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '4px 14px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {/* The arena's own drawer: how the game is going, the key to everything on the board, the luck so far. */}
        {shell.openInfo && (shell.tabs || []).filter((t) => t.id !== 'help').map((t) => (
          <button key={t.id} type="button" style={{ ...link, marginLeft: 0 }} onClick={() => shell.openInfo(t.id)}>{t.label}</button>
        ))}
        {shell.canResign && <button type="button" style={{ ...link, marginLeft: 0 }} onClick={shell.resign}>Resign</button>}
        <button type="button" style={{ ...link, marginLeft: 0 }} onClick={shell.openChat}>Table talk{shell.unread > 0 ? ` (${shell.unread})` : ''}</button>
      </span>
    </div>
  );
}

export default function Board({ G, moves, playerID, shell }) {
  const seat = playerID === null || playerID === undefined ? null : Number(playerID);
  const vf = G.vf;
  const localPlayerId = seat === null ? null : playerIdOf(G, seat);
  const { profile, recordResult } = useProfile();
  const [showBoardAfterGameOver, setShowBoardAfterGameOver] = useState(false);

  // Always the newest state, for callbacks that fire later (the trade timer).
  const live = useRef({ G, seat, moves });
  live.current = { G, seat, moves };

  // ---- navigation back into the arena ---------------------------------------------
  const inRouter = useInRouterContext();
  const navRef = useRef(null);
  const go = useCallback((url) => {
    if (!url || url === '#') return;
    if (navRef.current) navRef.current(url);
    else window.location.assign(url);
  }, []);
  const onBack = useCallback((e) => {
    // A plain link stays a plain link (open in a new tab still works); a plain
    // click moves inside the app without reloading it.
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0)) return;
    if (e) e.preventDefault();
    go(shell.debriefUrl);
  }, [go, shell.debriefUrl]);

  // ---- errors are this browser's own ------------------------------------------------
  // The engine reports a failed purchase by putting `lastError` in the state.
  // Online that state is never stored (rules.js refuses the move), so the
  // message is produced here by asking rules.js why, and shown to this player only.
  const [localError, setLocalError] = useState(null);
  const clearError = useCallback(() => setLocalError(null), []);

  /** Send one action as this seat. Returns false if it was not sent. */
  const send = useCallback((action) => {
    const { G: g, seat: s, moves: m } = live.current;
    if (s === null) return false;
    const why = explain(g, s, action);
    if (why) { setLocalError(why); return false; }
    if (!allowed(g, s, action)) return false; // a stale click (a second "Continue", a turn that just ended)
    m.act(action);
    return true;
  }, []);

  // ---- trades are coalesced (failure-table row 4) --------------------------------------
  // A press-and-hold fires BUY_ASSET many times a second. Same asset and same
  // direction within a short window becomes ONE move with a summed quantity,
  // clamped to what the player can actually afford or sell when it is sent.
  const tradeRef = useRef(null); // { assetId, type, qty }
  const tradeTimer = useRef(null);
  const [pendingTrade, setPendingTrade] = useState(null);
  const flushTrade = useCallback(() => {
    const t = tradeRef.current;
    tradeRef.current = null;
    if (tradeTimer.current) clearTimeout(tradeTimer.current);
    tradeTimer.current = null;
    setPendingTrade(null);
    if (!t) return;
    const { G: g, seat: s } = live.current;
    const player = s === null ? null : g.vf.players[s];
    const price = g.vf.assetPrices[t.assetId] || 0;
    let qty = t.qty;
    if (player) qty = t.type === 'BUY_ASSET' ? Math.min(qty, price > 0 ? Math.floor(player.cash / price) : 0) : Math.min(qty, player.holdings[t.assetId] || 0);
    if (qty <= 0) {
      // Nothing affordable at all: say why, the way a single failed click would.
      send({ type: t.type, assetId: t.assetId, qty: 1 });
      return;
    }
    send({ type: t.type, assetId: t.assetId, qty });
  }, [send]);
  const queueTrade = useCallback((action) => {
    const cur = tradeRef.current;
    const same = cur && cur.assetId === action.assetId && cur.type === action.type;
    if (cur && !same) flushTrade();
    const qty = (same ? cur.qty : 0) + (action.qty || 1);
    tradeRef.current = { assetId: action.assetId, type: action.type, qty };
    setPendingTrade({ assetId: action.assetId, type: action.type, qty });
    if (tradeTimer.current) clearTimeout(tradeTimer.current);
    tradeTimer.current = setTimeout(flushTrade, ARENA_TRADE_BATCH_MS);
  }, [flushTrade]);
  useEffect(() => () => { if (tradeTimer.current) clearTimeout(tradeTimer.current); }, []);

  /** Everything else goes after any trade still queued, so the order the player clicked in is the order the server sees. */
  const dispatch = useCallback((action) => {
    if (action.type === 'BUY_ASSET' || action.type === 'SELL_ASSET') { queueTrade(action); return; }
    if (tradeRef.current) flushTrade();
    send(action);
  }, [queueTrade, flushTrade, send]);

  // ---- when did this browser last see the table move? -----------------------------------
  // For the 40s nudge and the 60s notice. G.actN counts real activity; the
  // server marking a stall or someone voting does not reset the silence.
  const [lastMoveAt, setLastMoveAt] = useState(() => Date.now());
  useEffect(() => { setLastMoveAt(Date.now()); }, [G.actN]);

  // ---- the turn clock is the server's -----------------------------------------------------
  // The deadline is a server timestamp. If this device's clock is off, the
  // countdown would be too. Every house move carries the server's time
  // (G.houseAt), so the difference is measured as updates arrive live; the
  // best (least delayed) measurement is kept. Unknown until the first one.
  const offsetRef = useRef(null);
  const seenHouseAt = useRef(G.houseAt);
  if (G.houseAt !== seenHouseAt.current) {
    seenHouseAt.current = G.houseAt;
    if (Number.isFinite(G.houseAt)) {
      const measured = G.houseAt - Date.now();
      offsetRef.current = offsetRef.current === null ? measured : Math.max(offsetRef.current, measured);
    }
  }
  const offset = offsetRef.current || 0;

  // ---- the state the components read -----------------------------------------------------
  const state = useMemo(() => ({
    ...vf,
    // A game ended by the arena's mercy limit has no 'gameover' status of its own.
    status: G.over && vf.status !== 'gameover' ? 'gameover' : vf.status,
    turnDeadlineAt: vf.turnDeadlineAt ? vf.turnDeadlineAt - offset : vf.turnDeadlineAt,
    lastError: localError,
  }), [vf, G.over, offset, localError]);

  const isHost = seat !== null && hostSeat(vf) === seat;
  const arenaResult = useMemo(() => (shell.finished ? { ok: true, nextUrl: shell.debriefUrl } : null), [shell.finished, shell.debriefUrl]);
  // Shaped like what VentureFlow's useArenaSync() returned, so every
  // arena-aware branch in the vendored UI keeps working unchanged.
  const arena = useMemo(() => ({
    active: true,
    status: 'synced',
    isHost,
    isObserver: seat === null,
    lastMoveAt,
    localPlayerId,
    pendingTrade,
    stalledPlayerId: stalledPlayer(G), // the seat the SERVER says may be voted out or replaced
    shell,
    arena: { tableUrl: shell.debriefUrl, debriefUrl: shell.debriefUrl, isHost, onBack },
  }), [isHost, seat, lastMoveAt, localPlayerId, pendingTrade, G, shell, onBack]);

  // One stable function per action, as useGame() had. The player id argument
  // the components pass is ignored on purpose: the server takes it from the seat.
  const actions = useMemo(() => ({
    buyAsset: (_playerId, assetId, qty = 1) => dispatch({ type: 'BUY_ASSET', assetId, qty }),
    sellAsset: (_playerId, assetId, qty = 1) => dispatch({ type: 'SELL_ASSET', assetId, qty }),
    startBusiness: (_playerId, name) => dispatch({ type: 'START_BUSINESS', name }),
    learnSkill: () => dispatch({ type: 'LEARN_SKILL' }),
    upgradeBusiness: (_playerId, businessId, trackId) => dispatch({ type: 'UPGRADE_BUSINESS', businessId, trackId }),
    endTurn: () => dispatch({ type: 'END_TURN' }),
    extendTurn: () => dispatch({ type: 'EXTEND_TURN' }),
    // The index makes a double click harmless: it cannot also dismiss the next card.
    ackFortuneCard: () => dispatch({ type: 'ACK_FORTUNE_CARD', index: live.current.G.vf.fortuneRecapIndex }),
    ackStartupLaunch: () => dispatch({ type: 'ACK_STARTUP_LAUNCH' }),
    finalizeGameOver: () => dispatch({ type: 'FINALIZE_GAME_OVER' }),
    resolveExitOffer: (_playerId, accept) => dispatch({ type: 'RESOLVE_EXIT_OFFER', accept: !!accept }),
    sendChat: (_playerId, message, targetPlayerId) => dispatch({ type: 'SEND_CHAT', message, targetPlayerId: targetPlayerId || null }),
    convertSeatToAi: (playerId, reason = 'away') => dispatch({ type: 'CONVERT_SEAT_TO_AI', playerId, reason }),
    kickVote: (targetId) => dispatch({ type: 'KICK_VOTE', playerId: targetId }),
    // The server's house seat starts the turn clock (rules.js housekeeping).
    startTurnTimer: () => {},
    clearError,
  }), [dispatch, clearError]);

  // "Play Again" on the game-over screen used to reload the arena's table
  // page; the table's next stop is its debrief, which is where a rematch starts.
  const newGame = useCallback(() => {
    setShowBoardAfterGameOver(false);
    if (shell.finished || live.current.G.over) go(shell.debriefUrl);
    else shell.leave();
  }, [go, shell]);

  const game = useMemo(() => ({ state, arena, localPlayerId, pendingTrade, newGame, ...actions }), [state, arena, localPlayerId, pendingTrade, newGame, actions]);

  // ---- sound, exactly as VentureFlow's App.jsx wires it --------------------------------------
  // Browsers refuse audio until the page has had a real gesture, so the first
  // interaction anywhere unlocks both engines without overriding a mute.
  useEffect(() => {
    const unlock = () => {
      unlockAudio({ unmute: false, testSound: null });
      unlockMusic({ unmute: false });
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);
  // VentureFlow was a page of its own, so leaving it stopped the music. Here
  // leaving the table only unmounts this board; without this the soundtrack
  // would follow the member into the lobby.
  useEffect(() => () => stopMusic(), []);
  useGameSounds(vf.log);
  useChatSounds(vf.chat);

  const people = vf.players.filter((p) => p.type === 'human' || p.originalName).length;
  const over = state.status === 'gameover';

  return (
    <div className="vf-root" data-theme={profile.selectedTheme}>
      {inRouter && <NavBridge navRef={navRef} />}
      <ArenaRibbon people={people} seatLabel={localPlayerId ? localPlayerId.toUpperCase() : ''} isHost={isHost} watching={seat === null} finished={over && !!arenaResult} shell={shell} onDebrief={onBack} />
      {over && !showBoardAfterGameOver ? (
        <GameOverScreen
          state={state}
          onPlayAgain={newGame}
          // A watcher's browser has no result of its own to add to its lifetime profile.
          onRecordProfileResult={seat === null ? undefined : recordResult}
          onViewBoard={() => setShowBoardAfterGameOver(true)}
          localPlayerId={localPlayerId}
          arena={arena.arena}
          arenaResult={arenaResult}
        />
      ) : over ? (
        <GameBoard game={game} readOnly onExitReadOnly={() => setShowBoardAfterGameOver(false)} />
      ) : (
        <GameBoard game={game} />
      )}
    </div>
  );
}
