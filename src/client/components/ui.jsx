// Small shared pieces: avatars, badges, the flippable player card, the
// play-style radar, toasts.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ARCHETYPES, describeDna, repBand, colorHex, STYLE_DIMS, STYLE_LABELS, PERSONAS, STAGES, INTENTS, OFFERS, SOCIAL_KEYS } from '../../shared/profile.js';
import { TIER_INFO } from '../../shared/tiers.js';

export function Avatar({ p, size = 40, ring = null, dot = false }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.52), boxShadow: ring ? `0 0 0 3px ${ring}` : undefined };
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {p && p.photo ? <img src={p.photo} alt="" /> : <span>{(p && p.avatar) || '\u{1F642}'}</span>}
      {dot && <span className="dot" />}
    </span>
  );
}

export function ArchBadge({ archetype, size = 28 }) {
  const a = ARCHETYPES[archetype];
  return (
    <span className="arch" title={a ? a.name : 'Not sorted yet'} style={{ width: size, height: size, fontSize: Math.round(size * 0.55), background: a ? a.color : 'rgba(255,255,255,.12)' }}>
      {a ? a.glyph : '?'}
    </span>
  );
}

export function RepShield({ score = 100 }) {
  const band = repBand(score);
  // A dot, not a left border: on a pill a one-sided border draws as a crescent.
  return <span className="chip" title={`Reputation ${score}: ${band.label}. It moves on finished games, kudos and vouches, never on losing.`}><span className="pip" style={{ background: band.color }} aria-hidden="true" /><span aria-hidden="true">{'★'}</span><span className="sr-only">Reputation</span> {score}</span>;
}

export function TierBadge({ tier }) {
  if (!tier || tier === 'free' || tier === 'anonymous') return null;
  return <span className="chip tier">{TIER_INFO[tier].name}</span>;
}

export const stageLabel = (id) => (STAGES.find((s) => s.id === id) || { name: '' }).name;
export const intentLabel = (id) => (INTENTS.find((s) => s.id === id) || { name: id }).name;
export const offerLabel = (id) => (OFFERS.find((s) => s.id === id) || { name: id }).name;

/** A one-line person, linking to their profile. */
export function PersonRow({ p, sub, right, to }) {
  if (!p) return null;
  const a = ARCHETYPES[p.archetype];
  const inner = (
    <>
      <Avatar p={p} size={40} dot={p.online} ring={p.colorRanks && p.colorRanks[0] ? colorHex(p.colorRanks[0]) : null} />
      <div className="grow">
        <div className="truncate" style={{ fontWeight: 650 }}>{p.displayName} <TierBadge tier={p.tier} /></div>
        <div className="tiny muted truncate">{sub || `${a ? a.name : p.isGuest ? 'Guest' : 'Member'}${p.stage ? ` · ${stageLabel(p.stage)}` : ''}${p.personaLabel ? ` · plays like a ${p.personaLabel}` : ''}`}</div>
      </div>
    </>
  );
  return (
    <div className="card row" style={{ padding: 10 }}>
      {p.isBot ? <div className="row grow">{inner}</div> : <Link to={to || `/p/${p.username}`} className="row grow" style={{ color: 'inherit', textDecoration: 'none' }}>{inner}</Link>}
      {right}
    </div>
  );
}

export function PlayerCard({ p, flip = true }) {
  const [back, setBack] = useState(false);
  if (!p) return null;
  const a = ARCHETYPES[p.archetype];
  const chips = Object.entries(p.chips || {}).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 3);
  const dna = p.dna && Object.keys(p.dna).length ? describeDna(p.dna) : null;
  const ring = p.colorRanks && p.colorRanks[0] ? colorHex(p.colorRanks[0]) : null;
  return (
    <div className="card pad-lg pcard" style={{ cursor: flip ? 'pointer' : 'default' }} onClick={() => flip && setBack((b) => !b)}
      {...(flip ? { role: 'button', tabIndex: 0, 'aria-pressed': back, 'aria-label': `${p.displayName}'s player card, ${back ? 'back' : 'front'}. Press to flip.`, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBack((b) => !b); } } } : {})}>
      {!back ? (
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
            <Avatar p={p} size={64} ring={ring} dot={p.online} />
            <div className="grow">
              <h2 className="clamp2">{p.displayName}</h2>
              <div className="small muted">{a ? `${a.name} · ${a.tagline}` : 'Not sorted yet'}{p.stage ? ` · ${stageLabel(p.stage)}` : ''}</div>
              <div className="row-wrap" style={{ marginTop: 6 }}>
                <ArchBadge archetype={p.archetype} size={24} /><TierBadge tier={p.tier} /><RepShield score={p.reputation} />
                {p.mentor && <span className="chip">Mentor</span>}{p.investor && <span className="chip">Investor</span>}{p.vouches > 0 && <span className="chip">Vouched {'×'}{p.vouches}</span>}
              </div>
            </div>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div className="stat" title="1,200 is where everyone starts."><b>{p.rating}</b><span>Rating</span></div>
            <div className="stat"><b>{p.games}</b><span>Games</span></div>
            <div className="stat" title="Given by the people you played with."><b>{p.kudos}</b><span>Kudos</span></div>
          </div>
          {chips.length > 0 && (
            <div><div className="eyebrow">How others see them</div><div className="row-wrap" style={{ marginTop: 4 }}>{chips.map(([c, n]) => <span key={c} className="chip" style={{ textTransform: 'capitalize' }}>{c} {'×'}{n}</span>)}</div></div>
          )}
          {p.headline && <p style={{ fontWeight: 600 }}>{p.headline}</p>}
          {a && !p.headline && <p className="small muted">{a.blurb}</p>}
          {flip && <div className="tiny muted">Tap to flip</div>}
        </div>
      ) : (
        <div className="stack">
          <div><div className="eyebrow">Looking for</div><div className="row-wrap" style={{ marginTop: 4 }}>{(p.intent || []).length ? p.intent.map((i) => <span key={i} className="chip">{intentLabel(i)}</span>) : <span className="small muted">Not set yet</span>}</div></div>
          {(p.offers || []).length > 0 && <div><div className="eyebrow">Can offer</div><div className="row-wrap" style={{ marginTop: 4 }}>{p.offers.map((i) => <span key={i} className="chip">{offerLabel(i)}</span>)}</div></div>}
          {dna && <div className="small"><div>{dna.risk}</div><div>{dna.pace}</div><div>{dna.collab}</div></div>}
          {p.playStyle && <div className="small"><span className="muted">How the arena sees them:</span> {p.playStyle}</div>}
          {(p.interests || []).length > 0 && <div className="row-wrap">{p.interests.map((i) => <span key={i} className="chip">{i}</span>)}</div>}
          {(p.prompts || []).filter((x) => x.a).map((x) => <div key={x.q} className="small"><span className="muted">{x.q}</span> <b>{x.a}</b></div>)}
          {p.locked && <div className="tiny muted">Bio, goals and links show to members with a verified email and a finished profile.</div>}
          <div className="tiny muted">Tap to flip back</div>
        </div>
      )}
    </div>
  );
}

/** Bio block for a profile page (only fields the viewer may see are present). */
export function BioBlock({ p }) {
  if (!p || p.locked) return null;
  const links = SOCIAL_KEYS.filter((k) => p.socialLinks && p.socialLinks[k.id]);
  if (!p.currentProject && !p.goals && !p.lookingFor && !p.bio && !links.length && !(p.skills || []).length && !p.city) return null;
  return (
    <div className="card stack">
      {p.bio && <p>{p.bio}</p>}
      {p.currentProject && <p><b>Building:</b> {p.currentProject}</p>}
      {p.goals && <p><b>Goals:</b> {p.goals}</p>}
      {p.lookingFor && <p className="muted">Looking for: {p.lookingFor}</p>}
      {(p.skills || []).length > 0 && <div className="row-wrap">{p.skills.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
      {p.city && <p className="small muted">{p.city}{p.region ? `, ${p.region}` : ''}</p>}
      {links.length > 0 && <div className="row-wrap">{links.map((k) => <a key={k.id} className="chip" href={p.socialLinks[k.id]} target="_blank" rel="noopener noreferrer nofollow">{k.label} {'↗'}</a>)}</div>}
    </div>
  );
}

/** Six-axis play-style radar. Fixed 0-100 scale so two radars compare. */
export function StyleRadar({ persona, color = '#e8b64a', size = 220 }) {
  const c = size / 2; const R = c - 34;
  const val = (d) => (persona && typeof persona[d] === 'number' ? persona[d] : 50);
  const pt = (i, r) => { const ang = -Math.PI / 2 + (i * Math.PI * 2) / 6; return [c + Math.cos(ang) * r, c + Math.sin(ang) * r]; };
  const poly = (r) => STYLE_DIMS.map((_, i) => pt(i, r).map((n) => n.toFixed(1)).join(',')).join(' ');
  const data = STYLE_DIMS.map((d, i) => pt(i, (val(d) / 100) * R).map((n) => n.toFixed(1)).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }} role="img" aria-label={`Play style: ${STYLE_DIMS.map((d) => `${STYLE_LABELS[d]} ${val(d)}`).join(', ')}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => <polygon key={f} points={poly(R * f)} fill="none" stroke="currentColor" opacity="0.14" />)}
      {STYLE_DIMS.map((d, i) => { const [x, y] = pt(i, R); return <line key={d} x1={c} y1={c} x2={x} y2={y} stroke="currentColor" opacity="0.14" />; })}
      <polygon points={data} fill={color} fillOpacity="0.28" stroke={color} strokeWidth="2" />
      {STYLE_DIMS.map((d, i) => { const [x, y] = pt(i, (val(d) / 100) * R); return <circle key={d} cx={x} cy={y} r="3" fill={color} />; })}
      {STYLE_DIMS.map((d, i) => { const [x, y] = pt(i, R * 1.22); return <text key={d} x={x} y={y} fontSize="11" fill="currentColor" opacity="0.8" textAnchor="middle" dominantBaseline="middle">{STYLE_LABELS[d]}</text>; })}
    </svg>
  );
}

export function PersonaBlock({ card }) {
  const p = card.persona;
  const label = card.personaLabel || 'Explorer';
  return (
    <div className="card stack">
      <div><div className="eyebrow">Play style</div><h2>{label}</h2>
        <p className="small muted">{p ? `${PERSONAS[label]} Based on ${p.games} game${p.games === 1 ? '' : 's'}.` : card.personaLabel ? PERSONAS[label] : 'Play a game and the six style dimensions start filling in.'}</p></div>
      {p ? <div className="center"><StyleRadar persona={p} color={card.colorRanks && card.colorRanks[0] ? colorHex(card.colorRanks[0]) : '#e8b64a'} /></div>
        : card.personaLabel ? <p className="tiny muted">The full radar is part of play-style profiles for Subscribers.</p> : null}
    </div>
  );
}

export function Confetti() {
  const colors = ['#e8b64a', '#2fb7a6', '#a37cf0', '#5fc27a', '#f06c6c', '#ffffff'];
  return (
    <div aria-hidden="true" style={{ pointerEvents: 'none', position: 'fixed', inset: 0, zIndex: 70, overflow: 'hidden' }}>
      {Array.from({ length: 48 }, (_, i) => (
        <span key={i} className="confetti" style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 12) * 0.15}s`, animationDuration: `${2.6 + (i % 5) * 0.4}s` }} />
      ))}
    </div>
  );
}

// ---- toasts -------------------------------------------------------------------------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((text) => {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  return <ToastCtx.Provider value={show}>{children}{toast && <div className="toast pop" role="status">{toast}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Run an async action, surfacing a failure as an inline error. */
export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    setError(''); setBusy(true);
    try { return await fn(); } catch (e) { setError(e.message || 'Something went wrong'); return undefined; } finally { setBusy(false); }
  }, []);
  return { error, setError, busy, run };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The bottom sheet every dialog uses (chat, how to play, challenge, feedback).
 * Escape and a tap outside close it, Tab stays inside it, and focus goes back
 * to whatever opened it.
 */
export function Drawer({ title, onClose, children, panelStyle }) {
  const panel = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const opener = document.activeElement;
    const el = panel.current;
    if (el) el.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !el.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="drawer" onClick={onClose}>
      <div className="drawer__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panel} onClick={(e) => e.stopPropagation()} style={panelStyle}>
        <div className="between" style={{ flexWrap: 'nowrap' }}><h2 id={titleId} className="grow">{title}</h2><button type="button" className="btn sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function Loading({ what = 'Loading' }) { return <div className="muted" role="status" style={{ padding: 24 }}>{what}{'…'}</div>; }
