import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Enter from './pages/Enter.jsx';
import Home from './pages/Home.jsx';
import Lobby from './pages/Lobby.jsx';
import TableRoom from './pages/TableRoom.jsx';
import Join from './pages/Join.jsx';

// Pages a guest does not need for their first move load on demand.
const Debrief = lazy(() => import('./pages/Debrief.jsx'));
const People = lazy(() => import('./pages/People.jsx'));
const Inbox = lazy(() => import('./pages/Inbox.jsx'));
const Me = lazy(() => import('./pages/Me.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Membership = lazy(() => import('./pages/Membership.jsx'));
const History = lazy(() => import('./pages/History.jsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'));
const SignIn = lazy(() => import('./pages/SignIn.jsx'));
const Verify = lazy(() => import('./pages/Verify.jsx'));
const Reset = lazy(() => import('./pages/Reset.jsx'));

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Enter landing />} />
        <Route path="/enter" element={<Enter />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/join/:code/watch" element={<Join watch />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<Layout />}>
          <Route path="/home" element={<Home />} />
          <Route path="/play" element={<Lobby />} />
          <Route path="/t/:id" element={<TableRoom />} />
          <Route path="/debrief/:id" element={<Debrief />} />
          <Route path="/people" element={<People />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/inbox/:userId" element={<Inbox />} />
          <Route path="/me" element={<Me />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:id" element={<History />} />
          <Route path="/p/:username" element={<Profile />} />
          <Route path="/membership" element={<Membership />} />
        </Route>
        <Route path="*" element={<Navigate to="/play" replace />} />
      </Routes>
    </Suspense>
  );
}
