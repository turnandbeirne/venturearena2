// VentureFlow's table settings, shown in the table room before the game
// starts. Ported from the first arena's TableSettings.tsx: three presets, a
// Customize panel (scenario, starting conditions, weather, turn clock, fill
// empty chairs, robot line-up), a one-line summary everyone can read, and
// suggestion chips for people who are not the host.
//
// Uses the arena shell's own classes (client/styles.css); it is part of the
// table room, not of the game board.
import { useEffect, useRef, useState } from 'react';
import {
  SCENARIOS, DIFFICULTIES, WEATHER, PERSONALITIES, SKILLS, PRESETS, PRESET_IDS, MAX_LINEUP, MIN_SEATS,
  normalizeSettings, describeBot, summarizeSettings,
} from './settings.js';

const SAVE_DEBOUNCE_MS = 350;
const NOTE_DEBOUNCE_MS = 5000;
const LAST_KEY = 'va_vf_last_settings';
// Only these are this form's to save. The seat count and the table room's own
// controls belong to the table room; sending them back from a draft made a
// moment earlier would undo a change the host had just made there.
const MY_KEYS = ['preset', 'scenarioId', 'difficultyId', 'weatherSeverityId', 'turnTimer', 'bots', 'fillWithRobots'];
const mine = (s) => Object.fromEntries(MY_KEYS.map((k) => [k, s[k]]));
const sameGame = (a, b) => JSON.stringify(mine(a)) === JSON.stringify(mine(b));

function rememberSettings(s) { try { localStorage.setItem(LAST_KEY, JSON.stringify(mine(s))); } catch { /* private mode */ } }
function lastSettings() { try { const raw = localStorage.getItem(LAST_KEY); return raw ? mine(normalizeSettings(JSON.parse(raw))) : null; } catch { return null; } }

function Pick({ label, options, value, onPick, disabled }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="row-wrap">
        {options.map((o) => (
          <button key={o.id} type="button" disabled={disabled} title={o.tagline || o.style || ''} aria-pressed={value === o.id}
            className={`chip${value === o.id ? ' on' : ''}`} style={disabled && value !== o.id ? { opacity: 0.55 } : undefined} onClick={() => onPick(o.id)}>
            <span aria-hidden="true">{o.icon || o.avatar}</span> {o.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings({ settings, isHost, locked, humans, maxSeats, canCustomize, onChange, onSuggest }) {
  const editable = isHost && !locked;
  const [draft, setDraft] = useState(() => normalizeSettings(settings));
  const [open, setOpen] = useState(editable); // the host lands on the full form; everyone else on the summary
  const [saving, setSaving] = useState('idle'); // idle | saving | saved | error
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState(() => (editable ? lastSettings() : null));
  const latest = useRef(draft);    // what the host clicked most recently (never stale, unlike closure state)
  const pending = useRef(0);       // saves in flight or queued: while > 0 the host's draft wins over the table's copy
  const timer = useRef(null);
  const noteTimer = useRef(null);
  const lastNote = useRef('');
  const alive = useRef(true);
  const save = useRef(onChange);
  save.current = onChange;
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); clearTimeout(noteTimer.current); }; }, []);

  // Follow the table when someone else (or the server) changes it. Keyed on
  // the CONTENT, not the object: the room re-renders on every refresh, and a
  // fresh object each time must not wipe the host's half-made edits
  // (failure-table row 5). While a save is on its way the draft wins.
  const settingsKey = JSON.stringify(settings);
  useEffect(() => {
    if (pending.current > 0) return;
    const next = normalizeSettings(settings);
    latest.current = next;
    setDraft(next);
  }, [settingsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A settings change is announced in table talk so people can react, but a
  // host clicking through the options gets one trailing note, not a flood.
  const announce = () => {
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      if (!alive.current || pending.current > 0) return;
      const note = `⚙️ ${summarizeSettings(latest.current)}`;
      if (note === lastNote.current) return;
      lastNote.current = note;
      Promise.resolve(save.current(mine(latest.current), note)).catch(() => {});
    }, NOTE_DEBOUNCE_MS);
  };

  const commit = (changed) => {
    const next = normalizeSettings({ ...latest.current, ...changed, fillBots: undefined });
    latest.current = next;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current); else pending.current += 1;
    setSaving('saving');
    timer.current = setTimeout(async () => {
      timer.current = null;
      const toSave = latest.current;
      try {
        // fillBots mirrors fillWithRobots: it is the field the arena reads at start.
        await save.current({ ...mine(toSave), fillBots: toSave.fillWithRobots });
        rememberSettings(toSave);
        if (alive.current) { setLast(mine(toSave)); setSaving('saved'); setMsg(''); setTimeout(() => { if (alive.current) setSaving((v) => (v === 'saved' ? 'idle' : v)); }, 1500); announce(); }
      } catch (e) {
        if (alive.current) { setSaving('error'); setMsg(e && e.message ? e.message : 'Could not save'); }
      } finally {
        pending.current = Math.max(0, pending.current - 1);
      }
    }, SAVE_DEBOUNCE_MS);
  };
  const patch = (p) => commit({ ...p, preset: 'custom' });
  const applyPreset = (id) => commit({ ...PRESETS[id].settings, preset: id });
  const setBot = (i, b) => patch({ bots: latest.current.bots.map((x, j) => (j === i ? { ...x, ...b } : x)) });
  const addBot = () => patch({ bots: [...latest.current.bots, { personalityId: 'random', skillLevelId: 'random' }] });
  const removeBot = (i) => patch({ bots: latest.current.bots.filter((_, j) => j !== i) });

  const chairs = Math.max(Math.min(draft.size || maxSeats, maxSeats), humans, draft.fillWithRobots ? MIN_SEATS : 0);
  const robotsAtStart = draft.fillWithRobots ? Math.max(0, chairs - humans) : 0;
  const scenario = SCENARIOS.find((s) => s.id === draft.scenarioId);
  const diff = DIFFICULTIES.find((d) => d.id === draft.difficultyId);
  const wx = WEATHER.find((w) => w.id === draft.weatherSeverityId);
  const showDetails = open || (!editable && draft.preset === 'custom');

  return (
    <div className="card stack">
      <div className="between">
        <h2>{editable ? 'Set up your game' : 'Game settings'}{locked && <span className="tiny muted"> {'·'} locked at start</span>}</h2>
        <span className="tiny muted" role="status" aria-live="polite">
          {saving === 'saving' && 'Saving…'}
          {saving === 'saved' && 'Saved · everyone sees this'}
          {saving === 'error' && <span className="bad">{msg}</span>}
          {saving === 'idle' && !isHost && !locked && 'The host sets these. Talk it over in table talk.'}
        </span>
      </div>

      {editable && (
        <div className="grid three">
          {PRESET_IDS.map((id) => (
            <button key={id} type="button" className={`choice${draft.preset === id ? ' on' : ''}`} aria-pressed={draft.preset === id} onClick={() => applyPreset(id)}>
              <div style={{ fontWeight: 700 }}>{PRESETS[id].name}</div>
              <div className="small muted">{PRESETS[id].blurb}</div>
            </button>
          ))}
        </div>
      )}

      {!editable && !locked && onSuggest && (
        <div className="row-wrap small">
          <span className="muted">Suggest to the host:</span>
          {PRESET_IDS.map((id) => <button key={id} type="button" className="chip" onClick={() => onSuggest(`How about ${PRESETS[id].name}? ${PRESETS[id].blurb}`)}>{PRESETS[id].name}</button>)}
          <button type="button" className="chip" onClick={() => onSuggest('Can we turn the turn clock off?')}>No clock</button>
          <button type="button" className="chip" onClick={() => onSuggest('Fewer robots please, let people fill the chairs.')}>Fewer robots</button>
        </div>
      )}

      {/* the one-line summary everyone can read */}
      <div className="row-wrap small" style={{ columnGap: 14 }}>
        <span>{scenario.icon} {scenario.name}</span>
        <span>{diff.icon} {diff.name}</span>
        <span>{wx.icon} {wx.name} weather</span>
        <span>{draft.turnTimer ? '⏱️ 30s turns' : '\u{1F570}️ No clock'}</span>
        <span>{'\u{1F916}'} {robotsAtStart} robot{robotsAtStart === 1 ? '' : 's'} if the table started now{draft.fillWithRobots ? '' : ' (empty chairs stay empty)'}</span>
      </div>

      {editable && (
        <div className="row-wrap">
          <button type="button" className="btn sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide details' : 'Customize'}</button>
          {last && !sameGame(last, draft) && <button type="button" className="btn sm" onClick={() => commit(last)}>Use the settings from my last table</button>}
        </div>
      )}

      {showDetails && (
        <div className="stack">
          {!canCustomize && editable && <div className="small gold">Picking the scenario, weather and individual robots is a Member feature. Presets are free.</div>}
          <Pick label={'Scenario · how you win'} options={SCENARIOS} value={draft.scenarioId} onPick={(id) => patch({ scenarioId: id })} disabled={!editable || !canCustomize} />
          <Pick label="Starting conditions" options={DIFFICULTIES} value={draft.difficultyId} onPick={(id) => patch({ difficultyId: id })} disabled={!editable} />
          <Pick label="Economic weather" options={WEATHER} value={draft.weatherSeverityId} onPick={(id) => patch({ weatherSeverityId: id })} disabled={!editable || !canCustomize} />
          <div className="stack" style={{ gap: 0 }}>
            <label className="row small" style={{ minHeight: 40 }}><input type="checkbox" checked={draft.turnTimer} disabled={!editable} onChange={(e) => patch({ turnTimer: e.target.checked })} style={{ width: 20, height: 20, flex: 'none' }} /> Turn clock (30s, with extensions)</label>
            <label className="row small" style={{ minHeight: 40 }}><input type="checkbox" checked={draft.fillWithRobots} disabled={!editable} onChange={(e) => patch({ fillWithRobots: e.target.checked })} style={{ width: 20, height: 20, flex: 'none' }} /> Fill every empty chair with a robot at start</label>
          </div>
          <div>
            <span className="label">Robot line-up {'·'} fills chairs people leave empty, in this order</span>
            <div className="small muted" style={{ marginBottom: 8 }}>
              {chairs} chair{chairs === 1 ? '' : 's'} at the table, {humans} taken by people. A person who joins always gets the chair; the robot steps aside.
              {!draft.fillWithRobots && ' With "fill every empty chair" off, no robots are seated and the line-up waits.'}
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {draft.bots.map((b, i) => {
                const d = describeBot(b);
                return (
                  <div key={i} className="card stack" style={{ padding: 10, gap: 8 }}>
                    <div className="row small">
                      <span style={{ fontSize: 20 }} aria-hidden="true">{d.avatar}</span>
                      <span className="grow"><b>{d.name}</b> <span className="muted">{'·'} {d.skillIcon} {d.skill}</span></span>
                      {editable && <button type="button" className="btn sm" onClick={() => removeBot(i)}>Remove</button>}
                    </div>
                    {editable && (
                      <>
                        <div className="row-wrap">{PERSONALITIES.map((p) => <button key={p.id} type="button" disabled={!canCustomize} title={p.style} aria-pressed={b.personalityId === p.id} className={`chip${b.personalityId === p.id ? ' on' : ''}`} onClick={() => setBot(i, { personalityId: p.id })}><span aria-hidden="true">{p.avatar}</span> {p.name}</button>)}</div>
                        <div className="row-wrap">{SKILLS.map((s) => <button key={s.id} type="button" aria-pressed={b.skillLevelId === s.id} className={`chip${b.skillLevelId === s.id ? ' on' : ''}`} onClick={() => setBot(i, { skillLevelId: s.id })}><span aria-hidden="true">{s.icon}</span> {s.name}</button>)}</div>
                      </>
                    )}
                  </div>
                );
              })}
              {editable && draft.bots.length < MAX_LINEUP && <div><button type="button" className="btn sm" onClick={addBot}>+ Add a robot to the line-up</button></div>}
              {draft.fillWithRobots && draft.bots.length < MAX_LINEUP && <div className="tiny muted">Chairs beyond the line-up get a surprise robot of any skill.</div>}
            </div>
          </div>
          <div className="tiny muted">Sound, hints and themes stay personal in the game. Robots play at one steady pace for the whole table.</div>
        </div>
      )}
    </div>
  );
}
