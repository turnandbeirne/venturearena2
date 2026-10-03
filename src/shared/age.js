// Ages. VentureArena accounts are for people aged 13 and over; under-18s get
// a few extra protections (server/arena/users.js, social.js).
//
// A date of birth is asked for ONCE and is never stored. What is kept is the
// least that the rules need: that the age was checked, and, for an under-18
// only, the day they turn 18 (so the protections end by themselves).

export const MIN_AGE = 13;
export const ADULT_AGE = 18;

/** 'YYYY-MM-DD' -> { y, m, d } for a real calendar day that is not in the future, or null. */
export function parseBirthDate(value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Date.UTC rolls 31 February over into March: a day that does not exist is refused.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  if (t > now) return null;
  return { y, m: mo, d };
}

/** Whole years lived on the UTC day of `now`. */
export function ageOn(birth, now = Date.now()) {
  const n = new Date(now);
  let age = n.getUTCFullYear() - birth.y;
  if (n.getUTCMonth() + 1 < birth.m || (n.getUTCMonth() + 1 === birth.m && n.getUTCDate() < birth.d)) age -= 1;
  return age;
}

/** The start (UTC) of the day someone born on `birth` turns 18. A 29 February birthday counts from 1 March. */
export function adultFrom(birth) {
  return Date.UTC(birth.y + ADULT_AGE, birth.m - 1, birth.d);
}
