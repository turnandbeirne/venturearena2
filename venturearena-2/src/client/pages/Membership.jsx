// Membership. Playing and making friends is always free; paid tiers buy
// depth, introductions and status.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAction } from '../components/ui.jsx';
import { TIER_CARDS, TIER_INFO, TIER_RANK, PAID_PROGRAMS } from '../../shared/tiers.js';

export default function Membership() {
  const { user, tier, refresh } = useAuth();
  const [params] = useSearchParams();
  const [info, setInfo] = useState(null);
  const [note, setNote] = useState('');
  const { error, busy, run } = useAction();
  useEffect(() => { rpc('membership').then(setInfo).catch(() => {}); if (params.get('upgraded')) { setNote('Welcome aboard. Your plan is active as soon as the payment confirms.'); refresh().catch(() => {}); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const upgrade = (t) => run(async () => {
    const r = await rpc('checkout', { tier: t });
    if (r.url) { window.location.href = r.url; return; }
    setNote(`Noted: you are on the list for ${TIER_INFO[t].name}. Paid plans open soon; we will email you first, and your card and history carry over.`);
  });

  return (
    <div className="stack-lg">
      <div><h1>Membership</h1><p className="small muted">Playing and making friends is always free. Pay for depth, introductions and status.</p></div>
      {user.isGuest && <div className="notice">You are a guest. <Link to="/signin?mode=create">Create a free account</Link> first so a membership has somewhere to live.</div>}
      {note && <div className="notice">{note}</div>}
      {error && <div className="error" role="alert">{error}</div>}
      <div className="grid two four">
        {TIER_CARDS.map((t) => {
          const current = tier === t.id || (t.id === 'free' && tier === 'anonymous' ? false : tier === t.id);
          return (
            <div key={t.id} className={`card pad-lg stack${current ? ' hot' : ''}`}>
              <div><div className="eyebrow">{TIER_INFO[t.id].name}</div><h2>{TIER_INFO[t.id].frame}</h2><div className="gold" style={{ fontWeight: 700 }}>{TIER_INFO[t.id].priceLabel}</div></div>
              <p className="small muted">{t.human}</p>
              <ul className="small stack grow" style={{ margin: 0, padding: 0, listStyle: 'none', gap: 6 }}>{t.perks.map((p) => <li key={p} className="row" style={{ alignItems: 'flex-start' }}><span className="gold" aria-hidden="true">{'✓'}</span><span>{p}</span></li>)}</ul>
              {t.id === 'free'
                ? (user.isGuest ? <Link className="btn gold" to="/signin?mode=create">Create free account</Link> : <button className="btn" disabled>{tier === 'free' ? 'Your plan' : 'Included'}</button>)
                : <button className={`btn${current ? '' : ' gold'}`} disabled={current || busy || user.isGuest} onClick={() => upgrade(t.id)}>{current ? 'Your plan' : info && info.billingLive ? (TIER_RANK[tier] > TIER_RANK[t.id] ? 'Switch' : 'Upgrade') : 'Join the waitlist'}</button>}
            </div>
          );
        })}
      </div>
      {info && info.billingLive && TIER_RANK[tier] >= 2 && <div><button className="btn" onClick={() => run(async () => { const r = await rpc('billingPortal'); window.location.href = r.url; })}>Manage billing</button></div>}
      <div className="card stack">
        <h2>What paid plans unlock</h2>
        <p className="small muted">Playing, your player card and connections are free. These need a paid seat:</p>
        <div className="grid two">{PAID_PROGRAMS.map((p) => { const open = TIER_RANK[tier] >= TIER_RANK[p.tier]; return <div key={p.id} className="row small"><span className={open ? 'good' : 'muted'} aria-hidden="true">{open ? '✓' : '\u{1F512}'}</span><span className="grow"><b>{p.label}</b></span><span className="chip">{TIER_INFO[p.tier].name}{p.tier !== 'ceo' ? '+' : ''}</span></div>; })}</div>
        <p className="tiny muted">Some programs open with the first member cohorts. Paid plans bill monthly and can be cancelled any time.</p>
      </div>
    </div>
  );
}
