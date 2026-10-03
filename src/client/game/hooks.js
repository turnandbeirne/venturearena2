// Hooks every board uses.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Size a board from the space it actually has. Returns the largest cell size
 * (px) at which a cols x rows grid fits the element, measured in the browser
 * and re-measured when the element resizes (rotation, keyboard, chat drawer).
 * Never eyeball a board size in CSS: phones differ by a third in height.
 */
export function useFit(ref, cols, rows, { gap = 0, pad = 0, max = 96, min = 20 } = {}) {
  const [cell, setCell] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = el.clientWidth - pad * 2 - gap * (cols - 1);
      const h = el.clientHeight - pad * 2 - gap * (rows - 1);
      if (w <= 0 || h <= 0) return;
      setCell(Math.max(min, Math.min(max, Math.floor(Math.min(w / cols, h / rows)))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, cols, rows, gap, pad, max, min]);
  return cell;
}

/**
 * Call `onEntry` once for each NEW entry in G.log, keyed by the entry's
 * counter. Entries already in the log when the board mounts are skipped, so
 * a refresh does not replay every animation and toast.
 */
export function useLogFeed(G, onEntry) {
  const seen = useRef(null);
  const cb = useRef(onEntry);
  cb.current = onEntry;
  useEffect(() => {
    if (!G) return;
    const logN = typeof G.logN === 'number' ? G.logN : 0;
    if (seen.current === null) { seen.current = logN; return; }
    if (logN <= seen.current) return;
    const fresh = (Array.isArray(G.log) ? G.log : []).filter((e) => e.n > seen.current);
    seen.current = logN;
    for (const e of fresh) cb.current(e);
  }, [G]);
}

/** The newest log entry of a kind, with its counter, for keyed animations. */
export function lastOf(G, type) {
  const log = Array.isArray(G.log) ? G.log : [];
  for (let i = log.length - 1; i >= 0; i--) if (log[i].t === type) return log[i];
  return null;
}

/** A short-lived message keyed by a counter, for "X played Y" toasts. */
export function useToast(ms = 2600) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = (text, key) => {
    setToast({ text, key: key ?? Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}

/**
 * One thing at a time, each long enough to read.
 *
 * New log entries are put in words by `toLine(entry)` ({ n, t, text, why, ms } or
 * null to skip) and shown one after another: an entry stays up for a time
 * that grows with its length (and with the table's pace, `factor`), and the
 * next one waits its turn. (Bug: the feed showed the newest three lines the
 * moment they arrived. Three robots playing in a row replaced it twice a
 * second and nobody could read what had been done to them.)
 *
 * If the table gets well ahead, the announcer speeds up and then skips to the
 * latest: it must never be describing something from half a minute ago. The
 * full list is in the drawer's "What happened" tab.
 */
export function useAnnouncer(G, toLine, { factor = 1 } = {}) {
  const fn = useRef(toLine);
  fn.current = toLine;
  const pace = useRef(factor);
  pace.current = factor;
  const [now, setNow] = useState(() => {
    const log = G && Array.isArray(G.log) ? G.log : [];
    for (let i = log.length - 1; i >= 0; i--) { const line = toLine(log[i]); if (line) return line; }
    return null;
  });
  const queue = useRef([]);
  const timer = useRef(null);
  const step = useRef(null);
  step.current = () => {
    timer.current = null;
    if (!queue.current.length) return;
    if (queue.current.length > 5) queue.current = queue.current.slice(-3);
    const next = queue.current.shift();
    setNow(next);
    // A line may say how long it deserves (the game's own hold, so the server and the board agree); otherwise by its length.
    const chars = next.text.length + (next.why ? next.why.length * 0.6 : 0);
    const read = next.ms || Math.min(4400, Math.max(1700, 900 + 38 * chars));
    const hurry = queue.current.length >= 3 ? 0.4 : queue.current.length >= 1 ? 0.7 : 1;
    timer.current = setTimeout(() => step.current(), read * pace.current * hurry);
  };
  useLogFeed(G, (e) => {
    const line = fn.current(e);
    if (!line) return;
    queue.current.push(line);
    if (!timer.current) step.current();
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return now;
}

/**
 * When the state last changed, on this device's clock, or null for the state
 * the board was opened with (how long THAT has been waiting is not known).
 * The server's timers for a pause restart on every state change, so a
 * countdown that starts here ends when the server's does, give or take the
 * time the update took to arrive.
 */
export function useChangedAt(G) {
  const first = useRef(G);
  const [at, setAt] = useState(null);
  useEffect(() => { if (G !== first.current) { first.current = null; setAt(Date.now()); } }, [G]);
  return at;
}
