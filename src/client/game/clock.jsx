// The table clock. How long this game has been going, counted from the
// server's own start time: `table.now` is the server's clock when the table
// was sent, so a device whose clock is wrong still shows the right time.
//
// The clock ticks inside its own small component on purpose. A hook in
// GameStage would redraw the whole board once a second.
import { useEffect, useMemo, useState } from 'react';
import { clockTime, clockWords } from '../../shared/time.js';

// How far the server's clock is ahead of this device's. Every table the server
// sends is one measurement, and each is late by however long it took to arrive
// and be drawn, so the largest one seen is the closest to the truth. Keeping
// the best one also means the clock can never step backwards when a table is
// refreshed. (Bug: it did, by a second, when a refresh landed on a busy page.)
let bestOffset = null;
function serverOffset(now) {
  if (!Number.isFinite(now)) return bestOffset || 0;
  const measured = now - Date.now();
  bestOffset = bestOffset === null ? measured : Math.max(bestOffset, measured);
  return bestOffset;
}

/** Milliseconds this table has been playing; stops at the end of the game. */
export function useElapsed(table) {
  const offset = useMemo(() => serverOffset(table.now), [table.now]);
  const running = !!table.startedAt && !table.endedAt;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!table.startedAt) return 0;
  return Math.max(0, (table.endedAt || Date.now() + offset) - table.startedAt);
}

export function TableClock({ table, className = 'gclock' }) {
  const ms = useElapsed(table);
  return <time className={className} dateTime={`PT${Math.floor(ms / 1000)}S`} title={`${clockWords(ms)} played`} data-clock>{clockTime(ms)}</time>;
}

/**
 * Seconds left until `until` (this device's clock), ticking in its own small
 * component so the board around it is not redrawn. Shows nothing when the
 * deadline is unknown or has passed.
 */
export function Countdown({ until, prefix = '', suffix = '', className = 'gcount' }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const left = Math.ceil((until - Date.now()) / 1000);
  if (left <= 0) return null;
  return <span className={className} data-countdown>{prefix}{left >= 60 ? clockTime(left * 1000) : `${left}s`}{suffix}</span>;
}
