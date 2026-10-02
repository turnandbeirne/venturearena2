// Me: your card as others see it, your profile, your record, your points.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { PlayerCard, BioBlock, PersonaBlock, Loading, useAction, useToast } from '../components/ui.jsx';
import InvitePanel from '../components/InvitePanel.jsx';
import { IdentityFields, BusinessFields, WantFields, ContactFields, CardSort, draftFrom, draftToArgs } from '../components/ProfileFields.jsx';
import { Record } from './Profile.jsx';
import { ARCHETYPES, POINT_LABELS, SURVEY_PARTS, timeAgo } from '../../shared/profile.js';

// Shrink a photo in the browser so the server stores a few kilobytes.
function shrink(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('That file is not an image we can read.'));
    img.src = URL.createObjectURL(file);
  });
}

export default function Me() {
  const { user, setUser, logout, register } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(() => draftFrom(user));
  const [section, setSection] = useState(null);
  const [record, setRecord] = useState(null);
  const [points, setPoints] = useState(null);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const { error, busy, run } = useAction();
  const fileRef = useRef(null);

  useEffect(() => { rpc('profile', {}).then(setRecord).catch(() => {}); rpc('pointsHistory').then(setPoints).catch(() => {}); }, [user.points, user.stats.games]);
  const set = (patch) => setD((x) => ({ ...x, ...patch }));
  const save = () => run(async () => { const r = await rpc('saveProfile', draftToArgs(d)); setUser(r.user); setSection(null); toast(r.bonus ? `Saved. +${r.bonus} Arena Points` : 'Saved'); });
  const missing = SURVEY_PARTS.filter((p) => !p.done(user));
  const photo = (file) => run(async () => { if (!file) return; const dataUrl = await shrink(file); const r = await rpc('setPhoto', { dataUrl }); setUser(r.user); });
  const shareLocation = (on) => run(async () => {
    if (!on) { const r = await rpc('setLocation', { share: false }); setUser(r.user); return; }
    const pos = await new Promise((resolve) => { if (!navigator.geolocation) resolve(null); else navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 10000, maximumAge: 600000 }); });
    // Rounded to about a kilometre on this device before it is sent anywhere.
    const r = await rpc('setLocation', { share: true, lat: pos ? Math.round(pos.coords.latitude * 100) / 100 : undefined, lon: pos ? Math.round(pos.coords.longitude * 100) / 100 : undefined });
    setUser(r.user);
    if (!pos) toast('Location permission was declined. Your city still shows.');
  });

  const SECTIONS = [['identity', 'Name, avatar and colours'], ['cardsort', 'Business-savvy card sort'], ['business', 'Business profile'], ['want', 'Looking for and offering'], ['contact', 'Contact, links and conversation starters']];

  return (
    <div className="stack-lg" style={{ maxWidth: 720 }}>
      <div><div className="between"><h1>Me</h1>
        <div className="row-wrap"><Link className="btn sm" to="/membership">Membership</Link>{!user.isGuest && <button type="button" className="btn sm" onClick={async () => { await logout(); window.location.href = '/'; }}>Sign out</button>}</div></div>
        <p className={`small muted${user.isGuest ? '' : ' truncate'}`} style={{ marginTop: 4 }}>{user.isGuest ? 'Guest session. Add an email below to keep your record.' : user.email}</p></div>
      {error && <div className="error" role="alert">{error}</div>}

      <PlayerCard p={user.card} />

      {user.isGuest && (
        <form className="card pad-lg stack hot" onSubmit={(e) => { e.preventDefault(); run(async () => { await register(email, password, d.displayName); nav('/onboarding'); }); }}>
          <div><h2>Keep your progress</h2><p className="small muted">You are a guest. Add an email and password to turn this into a free account: your history, streak and points stay with you, and you get a player card, connections and matches.</p></div>
          <input className="input" maxLength={40} placeholder="Display name" value={d.displayName} onChange={(e) => set({ displayName: e.target.value })} aria-label="Display name" />
          <input className="input" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-label="Email" />
          <input className="input" type="password" required minLength={8} placeholder="Password (8 or more characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-label="Password" />
          <button className="btn gold" disabled={busy}>Create my free account</button>
        </form>
      )}

      {user.suggestedArchetype && (
        <div className="notice stack"><div>From how you have played, the arena reads you as more of a <b>{ARCHETYPES[user.suggestedArchetype].name}</b> than a {ARCHETYPES[user.archetype].name}. Your label is yours to choose.</div>
          <div className="row-wrap"><button className="btn sm gold" onClick={() => run(async () => { const r = await rpc('keepArchetype', { switch: true }); setUser(r.user); })}>Switch to {ARCHETYPES[user.suggestedArchetype].name}</button><button className="btn sm" onClick={() => run(async () => { const r = await rpc('keepArchetype', {}); setUser(r.user); })}>Keep {ARCHETYPES[user.archetype].name}</button></div></div>
      )}

      {!user.isGuest && (
        <div className="card stack">
          <div className="between"><h2>Profile</h2><span className="chip" data-profile-score={user.surveyScore}>{user.surveyScore}% complete</span></div>
          <div className="progress" role="progressbar" aria-label="Profile completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={user.surveyScore}><i style={{ width: `${user.surveyScore}%` }} /></div>
          {!user.emailVerified && <div className="small between"><span className="grow">Confirm your email to unlock introductions.</span><button type="button" className="btn sm" onClick={() => run(async () => { const r = await rpc('resendVerification'); if (r.verified) { const me = await rpc('me'); setUser(me.user); } toast('Confirmation sent'); })}>Send it again</button></div>}
          {missing.length > 0 && <p className="small muted">Still to do: {missing.map((m) => m.label).join(', ')}. Reaching 50%, 80% and 100% each pay 50 Arena Points; 70% unlocks bios and introductions.</p>}
          {SECTIONS.map(([id, label]) => (
            <div key={id} className="stack">
              <button type="button" className="choice between" style={{ display: 'flex', flexWrap: 'nowrap' }} aria-expanded={section === id} onClick={() => { setSection(section === id ? null : id); setD(draftFrom(user)); }}><b>{label}</b><span aria-hidden="true">{section === id ? '−' : '+'}</span></button>
              {section === id && id === 'identity' && <><div className="row-wrap"><button type="button" className="btn sm" disabled={busy} onClick={() => fileRef.current && fileRef.current.click()}>{user.photo ? 'Change photo' : 'Upload a photo'}</button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Photo file" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; photo(f); }} />{user.photo && <button type="button" className="btn sm" onClick={() => run(async () => { const r = await rpc('setPhoto', { remove: true }); setUser(r.user); })}>Use an avatar instead</button>}</div><IdentityFields d={d} set={set} /></>}
              {section === id && id === 'cardsort' && <CardSort busy={busy} onDone={(picks, archetype) => run(async () => { const r = await rpc('cardSort', { picks, archetype }); setUser(r.user); setSection(null); toast(r.bonus ? `Saved. +${r.bonus} Arena Points` : 'Saved'); })} />}
              {section === id && id === 'business' && <><BusinessFields d={d} set={set} /><label className="stack" style={{ gap: 4 }}><span className="label" style={{ margin: 0 }}>About you</span><textarea className="input" maxLength={600} value={d.bio} onChange={(e) => set({ bio: e.target.value })} /></label></>}
              {section === id && id === 'want' && <WantFields d={d} set={set} />}
              {section === id && id === 'contact' && (
                <><ContactFields d={d} set={set} email={user.email} verified={user.emailVerified} />
                  <div className="grid two"><input className="input" maxLength={60} placeholder="City" value={d.city} onChange={(e) => set({ city: e.target.value })} aria-label="City" /><input className="input" maxLength={60} placeholder="State or country" value={d.region} onChange={(e) => set({ region: e.target.value })} aria-label="State or country" /></div>
                  <label className="check small"><input type="checkbox" checked={!!user.shareLocation} onChange={(e) => shareLocation(e.target.checked)} /> {user.shareLocation ? 'Sharing my approximate location with members who also share theirs' : 'Share my approximate location (double opt-in)'}</label>
                  <p className="tiny muted">Optional. Your city shows on your card only while sharing is on. Distance to other members appears only when both of you share, rounded to 5 km, never an exact position.</p></>
              )}
              {section === id && id !== 'cardsort' && <button className="btn gold" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
            </div>
          ))}
        </div>
      )}
      {user.isGuest && <div className="card stack"><h2>Your name at the table</h2><IdentityFields d={d} set={set} /><button className="btn gold" disabled={busy} onClick={save}>Save</button></div>}

      <BioBlock p={user.card} />
      <PersonaBlock card={user.card} />
      {record ? <Record data={record} /> : <Loading what="Loading your record" />}

      {!user.isGuest && <InvitePanel showHistory />}

      {points && points.rows.length > 0 && (
        <div className="card stack"><div className="between"><h2>Arena Points</h2><span className="chip">{points.balance}</span></div>
          <div className="stack" style={{ gap: 4 }}>{points.rows.map((p) => <div key={p.id} className="row small"><span className="good" style={{ width: 44 }}>+{p.points}</span><span className="grow">{POINT_LABELS[p.kind] || p.kind}</span><span className="tiny muted">{timeAgo(p.at)}</span></div>)}</div></div>
      )}
    </div>
  );
}
