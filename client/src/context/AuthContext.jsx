// Topic 45/40: session state. The JWT lives in an httpOnly cookie (JavaScript cannot read it), so the app only keeps the user profile.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onUnauthorized } from '../api/client.js';
import { makeMoney } from '../utils/format.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api.get('/auth/me').then((r) => alive && setUser(r.data.user)).catch(() => {}).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  const login = useCallback(async (email, password) => { const r = await api.post('/auth/login', { email, password }); setUser(r.data.user); }, []);
  const register = useCallback(async (payload) => { const r = await api.post('/auth/register', payload); setUser(r.data.user); }, []);
  const logout = useCallback(async () => { try { await api.post('/auth/logout'); } finally { setUser(null); } }, []);
  const updateProfile = useCallback(async (patch) => { const r = await api.put('/auth/me', patch); setUser(r.data.user); return r.data.user; }, []);

  const money = useMemo(() => makeMoney(user?.currency), [user?.currency]);
  const value = useMemo(() => ({ user, loading, login, register, logout, updateProfile, money, setUser }), [user, loading, login, register, logout, updateProfile, money]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
