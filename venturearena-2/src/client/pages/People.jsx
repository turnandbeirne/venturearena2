// People: matches by what you are looking for, the Mixer (one person at a
// time, with the reason), the opportunities board, and everyone.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Loading, PersonRow, PlayerCard, useAction } from '../components/ui.jsx';
import { AccessNotice } from './Home.jsx';
import ChallengeButton from '../components/ChallengeButton.jsx';
import { timeAgo } from '../../shared/profile.js';

const SEGMENTS = [
  { id: 'playmate', label: 'Play with', cta: 'Connect', empty: 'Play a few games and finish your profile; matches appear as the arena learns you.' },
  { id: 'peer', label: 'Peers', cta: 'Connect', empty: 'Add "Peers at my stage" to what you are looking for on the Me tab.' },
  { id: 'mentor', label: 'Learn from', cta: 'Ask for an intro', intro: 'mentor', empty: 'No mentor matches yet. Add "A mentor" to what you are looking for; mentors opt in and cap how many people they take.' },
  { id: 'cofounder', label: 'Cofounders', cta: 'Ask for an intro', intro: 'cofounder', empty: 'Cofounder matches need both of you to be looking, with strengths that are not the same.' },
  { id: 'venture', label: 'Founders to back', cta: 'Ask for an intro', intro: 'investor', empty: 'Shown to members who offer capital or incubation. Founders are told only when you ask for an introduction.' },
  { id: 'talent', label: 'Roles and talent', cta: 'Connect', empty: 'Matches people offering roles with people looking for one. Set either on the Me tab.' },
];
const TABS = [['matches', 'Matches'], ['board', 'Opportunities'], ['everyone', 'Everyone']];

export default function People() {
  const { user, allows, tier } = useAuth();
  const [tab, setTab] = useState('matches');
  const [seg, setSeg] = useState('playmate');
  const [recs, setRecs] = useState(null);
  const [mix, setMix] = useState(null);
  const [everyone, setEveryone] = useState(null);
  const [mates, setMates] = useState([]);
  const [q, setQ] = useState('');
  const [sent, setSent] = useState({});
  const { error, busy, run } = useAction();

  useEffect(() => { rpc('recommendations').then(setRecs).catch(() => {}); rpc('tablemates').then((r) => setMates(r.members)).catch(() => {}); }, [tier, user.access.level]);
  useEffect(() => { if (tab !== 'everyone') return undefined; const t = setTimeout(() => rpc('people', { q }).then((r) => setEveryone(r.members)).catch(() => {}), 250); return () => clearTimeout(t); }, [tab, q]);

  const segment = SEGMENTS.find((s) => s.id === seg);
  const firstMove = (card, s, reason) => run(async () => {
    if (s.intro) { await rpc('requestIntro', { userId: card.id, kind: s.intro, reason }); setSent((x) => ({ ...x, [card.id]: 'Intro requested' })); }
    else { await rpc('connect', { userId: card.id, source: 'recommendation' }); setSent((x) => ({ ...x, [card.id]: 'Request sent' })); }
  });
  const mixer = (mode) => run(async () => { const r = await rpc('mixer', { mode }); setMix(r.pick || false); });

  const list = recs ? recs.by[seg] || [] : [];
  const lockedBy = recs && recs.locked[seg];

  return (
    <div className="stack-lg">
      <div><h1>People</h1><p className="small muted">Aspiring founders, mentors, investors and operators, matched on how you play, where you are and what you said you are looking for.</p></div>
      <AccessNotice />
      {error && <div className="error" role="alert">{error}</div>}
      <div className="row-wrap" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`chip${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</div>

      {tab === 'matches' && (
        <>
          <div className="card stack">
            <div><h2>Mixer</h2><p className="tiny muted">One person at a time, with the reason. Matched when the arena knows you; random from recently active members when it does not. Never the same person twice in a day.</p></div>
            <div className="row-wrap">
              <button className="btn gold sm" disabled={busy} onClick={() => mixer('any')}>{mix ? 'Next person' : 'Introduce me to someone'}</button>
              <button className="btn sm" disabled={busy} onClick={() => mixer('peer')}>A peer</button>
              <button className="btn sm" disabled={busy || !allows('mentor_match')} onClick={() => mixer('mentor')}>A mentor</button>
              <button className="btn sm" disabled={busy || !allows('cofounder_match')} onClick={() => mixer('cofounder')}>A cofounder</button>
            </div>
            {mix === false && <p className="small muted">Nobody new to introduce right now. Check back after a few more people have played.</p>}
            {mix && (
              <div className="grid two">
                <PlayerCard p={mix.card} flip={false} />
                <div className="stack small">
                  <p><span className="muted">Why:</span> {mix.reason}</p>
                  {mix.card.playStyle && <p><span className="muted">How the arena sees them:</span> {mix.card.playStyle}</p>}
                  <div className="row-wrap">
                    {!user.isGuest && <button className="btn gold sm" disabled={!!sent[mix.card.id] || mix.state !== 'none'} onClick={() => firstMove(mix.card, SEGMENTS.find((s) => s.id === mix.type) || SEGMENTS[0], mix.reason)}>{sent[mix.card.id] || (mix.state === 'connected' ? 'Connected' : mix.state === 'requested' ? 'Requested' : (SEGMENTS.find((s) => s.id === mix.type) || SEGMENTS[0]).cta)}</button>}
                    <ChallengeButton card={mix.card} />
                    <Link className="btn sm" to={`/p/${mix.card.username}`}>See profile</Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="row-wrap" role="group" aria-label="Kind of match">{SEGMENTS.map((s) => <button key={s.id} type="button" aria-pressed={seg === s.id} data-segment={s.id} className={`chip${seg === s.id ? ' on' : ''}`} onClick={() => setSeg(s.id)}>{s.label}{recs && recs.locked[s.id] ? <span aria-label="locked"> {'\u{1F512}'}</span> : null}</button>)}</div>
          {lockedBy ? (
            <div className="card center stack" data-locked={lockedBy}><h2>{segment.label} matches are a {lockedBy === 'investor_match' ? 'VIP' : 'Subscriber'} feature</h2><p className="small muted">Mentor, cofounder and investor matches only happen when both sides opted in.</p><div><Link to="/membership" className="btn gold">See memberships</Link></div></div>
          ) : recs && recs.profileLocked && seg !== 'playmate' && seg !== 'peer' ? (
            <div className="card center stack"><p>Introductions unlock once your email is verified and your profile is complete ({user.access.surveyScore}% so far).</p><div><Link to="/me" className="btn gold">Finish your profile</Link></div></div>
          ) : list.length === 0 ? (
            <div className="card center small muted" data-empty-segment={seg}>{recs ? segment.empty : 'Finding your matches…'}</div>
          ) : (
            <div className="grid two">
              {list.map((r) => (
                <div key={r.userId} className="stack" style={{ gap: 6 }}>
                  <PersonRow p={r.card} right={!user.isGuest && <button className="btn gold sm" disabled={!!sent[r.userId] || r.state !== 'none'} onClick={() => firstMove(r.card, segment, r.reason)}>{sent[r.userId] || (r.state === 'connected' ? 'Connected' : r.state === 'requested' ? 'Requested' : segment.cta)}</button>} />
                  <div className="small muted" style={{ padding: '0 4px' }}>{r.reason}{r.distanceKm !== null ? ` · ~${r.distanceKm} km away` : ''}</div>
                  {r.reasons.length > 0 && <div className="row-wrap" style={{ padding: '0 4px' }}>{r.reasons.slice(0, 3).map((x) => <span key={x} className="chip">{x}</span>)}</div>}
                </div>
              ))}
            </div>
          )}

          {mates.length > 0 && (
            <section className="stack"><h2>Played with you</h2>
              <div className="grid two">{mates.map((m) => <PersonRow key={m.card.id} p={m.card} sub={`${m.games} game${m.games === 1 ? '' : 's'} together, last ${timeAgo(m.last)}`} right={<ChallengeButton card={m.card} />} />)}</div>
            </section>
          )}
        </>
      )}

      {tab === 'board' && <Board />}

      {tab === 'everyone' && (
        <section className="stack">
          <input className="input" placeholder="Search: operator, revenue, SaaS, mentoring…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
          {everyone && everyone.length === 0 && <div className="card small muted">Nobody matches that yet.</div>}
          <div className="grid two">{(everyone || []).map((c) => <PersonRow key={c.id} p={c} right={<ChallengeButton card={c} />} />)}</div>
        </section>
      )}
    </div>
  );
}

// Both sides of the community in one list: asks and offers.
function Board() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('');
  const [form, setForm] = useState(null);
  const { error, busy, run } = useAction();
  const load = useCallback(() => rpc('opportunities', { kind }).then(setData).catch(() => {}), [kind]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Loading what="Opening the board" />;
  const post = () => run(async () => { await rpc('postOpportunity', form); setForm(null); load(); });

  return (
    <section className="stack">
      <div className="card stack">
        <div><h2>Opportunities</h2><p className="small muted">Looking for a cofounder, a mentor, a role or first customers? Offering a role, incubation, capital or a real business challenge for a team to tackle? Post it. A response arrives as an introduction you accept or decline.</p></div>
        {!form ? <div><button className="btn gold sm" disabled={user.isGuest} onClick={() => setForm({ kind: 'seeking_cofounder', title: '', body: '' })}>{user.isGuest ? 'Create an account to post' : 'Post something'}</button></div> : (
          <div className="stack">
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Kind of post">{data.kinds.map((k) => <option key={k.id} value={k.id} disabled={!k.canPost}>{k.label}{k.canPost ? '' : k.feature === 'post_venture_call' ? ' (VIP)' : ' (Subscriber)'}</option>)}</select>
            <input className="input" maxLength={100} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" />
            <textarea className="input" maxLength={1200} placeholder="What you need or offer, who it suits, and what a good first conversation looks like." value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} aria-label="Details" />
            {error && <div className="error" role="alert">{error}</div>}
            <div className="row-wrap"><button className="btn gold sm" disabled={busy} onClick={post}>Post</button><button className="btn sm" onClick={() => setForm(null)}>Cancel</button></div>
          </div>
        )}
      </div>
      <div className="row-wrap" role="group" aria-label="Filter posts"><button type="button" aria-pressed={kind === ''} className={`chip${kind === '' ? ' on' : ''}`} onClick={() => setKind('')}>All</button>{data.kinds.map((k) => <button key={k.id} type="button" aria-pressed={kind === k.id} className={`chip${kind === k.id ? ' on' : ''}`} onClick={() => setKind(k.id)}>{k.label.split(':')[0]}</button>)}</div>
      {!form && error && <div className="error" role="alert">{error}</div>}
      {data.items.length === 0 && <div className="card small muted center">Nothing posted here yet. Be the first.</div>}
      {data.items.map((o) => (
        <div key={o.id} className="card stack" data-opportunity={o.id}>
          <div className="between"><span className="chip">{o.kindLabel}</span><span className="tiny muted">{timeAgo(o.at)}</span></div>
          <h3>{o.title}</h3><p className="small" style={{ whiteSpace: 'pre-wrap' }}>{o.body}</p>
          <div className="between"><Link to={`/p/${o.by.username}`} className="small">{o.by.displayName}</Link>
            {o.mine ? <span className="row-wrap"><span className="small muted">{o.responses} response{o.responses === 1 ? '' : 's'}</span><button className="btn sm" onClick={() => run(async () => { await rpc('closeOpportunity', { id: o.id }); load(); })}>Close</button></span>
              : <button className="btn gold sm" disabled={o.responded || busy} onClick={() => run(async () => { await rpc('respondOpportunity', { id: o.id, note: '' }); load(); })}>{o.responded ? 'Intro requested' : 'I am interested'}</button>}</div>
        </div>
      ))}
    </section>
  );
}
