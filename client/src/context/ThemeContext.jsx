import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ThemeCtx = createContext(null);
export const useTheme = () => useContext(ThemeCtx);

const resolve = (pref) => (pref === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : pref);

export function ThemeProvider({ children }) {
  const [pref, setPref] = useState(() => { try { return localStorage.getItem('spendiq_theme') || 'system'; } catch { return 'system'; } });
  useEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = resolve(pref); };
    apply();
    try { localStorage.setItem('spendiq_theme', pref); } catch { /* ignore */ }
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
  const toggle = useCallback(() => setPref((p) => (resolve(p) === 'dark' ? 'light' : 'dark')), []);
  const value = useMemo(() => ({ pref, setPref, toggle, resolved: resolve(pref) }), [pref, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}