// The signed-in shell: five tabs within thumb reach on a phone, a side rail
// on a wide screen. Anyone without a session is sent to the front door and
// brought back to where they were going.
import { useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { rpc } from '../api.js';
import { useEvent } from '../realtime.js';
import { Loading, useToast } from './ui.jsx';
import FeedbackButton from './FeedbackButton.jsx';
import { AgeGate } from './AgeFields.jsx';
import { useChat, ChatLauncher, ChatWindow } from './ChatDock.jsx';
import { TIER_INFO } from '../../shared/tiers.js';

const ICONS = {
  home: <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  play: <path d="M6 4l14 8-14 8z" />,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-4 3-6 7-6s7 2 7 6" /><circle cx="17.5" cy="9" r="2.5" /><path d="M16 14c3 0 6 1.5 6 5" /></>,
  inbox: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  me: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7" /></>,
};
const TABS = [['home', 'Home', '/home'], ['play', 'Play', '/play'], ['people', 'People', '/people'], ['inbox', 'Inbox', '/inbox'], ['me', 'Me', '/me']];

export default function Layout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!user) nav(`/enter?next=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
  }, [user, loading, nav, loc.pathname, loc.search]);

  const count = useCallback(() => {
    if (!user) return;
    rpc('inbox').then((r) => setUnread(r.requests.length + r.introsIn.length + r.challenges.filter((c) => c.incoming && c.status === 'pending').length)).catch(() => {});
  }, [user && user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { count(); }, [count, loc.pathname]);
  useEvent('inbox', (p) => { count(); if (p && p.kind === 'challenge' && !loc.pathname.startsWith('/inbox')) toast('You have a new challenge'); });
  useEvent('yourTurn', (p) => { if (!loc.pathname.startsWith(`/t/${p.tableId}`)) toast('It is your move at one of your tables'); });

  if (loading || !user) return <Loading what="Entering the arena" />;
  return <Shell user={user} unread={unread} />;
}

// Split from Layout so the chat's hooks only run once there is a member.
function Shell({ user, unread }) {
  const loc = useLocation();
  const chat = useChat(user);
  const inGame = loc.pathname.startsWith('/t/');
  const tierName = TIER_INFO[user.access.tier] ? TIER_INFO[user.access.tier].name : 'Guest';

  return (
    <div className="app">
      <header className="brandbar">
        <Link to="/home" className="brand">Venture<b>Arena</b><small>by VentureMaker{'™'}</small></Link>
        <div className="row" style={{ gap: 8 }}>
          {!inGame && <FeedbackButton />}
          <Link to="/membership" className="chip" aria-label={`Membership: ${tierName}`}>{tierName}</Link>
          <ChatLauncher chat={chat} variant="bar" />
        </div>
      </header>
      <main className="main"><Outlet /></main>
      <ChatLauncher chat={chat} variant="dock" />
      <ChatWindow chat={chat} />
      {user.needsAge && <AgeGate />}
      <nav className="tabbar" aria-label="Main">
        <Link to="/home" className="brand rail-brand">Venture<b>Arena</b><small>by VentureMaker{'™'}</small></Link>
        {TABS.map(([key, label, to]) => (
          <NavLink key={key} to={to} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[key]}</svg>
            <span>{label}</span>
            {key === 'inbox' && unread > 0 && <span className="badge">{unread}</span>}
          </NavLink>
        ))}
        <div className="rail-foot">
          <Link to="/membership" className="chip" style={{ justifyContent: 'center' }}>{tierName}</Link>
          {!inGame && <FeedbackButton className="btn sm block" />}
        </div>
      </nav>
    </div>
  );
}
