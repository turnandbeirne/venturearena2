import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';

export default function Verify() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [state, setState] = useState('working');
  const [err, setErr] = useState('');
  useEffect(() => {
    rpc('verifyEmail', { token: params.get('token') }).then(() => { setState('done'); refresh().catch(() => {}); }).catch((e) => { setErr(e.message); setState('error'); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="main" style={{ maxWidth: 440, paddingTop: 40 }}>
      <div className="card pad-lg stack">
        <h1>{state === 'done' ? 'Email confirmed' : state === 'error' ? 'That link did not work' : 'Confirming…'}</h1>
        {state === 'done' && <p>Your record is safe and introductions unlock once your profile is complete.</p>}
        {state === 'error' && <p className="error" role="alert">{err}</p>}
        <Link className="btn gold" to="/play">Go to the arena</Link>
      </div>
    </div>
  );
}
