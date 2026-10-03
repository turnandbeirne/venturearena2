// The profile form, in sections, shared by the onboarding wizard and the Me
// tab. Each section edits a plain draft object; the caller saves it.
//
// A form owns its draft until the save lands. (An earlier build reset forms
// from props on every background re-render and lost edits mid-typing.)
import { useState } from 'react';
import {
  ARCHETYPES, AVATARS, COLORS, STAGES, INTENTS, OFFERS, INTEREST_TAGS, PROMPTS, SCENARIOS, SOCIAL_KEYS, scoreCardSort, describeDna, isGuestName,
} from '../../shared/profile.js';

export function draftFrom(u) {
  return {
    displayName: isGuestName(u.displayName) ? '' : u.displayName || '', avatar: u.avatar, colorRanks: u.colorRanks || [],
    headline: u.headline || '', stage: u.stage || '', industry: u.industry || '', currentProject: u.currentProject || '', skills: (u.skills || []).join(', '), interests: u.interests || [], bio: u.bio || '',
    intent: u.intent || [], offers: u.offers || [], goals: u.goals || '', lookingFor: u.lookingFor || '', openToMentoring: u.openToMentoring || 0,
    phone: u.phone || '', socialLinks: { ...(u.socialLinks || {}) }, city: u.city || '', region: u.region || '',
    prompts: [0, 1].map((i) => (u.prompts && u.prompts[i]) || { q: PROMPTS[i], a: '' }),
  };
}
const toggle = (list, v, max = 99) => (list.includes(v) ? list.filter((x) => x !== v) : list.length < max ? [...list, v] : list);

function Field({ label, children, hint }) {
  return <label className="stack" style={{ gap: 4 }}><span className="label" style={{ margin: 0 }}>{label}</span>{children}{hint && <span className="tiny muted">{hint}</span>}</label>;
}

export function ColorPicker({ value, onChange }) {
  const pick = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : value.length < 3 ? [...value, id] : value);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div role="group" aria-labelledby="pf-colours" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
        {COLORS.map((c) => { const rank = value.indexOf(c.id); return (
          <button key={c.id} type="button" onClick={() => pick(c.id)} aria-label={`${c.name}${rank >= 0 ? `, choice ${rank + 1}` : ''}`} aria-pressed={rank >= 0}
            style={{ height: 44, padding: 0, borderRadius: 10, border: rank >= 0 ? '3px solid var(--ink)' : '1px solid var(--rule)', background: c.hex, cursor: 'pointer', color: '#111', fontWeight: 800 }}>
            {rank >= 0 && <span style={{ background: '#fff', borderRadius: '50%', padding: '1px 7px' }}>{rank + 1}</span>}
          </button>); })}
      </div>
      <span className="tiny muted">{value.length ? `Your colours: ${value.map((id, i) => `${i + 1}. ${COLORS.find((c) => c.id === id).name}`).join('  ')}` : 'Pick up to three in order. If your first choice is taken at a table, you get your second.'}</span>
    </div>
  );
}

export function IdentityFields({ d, set }) {
  return (
    <div className="stack">
      <Field label="Display name"><input className="input" maxLength={40} placeholder="What should people call you?" value={d.displayName} onChange={(e) => set({ displayName: e.target.value })} /></Field>
      <div><span className="label" id="pf-avatar">Avatar</span><div role="group" aria-labelledby="pf-avatar" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
        {AVATARS.map((a, i) => <button key={a} type="button" aria-label={`Avatar ${i + 1}: ${a}`} aria-pressed={d.avatar === a} onClick={() => set({ avatar: a })} style={{ height: 44, fontSize: 22, padding: 0, borderRadius: 10, border: d.avatar === a ? '2px solid var(--accent)' : '1px solid var(--rule)', background: d.avatar === a ? 'var(--accent-wash)' : 'var(--surface)', cursor: 'pointer' }}>{a}</button>)}
      </div></div>
      <div><span className="label" id="pf-colours">Your colours at the table (first choice, then fallbacks)</span><ColorPicker value={d.colorRanks} onChange={(v) => set({ colorRanks: v })} /></div>
    </div>
  );
}

export function BusinessFields({ d, set }) {
  return (
    <div className="stack">
      <Field label="One line about you"><input className="input" maxLength={120} placeholder="e.g. Second-time founder, B2B payments" value={d.headline} onChange={(e) => set({ headline: e.target.value })} /></Field>
      <div><span className="label">Where are you right now?</span><div className="stack" style={{ gap: 6 }}>{STAGES.map((s) => <button key={s.id} type="button" aria-pressed={d.stage === s.id} className={`choice${d.stage === s.id ? ' on' : ''}`} style={{ padding: 10 }} onClick={() => set({ stage: d.stage === s.id ? '' : s.id })}><b>{s.name}</b> <span className="small muted">{s.hint}</span></button>)}</div></div>
      <Field label="Industry"><input className="input" maxLength={60} placeholder="e.g. fintech, consumer, health" value={d.industry} onChange={(e) => set({ industry: e.target.value })} /></Field>
      <div><span className="label">Interests (pick a few)</span><div className="row-wrap">{INTEREST_TAGS.map((t) => <button key={t} type="button" aria-pressed={d.interests.includes(t)} className={`chip${d.interests.includes(t) ? ' on' : ''}`} onClick={() => set({ interests: toggle(d.interests, t, 8) })}>{t}</button>)}</div></div>
      <Field label="What you are building right now"><input className="input" maxLength={200} placeholder="Project or company, in a sentence" value={d.currentProject} onChange={(e) => set({ currentProject: e.target.value })} /></Field>
      <Field label="Skills you bring (comma separated)"><input className="input" maxLength={200} placeholder="e.g. sales, product, fundraising" value={d.skills} onChange={(e) => set({ skills: e.target.value })} /></Field>
    </div>
  );
}

export function WantFields({ d, set }) {
  return (
    <div className="stack">
      <div><span className="label">Right now I am looking for (up to four)</span><div className="stack" style={{ gap: 6 }}>{INTENTS.map((i) => <button key={i.id} type="button" aria-pressed={d.intent.includes(i.id)} className={`choice${d.intent.includes(i.id) ? ' on' : ''}`} style={{ padding: 10 }} onClick={() => set({ intent: toggle(d.intent, i.id, 4) })}><b>{i.name}</b> <span className="small muted">{i.hint}</span></button>)}</div></div>
      <div><span className="label">And I can offer</span><div className="stack" style={{ gap: 6 }}>{OFFERS.map((i) => <button key={i.id} type="button" aria-pressed={d.offers.includes(i.id)} className={`choice${d.offers.includes(i.id) ? ' on' : ''}`} style={{ padding: 10 }} onClick={() => set({ offers: toggle(d.offers, i.id), ...(i.id === 'mentoring' && !d.offers.includes('mentoring') && !d.openToMentoring ? { openToMentoring: 2 } : {}) })}><b>{i.name}</b> <span className="small muted">{i.hint}</span></button>)}</div>
        <span className="tiny muted">Nobody is matched into something they did not ask for. Mentor, cofounder and investor matches need both sides to opt in.</span></div>
      {d.offers.includes('mentoring') && <Field label="How many people will you mentor this quarter?"><select className="input" value={d.openToMentoring} onChange={(e) => set({ openToMentoring: Number(e.target.value) })}>{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>}
      <Field label="Goals"><input className="input" maxLength={300} placeholder="e.g. practice negotiating, meet investors, find a cofounder" value={d.goals} onChange={(e) => set({ goals: e.target.value })} /></Field>
      <Field label="Who you are looking for, in your words"><input className="input" maxLength={160} placeholder="e.g. a technical cofounder, a mentor who has sold a company" value={d.lookingFor} onChange={(e) => set({ lookingFor: e.target.value })} /></Field>
    </div>
  );
}

export function ContactFields({ d, set, email, verified }) {
  return (
    <div className="stack">
      {email && <p className="small">Your email <b>{email}</b> is on file{verified ? ' and verified' : '; confirm it from your inbox to keep your record'}.</p>}
      <Field label="Mobile number (optional)" hint="Never shown to other members. Contact details earn no points."><input className="input" type="tel" maxLength={30} placeholder="+1 555 010 2233" value={d.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
      {SOCIAL_KEYS.map((k) => <Field key={k.id} label={k.label}><input className="input" maxLength={200} placeholder={k.placeholder} value={d.socialLinks[k.id] || ''} onChange={(e) => set({ socialLinks: { ...d.socialLinks, [k.id]: e.target.value } })} /></Field>)}
      <div><span className="label">Two conversation starters (shown on the back of your card)</span>
        {d.prompts.map((p, i) => <Field key={i} label={p.q}><input className="input" maxLength={140} value={p.a} onChange={(e) => set({ prompts: d.prompts.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} /></Field>)}</div>
    </div>
  );
}

/** Turn a draft into what saveProfile expects. */
export function draftToArgs(d) {
  return { ...d, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/**
 * The business-savvy card sort: eight scenarios, three answers each, about
 * three minutes. `onDone(picks, archetype)` is called with the answers and
 * the archetype the member chose to keep.
 */
export function CardSort({ onDone, busy }) {
  const [picks, setPicks] = useState([]);
  const [chosen, setChosen] = useState(null);
  const n = SCENARIOS.length;
  if (picks.length < n) {
    const s = SCENARIOS[picks.length];
    return (
      <div className="stack pop" key={picks.length}>
        <div className="between"><div className="eyebrow">Scenario {picks.length + 1} of {n}</div>{picks.length > 0 && <button type="button" className="linkbtn small" onClick={() => setPicks((p) => p.slice(0, -1))}>Previous scenario</button>}</div>
        <h2>{s.prompt}</h2>
        <div className="stack" style={{ gap: 8 }}>{s.answers.map((a, i) => <button key={a.text} type="button" className="choice" onClick={() => setPicks((p) => [...p, i])}>{a.text}</button>)}</div>
        <p className="tiny muted">No right answers. This is how the arena learns what kind of entrepreneur you are and who would complement you.</p>
      </div>
    );
  }
  const r = scoreCardSort(picks);
  const arch = chosen || r.archetype;
  const dna = describeDna(r);
  return (
    <div className="stack pop">
      <div className="center" data-archetype={arch}><div className="eyebrow">You are {/^[aeiou]/i.test(ARCHETYPES[arch].name) ? 'an' : 'a'}</div><h1 style={{ color: ARCHETYPES[arch].color }}>{ARCHETYPES[arch].name}</h1><p className="muted">{ARCHETYPES[arch].blurb}</p></div>
      <div className="card small stack" style={{ gap: 4 }}><div>{dna.risk}</div><div>{dna.pace}</div><div>{dna.collab}</div></div>
      <div><span className="label">Not quite you? You always get the final say.</span><div className="row-wrap">{Object.entries(ARCHETYPES).map(([id, a]) => <button key={id} type="button" aria-pressed={arch === id} className={`chip${arch === id ? ' on' : ''}`} onClick={() => setChosen(id)}><span aria-hidden="true">{a.glyph}</span> {a.name}</button>)}</div></div>
      <p className="tiny muted">Your play will refine this. After five games the arena may suggest a different archetype; it never changes yours for you.</p>
      <div className="row-wrap"><button type="button" className="btn gold" disabled={busy} onClick={() => onDone(picks, arch)}>{busy ? 'Saving…' : 'Keep this card'}</button><button type="button" className="btn" onClick={() => { setPicks([]); setChosen(null); }}>Start over</button></div>
    </div>
  );
}
