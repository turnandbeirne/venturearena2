import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { rpc } from './api.js';
import { connectRealtime, disconnectRealtime, useEvent } from './realtime.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { user: u } = await rpc('me');
    setUser(u);
    return u;
  }, []);

  useEffect(() => { refresh().catch(() => {}).finally(() => setLoading(false)); }, [refresh]);
  useEffect(() => { if (user) connectRealtime(); }, [user && user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Presence: a light heartbeat while the tab is open and visible.
  useEffect(() => {
    if (!user) return undefined;
    const beat = () => { if (document.visibilityState === 'visible') rpc('heartbeat').catch(() => {}); };
    const t = setInterval(beat, 60000);
    window.addEventListener('focus', beat);
    return () => { clearInterval(t); window.removeEventListener('focus', beat); };
  }, [user && user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo(() => {
    const access = user ? user.access : null;
    return {
      user, loading, refresh, setUser,
      tier: access ? access.tier : 'anonymous',
      access,
      allows: (feature) => !!(access && access.features[feature]),
      enterAsGuest: async () => { if (user) return user; const r = await rpc('guest', { ref: localStorage.getItem('va.ref') || undefined }); setUser(r.user); return r.user; },
      register: async (email, password, displayName, birthDate) => {
        const ref = localStorage.getItem('va.ref') || undefined;
        const r = await rpc('register', { email, password, displayName, birthDate, ref });
        localStorage.removeItem('va.ref');
        setUser(r.user); return r.user;
      },
      login: async (email, password) => { const r = await rpc('login', { email, password }); disconnectRealtime(); setUser(r.user); return r.user; },
      logout: async () => { await rpc('logout'); disconnectRealtime(); setUser(null); },
    };
  }, [user, loading, refresh]);

  return <AuthCtx.Provider value={value}><MeWatcher refresh={refresh} enabled={!!user} />{children}</AuthCtx.Provider>;
}

// The server says "me" when something about this member changed elsewhere
// (a plan started, an admin changed a tier).
function MeWatcher({ refresh, enabled }) {
  if (!enabled) return null;
  return <MeListener refresh={refresh} />;
}
function MeListener({ refresh }) { useEvent('me', () => { refresh().catch(() => {}); }); return null; }

export const useAuth = () => useContext(AuthCtx);
