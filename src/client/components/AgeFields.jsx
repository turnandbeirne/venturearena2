// Date of birth: asked once when an account is made, used to check the age,
// and not kept (shared/age.js). Three menus, not a calendar: nobody wants to
// page a date picker back forty years.
import { useState } from 'react';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAction } from './ui.jsx';
import { MIN_AGE } from '../../shared/age.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const BLOCK_KEY = 'va.age';
const BLOCK_MS = 24 * 3600 * 1000;

/**
 * Someone who was told they are too young should not be able to simply pick
 * another year and try again on the same device. Remembered for a day.
 */
export function tooYoungHere() {
  try { const at = Number(localStorage.getItem(BLOCK_KEY) || 0); return at > 0 && Date.now() - at < BLOCK_MS; } catch { return false; }
}
export function rememberTooYoung(error) {
  if (!error || error.status !== 403 || !/aged \d+ and over/.test(error.message || '')) return;
  try { localStorage.setItem(BLOCK_KEY, String(Date.now())); } catch { /* private mode: nothing to remember */ }
}
export const TOO_YOUNG_TEXT = `VentureArena accounts are for people aged ${MIN_AGE} and over. You can still play as a guest.`;

/** value / onChange carry 'YYYY-MM-DD', or '' until all three parts are chosen. */
export function BirthDateField({ value, onChange, idPrefix = 'dob' }) {
  const [parts, setParts] = useState(() => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || ''); return m ? { y: m[1], m: m[2], d: m[3] } : { y: '', m: '', d: '' }; });
  const set = (patch) => {
    const next = { ...parts, ...patch };
    setParts(next);
    onChange(next.y && next.m && next.d ? `${next.y}-${next.m}-${next.d}` : '');
  };
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => String(thisYear - i));
  const pad = (n) => String(n).padStart(2, '0');
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="label" style={{ padding: 0 }}>Date of birth</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 0.9fr) minmax(0, 1.1fr)', gap: 8 }}>
        <select id={`${idPrefix}-m`} className="input" required aria-label="Month of birth" value={parts.m} onChange={(e) => set({ m: e.target.value })} autoComplete="bday-month">
          <option value="">Month</option>{MONTHS.map((name, i) => <option key={name} value={pad(i + 1)}>{name}</option>)}
        </select>
        <select id={`${idPrefix}-d`} className="input" required aria-label="Day of birth" value={parts.d} onChange={(e) => set({ d: e.target.value })} autoComplete="bday-day">
          <option value="">Day</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={pad(i + 1)}>{i + 1}</option>)}
        </select>
        <select id={`${idPrefix}-y`} className="input" required aria-label="Year of birth" value={parts.y} onChange={(e) => set({ y: e.target.value })} autoComplete="bday-year">
          <option value="">Year</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <p className="tiny muted" style={{ marginTop: 4 }}>Used once to check your age. We do not keep it.</p>
    </fieldset>
  );
}

/**
 * For an account made before the age step existed: asked once, before
 * anything else. It cannot be dismissed, because the rules that protect
 * under-18s depend on the answer.
 */
export function AgeGate() {
  const { setUser, logout } = useAuth();
  const [birthDate, setBirthDate] = useState('');
  const { error, busy, run } = useAction();
  const [closed, setClosed] = useState('');
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      try { const r = await rpc('confirmAge', { birthDate }); setUser(r.user); } catch (err) {
        if (err.status === 403) { rememberTooYoung(err); setClosed(err.message); return; }
        throw err;
      }
    });
  };
  return (
    <div className="drawer" style={{ alignItems: 'center', padding: 14 }}>
      <form className="drawer__panel" role="dialog" aria-modal="true" aria-labelledby="age-title" onSubmit={submit} style={{ borderRadius: 18, maxWidth: 440 }}>
        <h2 id="age-title">One quick question</h2>
        {closed ? (
          <>
            <div className="error" role="alert">{closed}</div>
            <button type="button" className="btn gold" onClick={() => { window.location.href = '/'; }}>Close</button>
          </>
        ) : (
          <>
            <p className="small muted">VentureArena now asks every member for a date of birth, once. It decides which community features are open to you, and it is not stored.</p>
            {error && <div className="error" role="alert">{error}</div>}
            <BirthDateField value={birthDate} onChange={setBirthDate} idPrefix="gate-dob" />
            <button className="btn gold" disabled={busy || !birthDate}>{busy ? 'One moment…' : 'Continue'}</button>
            <button type="button" className="linkbtn small" onClick={async () => { await logout(); window.location.href = '/'; }}>Sign out instead</button>
          </>
        )}
      </form>
    </div>
  );
}
