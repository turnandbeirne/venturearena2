import { useEffect, useState } from 'react';
import '../styles/game.css';
import { getDifficulty, ASSETS } from '../data/gameConfig';
import { usePlaySpeed } from '../hooks/usePlaySpeed';
import { useTeachMode } from '../hooks/useTeachMode';
import { turnOrdinal, currentTurnTally } from '../game/turnClock';
import { totalUnitsOwned } from '../game/players';
import { playSound } from '../audio/soundEngine';
import { ARENA_STALL_WARN_MS, ARENA_STALL_NOTICE_MS, ARENA_STALL_MS } from '../arena/arenaConfig';

// Arena table timing: how long everyone else sees a card they don't own.
// (The owner's-browser and host's-browser auto-continue timers that used to
// sit next to it are gone: the server's house seat continues a forgotten card
// now. See src/games/ventureflow/rules.js PACE.)
const ARENA_PEEK_MS = 2600;
import { playMusicTrack, setMusicLevel } from '../audio/musicEngine';
import WeatherBadge from './WeatherBadge';
import WeatherCard from './WeatherCard';
import MonthProgress from './MonthProgress';
import PlayerPanel from './PlayerPanel';
import AssetShop from './AssetShop';
import ActionBar from './ActionBar';
import EventLog from './EventLog';
import ChatPanel from './ChatPanel';
import FortuneCardModal from './FortuneCardModal';
import BusinessExitOfferModal from './BusinessExitOfferModal';
import VolumeControl from './VolumeControl';
import MusicControl from './MusicControl';
import AudioStatus from './AudioStatus';
import Brand from './Brand';
import LeaderboardModal from './LeaderboardModal';
import RulebookModal from './RulebookModal';
import MarketHistoryModal from './MarketHistoryModal';
import SpeedControl from './SpeedControl';
import TurnTimer from './TurnTimer';
import StartupLaunchModal from './StartupLaunchModal';
import StartBusinessModal from './StartBusinessModal';
import PlayerDetailModal from './PlayerDetailModal';
import StatsHUD from './StatsHUD';
import AssetHistoryModal from './AssetHistoryModal';
import GameEndingRecap from './GameEndingRecap';

export default function GameBoard({ game, readOnly = false, onExitReadOnly }) {
  const { state } = game;
  const {
    players,
    activePlayerIndex,
    weather,
    assetPrices,
    previousAssetPrices,
    month,
    totalMonths,
    log,
    chat,
    status,
    weatherIncomeAmounts,
  } = state;
  const difficulty = getDifficulty(state.difficultyId);
  // Read live so a mid-game change to the slider takes effect on the very
  // next beat — including the robot-recap auto-advance below.
  const { speed } = usePlaySpeed();
  const { teachMode, toggle: toggleTeachMode } = useTeachMode();
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showRulebook, setShowRulebook] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  // Which asset (if any) has its price/cashflow history chart open — see
  // AssetHistoryModal.jsx, opened from a "📊 History" button on each
  // AssetShop card.
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  // Naming step between tapping "Start Business" and the launch
  // celebration — see StartBusinessModal.jsx.
  const [showStartBusiness, setShowStartBusiness] = useState(false);
  const activePlayer = players[activePlayerIndex];
  // What the active player has bought during THIS turn — the shop uses it to
  // warn that selling those units back carries the same-turn resale fee,
  // rather than letting the player discover it from the receipt. Declared
  // after `activePlayer`, which it reads.
  const sameTurnBuys = currentTurnTally(activePlayer?.turnBuys, turnOrdinal(state));
  // "You," for the persistent stats strip below: the active player when
  // it's a human's turn (so hotseat pass-and-play always shows whoever's
  // actually holding the device), otherwise the first human in the roster
  // (so solo mode still shows YOUR numbers while a robot plays, instead of
  // the robot's) — see StatsHUD.jsx.
  const hudPlayer = activePlayer?.type === 'human' ? activePlayer : players.find((p) => p.type === 'human') || null;

  // The soft instrumental plays for the whole time the board is up —
  // through every month, every turn, fortune-card recaps included — since
  // this component stays mounted for all of that; only game-over (a
  // different screen) swaps back to the theme song.
  useEffect(() => {
    playMusicTrack('background');
  }, []);
  // Month 1 is the "settle in" month, so the music stays at medium; from
  // month 2 on it steps back to mid-low for the rest of the game (the
  // game-over screen brings it back up). setMusicLevel is a no-op when the
  // level is already right, so re-running it on every month change is free.
  useEffect(() => {
    setMusicLevel(month <= 1 ? 'medium' : 'midLow');
  }, [month]);
  const selectedPlayer = selectedPlayerId ? players.find((p) => p.id === selectedPlayerId) : null;
  const selectedAsset = selectedAssetId ? ASSETS.find((a) => a.id === selectedAssetId) : null;
  // At a VentureArena table each browser controls one seat: the action
  // buttons are live only when the active player IS this browser's player.
  const localPlayerId = game.localPlayerId || null;
  // An arena observer (no seat) watches the table read-only.
  const spectator = !!game.arena?.active && !localPlayerId;
  const isHumanTurn =
    !readOnly && !spectator && status === 'playing' && activePlayer?.type === 'human' && (!localPlayerId || activePlayer.id === localPlayerId);
  const isRemoteHumanTurn =
    !readOnly && status === 'playing' && activePlayer?.type === 'human' && (spectator || (!!localPlayerId && activePlayer.id !== localPlayerId));
  const currentFortuneEntry = status === 'monthRecap' ? state.fortuneRecap[state.fortuneRecapIndex] : null;
  const currentFortunePlayer = currentFortuneEntry
    ? players.find((p) => p.id === currentFortuneEntry.playerId)
    : null;
  // At an arena table only the card's OWNER gets the blocking modal and the
  // "Got it!" that advances the table; everyone else gets a 2.5s peek at the
  // card (and a robot's card is advanced by the host's browser alone).
  const arenaActive = !!game.arena?.active;
  // The arena's frame around the board (leave, table talk), when there is one.
  const arenaShell = arenaActive ? game.arena.shell || null : null;
  const isMyFortune = !!currentFortuneEntry && !!localPlayerId && currentFortuneEntry.playerId === localPlayerId;
  const showModalForHuman = currentFortuneEntry && currentFortunePlayer?.type === 'human' && (!arenaActive || isMyFortune);
  const fortuneKey = currentFortuneEntry ? `${state.month}:${state.fortuneRecapIndex}:${currentFortuneEntry.playerId}` : null;
  const [peek, setPeek] = useState(null);   // { key, entry, kind } shown briefly to non-owners
  useEffect(() => {
    if (!arenaActive || !currentFortuneEntry || isMyFortune) return undefined;
    setPeek({ key: fortuneKey, entry: currentFortuneEntry, kind: 'fortune' });
    // VentureArena v2: the hide timer is deliberately NOT cancelled when the
    // card moves on. The server advances a robot's card after exactly the
    // peek time, so "next state arrives" and "peek timer fires" race; when
    // the state won, the cleanup cancelled the timer and the LAST card of the
    // month stayed on screen until someone tapped it. A peek now always lasts
    // its 2.6s (or until a newer peek replaces it: the key check below).
    setTimeout(() => setPeek((p) => (p && p.key === fortuneKey ? null : p)), ARENA_PEEK_MS);
    return undefined;
  }, [arenaActive, fortuneKey, isMyFortune]); // eslint-disable-line react-hooks/exhaustive-deps
  // Same for the startup-launch celebration: the founder gets the modal,
  // the rest of the table a peek.
  const launch = state.pendingLaunch || null;
  const isMyLaunch = !!launch && !!localPlayerId && launch.playerId === localPlayerId;
  const launchKey = launch ? `${state.month}:${launch.businessId}` : null;
  useEffect(() => {
    if (!arenaActive || !launch || isMyLaunch) return undefined;
    setPeek({ key: launchKey, entry: launch, kind: 'launch' });
    // Same as the fortune peek above: it lasts its 2.6s whatever happens next.
    setTimeout(() => setPeek((p) => (p && p.key === launchKey ? null : p)), ARENA_PEEK_MS);
    return undefined;
  }, [arenaActive, launchKey, isMyLaunch]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingExitOffer = status === 'exitOffer' ? state.pendingExitOffer : null;
  const exitOfferPlayer = pendingExitOffer ? players.find((p) => p.id === pendingExitOffer.playerId) : null;

  // Robots don't need to see their own fortune-card recap — auto-advance
  // past their entries so only human players' cards pause the game.
  useEffect(() => {
    // VentureArena v2: the server's house seat advances a robot's card (after
    // everyone's 2.6s peek) and continues a person's forgotten card (25s). No
    // browser does either any more: when "the host's browser" ran these
    // timers, a host who closed the tab froze the table (failure-table row 7).
    if (arenaActive) return undefined;
    if (status !== 'monthRecap') return;
    if (!currentFortuneEntry) return;
    if (currentFortunePlayer?.type === 'ai') {
      const t = setTimeout(() => game.ackFortuneCard(), speed.recapAdvanceMs);
      return () => clearTimeout(t);
    }
    // Depends on the STABLE useCallback, not the whole `game` object: App
    // rebuilds that object on every one of its renders, so listing it here
    // cleared and restarted this timer each time. Harmless only because
    // nothing currently re-renders App during a recap — but at the fastest
    // speed (200ms) any future ticking state in App would restart the timer
    // faster than it could fire and hang the game on the recap screen.
  }, [status, currentFortuneEntry, currentFortunePlayer, game.ackFortuneCard, speed, arenaActive]);

  // Stall ladder (arena tables): how long since the table's last move while
  // a live human holds the turn. Ticks every 5s so the banners advance.
  const [, setStallTick] = useState(0);
  useEffect(() => {
    if (!arenaActive) return undefined;
    const t = setInterval(() => setStallTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [arenaActive]);
  const idleMs = arenaActive && status === 'playing' && activePlayer?.type === 'human' ? Date.now() - (game.arena.lastMoveAt || Date.now()) : 0;
  // VentureArena v2: the nudge (40s) and the notice (60s) are still this
  // browser's own count from the last move it saw. The third rung, where the
  // table may vote and the host may replace, is no longer a browser's opinion:
  // it shows when the SERVER has marked this seat as stalled, which is also
  // the only time the server accepts a vote or a replace (failure-table row 7).
  const serverStalled = arenaActive && !!activePlayer && game.arena.stalledPlayerId === activePlayer.id;
  const stallStage = serverStalled ? 3 : idleMs >= ARENA_STALL_NOTICE_MS ? 2 : idleMs >= ARENA_STALL_WARN_MS ? 1 : 0;
  const stalledIsMe = stallStage > 0 && isHumanTurn;
  const votesAgainstActive = (state.kickVotes && activePlayer && state.kickVotes[activePlayer.id]) || [];
  const otherHumans = activePlayer ? players.filter((p) => p.type === 'human' && p.id !== activePlayer.id) : [];
  const iVoted = !!localPlayerId && votesAgainstActive.includes(localPlayerId);
  const myPlayer = localPlayerId ? players.find((p) => p.id === localPlayerId) : null;
  const [resignArmed, setResignArmed] = useState(false);
  const [showOptions, setShowOptions] = useState(() => { try { return localStorage.getItem('vf_show_options') === '1'; } catch { return false; } });
  useEffect(() => {
    if (!resignArmed) return undefined;
    const t = setTimeout(() => setResignArmed(false), 6000);
    return () => clearTimeout(t);
  }, [resignArmed]);
  const secs = (ms) => Math.max(0, Math.ceil(ms / 1000));

  // A launch celebration nobody dismisses must not stall the table either.
  // VentureArena v2: the server's house seat dismisses it after 25s; the
  // founder's-browser and host's-browser timers that did this are removed
  // (failure-table row 7: no browser is special).

  // Auto-dismiss error toasts.
  useEffect(() => {
    if (!state.lastError) return;
    const t = setTimeout(() => game.clearError(), 2400);
    return () => clearTimeout(t);
  }, [state.lastError, game.clearError]);

  return (
    <div className="vf-page">
      <div className="vf-board-layout">
        <div className="vf-card vf-board">
          <StatsHUD
            player={hudPlayer}
            prices={assetPrices}
            allPlayers={players}
            month={month}
            weatherIncomeAmounts={weatherIncomeAmounts}
            onOpenPortfolio={(playerId) => {
              setSelectedPlayerId(playerId);
            }}
          />

          <div className="vf-header vf-header--compact">
            <Brand size="sm" align="left" />
            <div className="vf-header__right">
              {/* Only renders when this game was started with the timer on
                  and it's a human's live turn — see TurnTimer.jsx. */}
              <TurnTimer
                enabled={!!state.turnTimer && isHumanTurn}
                deadlineAt={state.turnDeadlineAt}
                player={activePlayer}
                onStart={game.startTurnTimer}
                onExtend={() => game.extendTurn(activePlayer.id)}
                onExpire={() => game.endTurn(activePlayer.id)}
                serverRuns={arenaActive}
              />
              <span className="vf-pill" title={difficulty.tagline}>
                {difficulty.icon} {difficulty.name}
              </span>
              <WeatherBadge weather={weather} />
              <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" title="Leaderboard" onClick={() => { playSound('click'); setShowLeaderboard(true); }}>🏆</button>
              {/* Everything people rarely touch mid-game lives behind one
                  Options toggle so the board itself gets the screen. */}
              <button
                type="button"
                className={`vf-btn vf-btn--sm ${showOptions ? 'vf-btn--go' : 'vf-btn--ghost'}`}
                title="Sound, speed, Teach Me, rulebook, market history, new game"
                aria-expanded={showOptions}
                onClick={() => { playSound('click'); setShowOptions((v) => { try { localStorage.setItem('vf_show_options', v ? '0' : '1'); } catch { /* ignore */ } return !v; }); }}
              >
                ⚙️ {showOptions ? 'Hide' : 'Options'}
              </button>
              {readOnly && (
                <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" onClick={() => { playSound('click'); onExitReadOnly?.(); }}>← Back to Recap</button>
              )}
            </div>
          </div>
          {showOptions && (
            <div className="vf-header__options">
              <VolumeControl />
              <MusicControl />
              <AudioStatus />
              {/* Play speed lives on the board, not just on setup, because
                  the whole point is being able to slow the table down the
                  moment it starts moving faster than you can follow. */}
              <SpeedControl />
              {/* Toggles the on-demand ❓ lesson tooltips — a device-level
                  preference (hooks/useTeachMode.js), not part of the game. */}
              <button
                type="button"
                className={`vf-btn vf-btn--sm ${teachMode ? 'vf-btn--go' : 'vf-btn--ghost'}`}
                title={teachMode ? 'Teach Me mode is ON — tap to hide the ❓ lesson tips' : 'Turn on Teach Me mode for ❓ lesson tips on cards, weather, and more'}
                onClick={() => { playSound('click'); toggleTeachMode(); }}
              >
                🎓 Teach Me
              </button>
              <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" title="Rulebook — how everything works" onClick={() => { playSound('click'); setShowRulebook(true); }}>📖 Rules</button>
              <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" title="Market history — prices and payouts by month" onClick={() => { playSound('click'); setShowMarket(true); }}>📈 Market</button>
              {/* VentureArena v2: the table is this page now, so "Back to
                  table" became the two things the table page was for: the
                  arena's own table talk (people watching are there too) and
                  leaving. Leaving hands the seat to a robot, as it always did. */}
              {!readOnly && arenaShell && (
                <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" title="The arena's table talk: everyone at the table, people watching included" onClick={() => { playSound('click'); arenaShell.openChat(); }}>💬 Table talk{arenaShell.unread > 0 ? ` (${arenaShell.unread})` : ''}</button>
              )}
              {!readOnly && arenaShell && (
                <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" title={spectator ? 'Stop watching and go back to the lobby' : 'Leave the table: a robot finishes your game'} onClick={() => { playSound('click'); arenaShell.leave(); }}>🏟️ {spectator ? 'Stop watching' : 'Leave table'}</button>
              )}
              {!readOnly && !arenaShell && (
                <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" onClick={() => { playSound('click'); game.newGame(); }}>{arenaActive ? '🏟️ Back to table' : 'New Game'}</button>
              )}
            </div>
          )}

          <MonthProgress month={month} totalMonths={totalMonths} />

          <PlayerPanel
            players={players}
            prices={assetPrices}
            month={month}
            weatherIncomeAmounts={weatherIncomeAmounts}
            activePlayerIndex={activePlayerIndex}
            spotlightMs={speed.spotlightMs}
            onSelectPlayer={(playerId) => {
              playSound('click');
              setSelectedPlayerId(playerId);
            }}
          />

          <div className={`vf-turn-banner ${isHumanTurn ? '' : 'vf-turn-banner--ai'}`}>
            <span className="vf-turn-banner__text">
              {readOnly
                ? '🏁 Final game board — here\'s how everything ended up'
                : status === 'gameEnding'
                ? '🏁 That\'s a wrap! Browse the recap, then head to the leaderboard.'
                : status === 'exitOffer'
                ? `💼 ${exitOfferPlayer?.name || 'Someone'} has a buyout offer to decide on...`
                : status === 'monthRecap'
                ? '📬 Reading this month\'s fortune cards...'
                : isRemoteHumanTurn
                ? `${activePlayer?.avatar} Waiting for ${activePlayer?.name}…`
                : isHumanTurn
                ? `${activePlayer.avatar} ${
                    activePlayer.name.toLowerCase() === 'you' ? 'Your' : `${activePlayer.name}'s`
                  } turn — what will you do?`
                : `🤖 ${activePlayer?.name} is thinking...`}
            </span>
            {/* A second "Done!" button, mirroring ActionBar's, so a human
                who's ready to pass can end their turn from up here without
                scrolling past the shop first — see ActionBar.jsx for the
                original at the bottom of the board, which stays in place
                for anyone who scrolls down anyway. Same enable condition,
                same handler; this is a duplicate control, not a new one. */}
            {/* VentureArena v2: only a seat a person is still playing gets the
                vote and replace buttons (a seat a robot is finishing has no vote). */}
            {isRemoteHumanTurn && stallStage >= 2 && localPlayerId && myPlayer?.type === 'human' && (
              <span className="vf-stall-note">
                {stallStage === 2
                  ? `${activePlayer.name} has been idle ${secs(idleMs)}s. In ${secs(ARENA_STALL_MS - idleMs)}s the table can let a robot finish their game.`
                  : `${activePlayer.name} has been idle ${secs(idleMs)}s.`}
                {stallStage === 3 && !iVoted && (
                  <button type="button" className="vf-btn vf-btn--sm" title="Unanimous among the other live players hands this seat to a robot; any move by them cancels the votes." onClick={() => game.kickVote(activePlayer.id, localPlayerId)}>
                    🗳️ Vote: robot finishes for {activePlayer.name} ({votesAgainstActive.length}/{otherHumans.length})
                  </button>
                )}
                {stallStage === 3 && iVoted && <span className="vf-stall-note__count">🗳️ You voted · {votesAgainstActive.length} of {otherHumans.length}</span>}
                {stallStage === 3 && game.arena?.isHost && (
                  <button type="button" className="vf-btn vf-btn--sm vf-btn--ghost" title="Host decision: a robot finishes this seat's game now." onClick={() => game.convertSeatToAi(activePlayer.id, 'host')}>
                    🤖 Host: replace now
                  </button>
                )}
              </span>
            )}
            {isHumanTurn && (
              <button
                type="button"
                className="vf-btn vf-btn--primary vf-btn--sm vf-turn-banner__end-btn"
                onClick={() => game.endTurn(activePlayer.id)}
              >
                Done! Roll the weather 🎲
              </button>
            )}
            {stalledIsMe && (
              <span className={`vf-stall-note ${stallStage >= 2 ? 'vf-stall-note--urgent' : ''}`}>
                {stallStage === 1 && 'Still there? The table is waiting on you.'}
                {stallStage === 2 && `Heads up: if you don't act in ${secs(ARENA_STALL_MS - idleMs)}s the other players can let a robot finish your game.`}
                {stallStage === 3 && `The table can now vote to replace you (${votesAgainstActive.length} of ${otherHumans.length} votes). Any move keeps your seat.`}
              </span>
            )}
            {arenaActive && myPlayer && myPlayer.type === 'human' && status !== 'gameover' && (
              <button
                type="button"
                className={`vf-btn vf-btn--sm ${resignArmed ? 'vf-btn--danger' : 'vf-btn--ghost'}`}
                title="Leave the table: a robot finishes your game with your cash and businesses; the result still counts."
                onClick={() => { if (resignArmed) { game.convertSeatToAi(localPlayerId, 'resigned'); setResignArmed(false); } else setResignArmed(true); }}
              >
                {resignArmed ? '🏳️ Click again to resign' : '🏳️ Resign'}
              </button>
            )}
          </div>

          <AssetShop
            prices={assetPrices}
            previousPrices={previousAssetPrices}
            player={activePlayer}
            allPlayers={players}
            weather={weather}
            weatherIncomeAmounts={weatherIncomeAmounts}
            sameTurnBuys={sameTurnBuys}
            disabled={!isHumanTurn}
            onBuy={(assetId, qty = 1) => game.buyAsset(activePlayer.id, assetId, qty)}
            onSell={(assetId, qty = 1) => game.sellAsset(activePlayer.id, assetId, qty)}
            pendingTrade={game.pendingTrade}
            viewer={arenaActive && myPlayer && activePlayer && myPlayer.id !== activePlayer.id ? myPlayer : null}
            onViewHistory={(assetId) => setSelectedAssetId(assetId)}
          />

          <ActionBar
            player={activePlayer}
            disabled={!isHumanTurn}
            onStartBusiness={() => {
              playSound('click');
              setShowStartBusiness(true);
            }}
            onLearnSkill={() => game.learnSkill(activePlayer.id)}
            onDone={() => game.endTurn(activePlayer.id)}
          />
        </div>

        {/* Sidebar: weather detail, the event log, and chat all stay in view
            at once on wider screens (sticky) instead of requiring scrolling
            past the board below them — falls back to stacking under the
            board on narrow screens, see game.css's .vf-board-layout.
            EventLog sits above ChatPanel: what actually happened this
            month is the thing you want to catch up on first, with the
            robots' in-character banter as a lower-priority feed below it. */}
        <div className="vf-board-sidebar">
          <WeatherCard
            weather={weather}
            weatherIncomeAmounts={weatherIncomeAmounts}
            weatherSeverityId={state.weatherSeverityId}
          />
          <EventLog log={log} />
          <ChatPanel chat={chat} players={players} onSendChat={game.sendChat} localPlayerId={localPlayerId} spectator={spectator} onOpenTableTalk={arenaShell ? arenaShell.openChat : null} />
        </div>
      </div>

      {showModalForHuman && (
        <FortuneCardModal entry={currentFortuneEntry} onContinue={game.ackFortuneCard} />
      )}

      {/* VentureArena v2: only the owner gets the decision. Everyone else used
          to get the same blocking modal with buttons the server refused
          (failure-table row 3); they have the "has a buyout offer to decide
          on" banner instead. */}
      {pendingExitOffer && (!arenaActive || pendingExitOffer.playerId === localPlayerId) && (
        <BusinessExitOfferModal
          offer={pendingExitOffer}
          playerName={exitOfferPlayer?.name}
          playerAvatar={exitOfferPlayer?.avatar}
          onDecide={(accept) => game.resolveExitOffer(pendingExitOffer.playerId, accept)}
        />
      )}

      <LeaderboardModal open={showLeaderboard} onClose={() => setShowLeaderboard(false)} />

      <MarketHistoryModal
        open={showMarket}
        history={state.marketHistory}
        onClose={() => setShowMarket(false)}
      />

      <RulebookModal
        open={showRulebook}
        difficultyId={state.difficultyId}
        scenarioId={state.scenarioId}
        weatherSeverityId={state.weatherSeverityId}
        turnTimer={!!state.turnTimer}
        onClose={() => setShowRulebook(false)}
      />

      {/* Launch celebration for a business a human just started. Rendered
          last so it sits above the portfolio modal the player almost
          certainly has open behind it. */}
      {state.pendingLaunch && (!arenaActive || isMyLaunch) && (
        <StartupLaunchModal launch={state.pendingLaunch} onContinue={game.ackStartupLaunch} />
      )}

      {peek && (
        <div className="vf-arena-peek" role="status" aria-live="polite" onClick={() => setPeek(null)}>
          {peek.kind === 'fortune' ? (
            <>
              <div className="vf-arena-peek__who">{peek.entry.avatar} {peek.entry.playerName}'s fortune card</div>
              <div className="vf-arena-peek__title">{peek.entry.card.icon} {peek.entry.card.title}</div>
              <div className={`vf-arena-peek__effect ${peek.entry.deckId === 'opportunity' ? 'vf-arena-peek__effect--good' : 'vf-arena-peek__effect--bad'}`}>{peek.entry.description}</div>
            </>
          ) : (
            <>
              <div className="vf-arena-peek__who">{peek.entry.avatar} {peek.entry.playerName} launched a business</div>
              <div className="vf-arena-peek__title">🚀 {peek.entry.businessName}</div>
              <div className="vf-arena-peek__effect vf-arena-peek__effect--good">+${peek.entry.income}/mo passive income</div>
            </>
          )}
        </div>
      )}

      {/* Naming step, opened by ActionBar's Start Business button, above —
          confirming here is what actually dispatches START_BUSINESS; the
          launch celebration modal above then picks up from the resulting
          state.pendingLaunch. */}
      {showStartBusiness && activePlayer && (
        <StartBusinessModal
          existingNames={activePlayer.businesses.map((b) => b.name)}
          playerName={activePlayer.name}
          onConfirm={(name) => {
            game.startBusiness(activePlayer.id, name);
            setShowStartBusiness(false);
          }}
          onCancel={() => setShowStartBusiness(false)}
        />
      )}

      {selectedPlayer && (
        <PlayerDetailModal
          player={selectedPlayer}
          prices={assetPrices}
          allPlayers={players}
          month={month}
          weather={weather}
          weatherIncomeAmounts={weatherIncomeAmounts}
          // Upgrade buttons only appear when viewing YOUR OWN active turn —
          // opening any other player's card (including mid-turn, including
          // AI) stays read-only, same as it always has been.
          canUpgrade={isHumanTurn && selectedPlayer.id === activePlayer?.id}
          onUpgradeBusiness={(playerId, businessId, trackId) => game.upgradeBusiness(playerId, businessId, trackId)}
          onClose={() => setSelectedPlayerId(null)}
        />
      )}

      {selectedAsset && (
        <AssetHistoryModal
          asset={selectedAsset}
          history={state.assetHistory?.[selectedAsset.id]}
          currentMonth={month}
          currentPrice={assetPrices[selectedAsset.id]}
          totalOwned={totalUnitsOwned(players, selectedAsset.id)}
          weatherIncomeAmounts={weatherIncomeAmounts}
          onClose={() => setSelectedAssetId(null)}
        />
      )}

      {/* The full end-of-game recap — every fortune card each player drew
          all game, plus clickable per-player net worth / passive cash flow
          / earnings timelines. See turnEngine.js's acknowledgeFortuneCard
          (sets this status instead of jumping straight to 'gameover') and
          finalizeGameOver (what "Continue to Leaderboard" dispatches). No
          auto-advance — this is meant to be browsed, not raced through. */}
      {status === 'gameEnding' && (
        <GameEndingRecap
          players={players}
          defaultPlayerId={localPlayerId || hudPlayer?.id}
          onContinue={() => game.finalizeGameOver()}
        />
      )}

      {state.lastError && <div className="vf-toast">{state.lastError}</div>}
    </div>
  );
}
