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
