import { useEffect, useRef, useState } from 'react';
import { TURN_EXTENSION_SECONDS, TURN_WARNING_SECONDS, TURN_TIME_SECONDS } from '../data/gameConfig';
import { playSound } from '../audio/soundEngine';

const TICK_MS = 200;

/**
 * The optional per-turn clock (see gameConfig.js's TURN_TIME_SECONDS).
 *
 * Renders nothing at all when the timer wasn't enabled for this game, or
 * when it isn't a human's live turn — a robot's turn is paced by the speed
 * slider, and a fortune-card recap or a buyout decision shouldn't be racing
 * a clock the player can't act against.
 *
 * Three responsibilities, in this order:
 *  1. START the clock when a human turn begins and none is running. The
 *     deadline is computed here and handed to the reducer, so the reducer
 *     never reads Date.now() itself.
 *  2. TICK down, purely for display, and warn at TURN_WARNING_SECONDS.
 *  3. END the turn once the deadline passes. No penalty — nothing already
 *     bought is undone; the turn simply passes.
 */
export default function TurnTimer({ enabled, deadlineAt, player, onStart, onExtend, onExpire, serverRuns = false }) {
  const [now, setNow] = useState(() => Date.now());
  // Guards against the expiry firing twice for one deadline (the tick
  // interval and a re-render could both observe the same expired clock).
  const expiredForRef = useRef(null);
  const warnedForRef = useRef(null);

  // 1) Start the clock.
  // VentureArena v2 (`serverRuns`): the server's house seat starts the clock
  // and ends the turn when it lapses, so a closed tab can neither stop a clock
  // from starting nor keep a turn open (failure-table row 7). This component
  // then only shows the countdown, warns, and offers the extension.
  useEffect(() => {
    if (serverRuns) return;
    if (!enabled || deadlineAt) return;
    onStart(Date.now() + TURN_TIME_SECONDS * 1000);
  }, [enabled, deadlineAt, onStart, serverRuns]);

  // 2) Tick.
  useEffect(() => {
    if (!enabled || !deadlineAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [enabled, deadlineAt]);

  // 3) Warn, then expire.
  useEffect(() => {
    if (!enabled || !deadlineAt) return;
    const msLeft = deadlineAt - now;
    if (msLeft <= TURN_WARNING_SECONDS * 1000 && msLeft > 0 && warnedForRef.current !== deadlineAt) {
      warnedForRef.current = deadlineAt;
      playSound('timerWarning');
    }
    if (msLeft <= 0 && expiredForRef.current !== deadlineAt) {
      expiredForRef.current = deadlineAt;
      if (!serverRuns) onExpire();
    }
  }, [enabled, deadlineAt, now, onExpire, serverRuns]);

  if (!enabled || !deadlineAt || !player) return null;

  const secondsLeft = Math.max(0, Math.ceil((deadlineAt - now) / 1000));
  const urgent = secondsLeft <= TURN_WARNING_SECONDS;
  const extensionsLeft = player.turnExtensionsLeft || 0;

  return (
    <div className={`vf-turn-timer ${urgent ? 'vf-turn-timer--urgent' : ''}`}>
      <span className="vf-turn-timer__clock" aria-live="off">
        ⏱️ {secondsLeft}s
      </span>
      <button
        type="button"
        className="vf-btn vf-btn--sm vf-btn--ghost vf-turn-timer__extend"
        disabled={extensionsLeft <= 0}
        title={
          extensionsLeft > 0
            ? `Adds ${TURN_EXTENSION_SECONDS} seconds. ${extensionsLeft} left for the whole game.`
            : 'You have used all your time extensions this game.'
        }
        onClick={() => {
          playSound('click');
          onExtend();
        }}
      >
        +{TURN_EXTENSION_SECONDS}s
        <span className="vf-turn-timer__count">{extensionsLeft} left</span>
      </button>
    </div>
  );
}
