// Forgotten password, both halves on one address:
//   /reset               ask for a link
//   /reset?token=...     choose the new password
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { disconnectRealtime } from '../realtime.js';

export default function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null); // null | { mail: boolean }

  const ask = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { setSent(await rpc('requestPasswordReset', { email })); } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  const choose = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      const r = await rpc('resetPassword', { token, password });
      // The server ended every old session: the live connection belongs to one of them.
      disconnectRealtime(); setUser(r.user);
      nav(r.user.onboardedAt ? '/play' : '/onboarding', { replace: true });
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  return (
    <div className="main" style={{ maxWidth: 440, paddingTop: 28 }}>
      {token ? (
        <form className="card pad-lg stack" onSubmit={choose}>
          <Link to="/" className="brand">Venture<b>Arena</b><small>by VentureMaker{'™'}</small></Link>
          <h1>Choose a new password</h1>
          {err && <div className="error" role="alert">{err}</div>}
          <div><label className="label" htmlFor="rs-pass">New password (8 or more characters)</label><input id="rs-pass" className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
          <button className="btn gold block" disabled={busy}>{busy ? 'One moment…' : 'Save and sign in'}</button>
          <Link to="/reset" className="small">Ask for a new link</Link>
        </form>
      ) : sent ? (
        <div className="card pad-lg stack">
          <Link to="/" className="brand">Venture<b>Arena</b><small>by VentureMaker{'™'}</small></Link>
          <h1>{sent.mail ? 'Check your email' : 'Email is not set up here yet'}</h1>
          {sent.mail
            ? <p>If there is an account for <strong>{email}</strong>, a link to choose a new password is on its way. It works once, for one hour.</p>
            : <p>This site cannot send email yet, so it cannot send you a reset link. Write to the VentureArena team and they will send you one.</p>}
          <Link className="btn" to="/signin">Back to sign in</Link>
        </div>
      ) : (
        <form className="card pad-lg stack" onSubmit={ask}>
          <Link to="/" className="brand">Venture<b>Arena</b><small>by VentureMaker{'™'}</small></Link>
          <h1>Forgot your password?</h1>
          <p className="small muted">Enter the email you signed up with and we will send you a link to choose a new one.</p>
          {err && <div className="error" role="alert">{err}</div>}
          <div><label className="label" htmlFor="rs-email">Email</label><input id="rs-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></div>
          <button className="btn gold block" disabled={busy}>{busy ? 'One moment…' : 'Send the link'}</button>
          <Link to="/signin" className="small">Back to sign in</Link>
        </form>
      )}
    </div>
  );
}
