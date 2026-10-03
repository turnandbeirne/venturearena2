// Time, said two ways: a running clock ("4:12", "1:02:07") and a span of time
// someone has put in ("12 min", "3 h 20 min"). Shared by the table clock, the
// game history and the time-invested totals, so the same span never reads
// differently in two places.

/** A running clock: m:ss under an hour, h:mm:ss after, days for a slow game. */
export function clockTime(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const two = (n) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${two(m)}:${two(s % 60)}`;
  return `${m}:${two(s % 60)}`;
}

/** The same span for a screen reader: "4 minutes 12 seconds". */
export function clockWords(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  const part = (n, w) => (n ? `${n} ${w}${n === 1 ? '' : 's'}` : '');
  return [part(h, 'hour'), part(m, 'minute'), h ? '' : part(sec, 'second')].filter(Boolean).join(' ') || '0 seconds';
}

/** Time put in: "under a minute", "12 min", "3 h 20 min", "52 h". */
export function spanText(ms) {
  const min = Math.round((Number(ms) || 0) / 60000);
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h >= 48) return `${h} h`;
  return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
}
