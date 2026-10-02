// Table settings for VentureBoom, shown in the table room before the game
// starts. The host picks the length and the variants; everyone else sees a
// one-line summary.
import { useState } from 'react';
import { normalizeSettings } from './rules.js';

const LENGTHS = [
  { rounds: 12, name: 'Full game', note: '12 quarters' },
  { rounds: 4, name: 'Fiscal Year', note: '4 quarters' },
];
const BOT_LEVELS = [[1, 'Rookie'], [2, 'Sharp'], [3, 'Shark']];

/** "Fiscal Year (4 quarters), Hot Market on": used for the summary line and the chat note. */
export function describeSettings(s) {
  const st = normalizeSettings(s);
  const len = LENGTHS.find((l) => l.rounds === st.rounds) || { name: `${st.rounds} quarter${st.rounds === 1 ? '' : 's'}`, note: '' };
  const parts = [len.note ? `${len.name} (${len.note})` : len.name];
  parts.push(`Hot Market ${st.hotMarket ? 'on' : 'off'}`);
  if (st.kids) parts.push("Kids' edition");
  return parts.join(', ');
}

export default function Settings({ settings, isHost, locked, onChange }) {
  // The form owns its draft until the save lands: a background refresh of the
  // table must not snap a chip back while the request is in flight.
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const st = normalizeSettings({ ...(settings || {}), ...(draft || {}) });

  if (!isHost || locked) {
    return <div className="card small"><span className="muted">Game settings:</span> {describeSettings(st)}</div>;
  }

  const change = async (patch, note) => {
    const next = normalizeSettings({ ...(settings || {}), ...(draft || {}), ...patch });
    setDraft({ ...(draft || {}), ...patch });
    setBusy(true);
    try { await onChange(next, note || `Settings: ${describeSettings(next)}`); } catch { /* the table room reports the error */ }
    setBusy(false);
    setDraft(null);
  };
  const toggle = (key, label, hint) => (
    <label className="row small" style={{ minHeight: 44 }}>
      <input type="checkbox" checked={!!st[key]} disabled={busy} onChange={(e) => change({ [key]: e.target.checked })} style={{ width: 22, height: 22, flex: 'none' }} />
      <span><b>{label}</b> <span className="muted">{hint}</span></span>
    </label>
  );

  return (
    <div className="card stack">
      <div className="eyebrow">VentureBoom{'™'} settings</div>
      <div>
        <span className="label">Length</span>
        <div className="row-wrap">
          {LENGTHS.map((l) => (
            <button key={l.rounds} type="button" className={`chip${st.rounds === l.rounds ? ' on' : ''}`} style={{ minHeight: 40 }} disabled={busy} onClick={() => change({ rounds: l.rounds })}>{l.name} ({l.note})</button>
          ))}
        </div>
      </div>
      {toggle('hotMarket', 'Hot Market', 'Exit values double in the last three quarters.')}
      {toggle('kids', "Kids' edition", 'No Hostile Takeover cards, and a bankrupt player keeps their hand.')}
      {st.fillBots !== false && (
        <div>
          <span className="label">Bot skill</span>
          <div className="row-wrap">
            {BOT_LEVELS.map(([lv, name]) => (
              <button key={lv} type="button" className={`chip${Number(st.botLevel || 2) === lv ? ' on' : ''}`} style={{ minHeight: 40 }} disabled={busy} onClick={() => change({ botLevel: lv }, `Settings: bot skill ${name}`)}>{name}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
