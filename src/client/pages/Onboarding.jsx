// The registration interview, five short steps. Everything is optional and
// can be skipped; each answer improves matching and earns Arena Points.
// Guests never see this: nobody fills in a form before their first game.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PlayerCard, useAction } from '../components/ui.jsx';
import { IdentityFields, BusinessFields, WantFields, ContactFields, CardSort, draftFrom, draftToArgs } from '../components/ProfileFields.jsx';

const STEPS = ['You at the table', 'How you think', 'Your business', 'What you want here', 'How to reach you'];

export default function Onboarding() {
  const { user, loading, setUser } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [d, setD] = useState(null);
  const [earned, setEarned] = useState(0);
  const { error, busy, run } = useAction();

  useEffect(() => { if (!loading && !user) nav('/signin?mode=create', { replace: true }); }, [loading, user, nav]);
  useEffect(() => { if (user && !d) setD(draftFrom(user)); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Next" sits at the bottom of a step; the next step must start at its top.
  useEffect(() => { window.scrollTo(0, 0); }, [step]);
  if (!user || !d) return null;
  if (user.isGuest) return <div className="main" style={{ maxWidth: 480, paddingTop: 40 }}><div className="card pad-lg stack"><h1>Create your free account first</h1><p className="muted">The profile interview is for registered members. Your guest games come with you.</p><Link className="btn gold" to="/signin?mode=create">Create account</Link><Link to="/play" className="small">Keep playing as a guest</Link></div></div>;

  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const save = () => run(async () => { const r = await rpc('saveProfile', draftToArgs(d)); setUser(r.user); setEarned((n) => n + (r.bonus || 0)); return r; });
  const finish = () => run(async () => { await rpc('saveProfile', draftToArgs(d)); const r = await rpc('finishOnboarding'); setUser(r.user); const next = sessionStorage.getItem('va.after'); sessionStorage.removeItem('va.after'); nav(next || '/home', { replace: true }); });
  const next = async () => { const r = await save(); if (r) setStep((s) => s + 1); };
  const last = step === STEPS.length - 1;

  return (
    <div className="main stack-lg" style={{ maxWidth: 640, paddingTop: 20 }}>
      <div className="between"><div className="brand">VentureArena</div><button type="button" className="linkbtn small" onClick={finish}>Skip for now</button></div>
      <div className="stack" style={{ gap: 6 }}><div className="eyebrow">Step {step + 1} of {STEPS.length} {'·'} {STEPS[step]}</div><div className="progress"><i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div></div>
      {earned > 0 && <div className="notice">+{earned} Arena Points earned so far for filling in your profile.</div>}
      {error && <div className="error" role="alert">{error}</div>}

      {step === 0 && <div className="card pad-lg stack"><h2>How you show up at the table</h2><IdentityFields d={d} set={set} /></div>}
      {step === 1 && (
        <div className="card pad-lg stack">
          {user.archetype && !d.redo ? (
            <div className="stack"><h2>Your card</h2><PlayerCard p={user.card} flip={false} /><button className="linkbtn small" onClick={() => set({ redo: true })}>Sort the cards again</button></div>
          ) : (
            <CardSort busy={busy} onDone={(picks, archetype) => run(async () => { const r = await rpc('cardSort', { picks, archetype }); setUser(r.user); setEarned((n) => n + (r.bonus || 0)); set({ redo: false }); })} />
          )}
        </div>
      )}
      {step === 2 && <div className="card pad-lg stack"><div><h2>Your business</h2><p className="small muted">This is what we match on. Each answer is worth points.</p></div><BusinessFields d={d} set={set} /></div>}
      {step === 3 && <div className="card pad-lg stack"><h2>What you want from the arena</h2><WantFields d={d} set={set} /></div>}
      {step === 4 && <div className="card pad-lg stack"><h2>How to reach you</h2><ContactFields d={d} set={set} email={user.email} verified={user.emailVerified} /></div>}

      <div className="row-wrap">
        {step > 0 && <button className="btn" onClick={() => setStep((s) => s - 1)}>Back</button>}
        <button className="btn gold grow" disabled={busy} onClick={last ? finish : next}>{busy ? 'Saving…' : last ? 'Enter the arena' : 'Next'}</button>
      </div>
    </div>
  );
}
