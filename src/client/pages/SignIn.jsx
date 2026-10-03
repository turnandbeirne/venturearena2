import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { BirthDateField, rememberTooYoung, tooYoungHere, TOO_YOUNG_TEXT } from '../components/AgeFields.jsx';

export default function SignIn() {
  const { login, register, user } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [mode, setMode] = useState(params.get('mode') === 'create' ? 'create' : 'signin');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(tooYoungHere);
  const next = params.get('next');
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'create') { await register(email, password, name, birthDate); nav('/onboarding', { replace: true }); }
      else { const u = await login(email, password); nav(dest || (u.onboardedAt ? '/play' : '/onboarding'), { replace: true }); }
    } catch (e2) { rememberTooYoung(e2); setBlocked(tooYoungHere()); setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <div className="main" style={{ maxWidth: 440, paddingTop: 28 }}>
      <form className="card pad-lg stack" onSubmit={submit}>
        <Link to="/" className="brand">Venture<b>Arena</b><small>by VentureMaker{'™'}</small></Link>
        <h1>{mode === 'create' ? 'Create your free account' : 'Sign in'}</h1>
        {mode === 'create' && <p className="small muted">{user && user.isGuest ? 'Your games, rating and points so far come with you.' : 'Keep your record, get a player card, and meet the people you play with.'}</p>}
        {err && !(mode === 'create' && blocked) && <div className="error" role="alert">{err}</div>}
        {mode === 'create' && blocked && <div className="notice" role="alert">{TOO_YOUNG_TEXT}</div>}
        {mode === 'create' && <div><label className="label" htmlFor="si-name">Display name</label><input id="si-name" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" /></div>}
        <div><label className="label" htmlFor="si-email">Email</label><input id="si-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
        <div><label className="label" htmlFor="si-pass">Password{mode === 'create' ? ' (8 or more characters)' : ''}</label><input id="si-pass" className="input" type="password" required minLength={mode === 'create' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} /></div>
        {mode === 'create' && <BirthDateField value={birthDate} onChange={setBirthDate} idPrefix="si-dob" />}
        <button className="btn gold block" disabled={busy || (mode === 'create' && (blocked || !birthDate))}>{busy ? 'One moment…' : mode === 'create' ? 'Create account' : 'Sign in'}</button>
        <button type="button" className="linkbtn small" onClick={() => { setMode(mode === 'create' ? 'signin' : 'create'); setErr(''); }}>{mode === 'create' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
        {mode === 'signin' && <Link to="/reset" className="small">Forgot your password?</Link>}
        <Link to="/enter?go=guest" className="small">Or just play as a guest</Link>
      </form>
    </div>
  );
}
