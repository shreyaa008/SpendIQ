import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((type, message, action) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, type, message, action }]);
    setTimeout(() => dismiss(id), action ? 7000 : 4500);
  }, [dismiss]);
  const api = useMemo(() => ({ success: (m, a) => push('success', m, a), error: (m) => push('error', m), info: (m, a) => push('info', m, a) }), [push]);
  const Icon = { success: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => {
          const I = Icon[t.type];
          return (
            <div key={t.id} className={`toast toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
              <I size={18} aria-hidden="true" />
              <span>{t.message}</span>
              {t.action && <button className="toast-action" onClick={() => { t.action.onClick(); dismiss(t.id); }}>{t.action.label}</button>}
              <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}