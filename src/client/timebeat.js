// "Still here": while a page of the member's own work is open and in use, tell
// the server every half minute so the time counts toward their total
// (arena/time.js credits the gap between beats on its own clock).
//
// A beat is only sent when the tab is visible AND the member has done
// something (typed, tapped, scrolled) in the last two minutes. A tab left
// open on a desk earns nothing.
import { useEffect } from 'react';
import { rpc } from './api.js';

const BEAT_MS = 30000;
const IDLE_MS = 120000;

export function useTimeBeat(kind, ref, enabled = true) {
  useEffect(() => {
    if (!enabled || !kind || !ref) return undefined;
    let last = Date.now();
    const seen = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'scroll'];
    for (const e of events) window.addEventListener(e, seen, { passive: true, capture: true });
    const beat = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last > IDLE_MS) return;
      rpc('timeBeat', { kind, ref }).catch(() => {});
    };
    beat();
    const t = setInterval(beat, BEAT_MS);
    return () => { clearInterval(t); for (const e of events) window.removeEventListener(e, seen, { capture: true }); };
  }, [kind, ref, enabled]);
}
