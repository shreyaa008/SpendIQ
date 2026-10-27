// Categories and payment modes are needed by many screens; load once per session and refresh after edits.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const MetaCtx = createContext(null);
export const useMeta = () => useContext(MetaCtx);

export function MetaProvider({ children }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [paymentModes, setPaymentModes] = useState([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [c, p] = await Promise.all([api.get('/categories'), api.get('/payment-modes')]);
    setCategories(c.data);
    setPaymentModes(p.data);
    setReady(true);
  }, []);

  useEffect(() => {
    if (user) refresh().catch(() => setReady(true));
    else { setCategories([]); setPaymentModes([]); setReady(false); }
  }, [user, refresh]);

  const value = useMemo(() => ({ categories, paymentModes, ready, refresh }), [categories, paymentModes, ready, refresh]);
  return <MetaCtx.Provider value={value}>{children}</MetaCtx.Provider>;
}