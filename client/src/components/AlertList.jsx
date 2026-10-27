import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

export default function AlertList({ alerts, onChange, compact }) {
  const toast = useToast();
  const dismiss = async (key) => {
    try { await api.post('/insights/dismiss', { key }); onChange?.(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      {alerts.map((a) => (
        <div className="alert-item" key={a.key}>
          <span className={`sev sev-${a.severity}`} aria-label={a.severity} />
          <div>
            <div style={{ fontWeight: 600 }}>{a.title}</div>
            <div className="muted small">{a.message}</div>
            {!compact && a.action && <Link className="small" to={a.action.to}>{a.action.label} →</Link>}
          </div>
          <button className="icon-btn" aria-label={`Dismiss: ${a.title}`} onClick={() => dismiss(a.key)}><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}