// Topic 45/48: reusable custom hooks built on useState / useEffect.
import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs an async loader and exposes { data, meta, loading, error, reload }. Ignores out-of-date responses. */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, loading: true, error: null });
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await loader();
      if (id === seq.current) setState({ data: res.data, meta: res.meta ?? null, loading: false, error: null });
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function useDebounce(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** useState that persists NON-sensitive UI preferences in localStorage. */
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw == null ? initial : JSON.parse(raw); } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }, [key, value]);
  return [value, setValue];
}

export function useDocumentTitle(title) {
  useEffect(() => { document.title = title ? `${title} · SpendIQ AI` : 'SpendIQ AI'; }, [title]);
}

/** Closes something on Escape (modals, drawers). */
export function useEscape(handler, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const fn = (e) => { if (e.key === 'Escape') handler(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [handler, active]);
}