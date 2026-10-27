import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useAsync } from '../hooks/index.js';
import { Panel, TextField, SelectField } from '../components/ui/index.jsx';
import { ArrowRightLeft } from 'lucide-react';
import { CURRENCIES, makeMoney } from '../utils/format.js';

export default function Converter() {
  const { user } = useAuth();
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState(user.currency);
  const [amount, setAmount] = useState('1');
  const { data, error, loading } = useAsync(() => api.get('/currency/rates', { base: from }), [from]);
  const rate = data?.rates?.[to];
  const result = rate != null && amount !== '' ? Number(amount) * rate : null;
  return (
    <Panel title="Currency converter" subtitle="Live exchange rates (cached for 10 minutes).">
      <div className="form-grid">
        <TextField label="Amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <div className="row" style={{ alignItems: 'flex-end' }}><SelectField label="From" value={from} onChange={(e) => setFrom(e.target.value)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} /><button className="icon-btn" aria-label="Swap currencies" onClick={() => { setFrom(to); setTo(from); }}><ArrowRightLeft size={18} /></button><SelectField label="To" value={to} onChange={(e) => setTo(e.target.value)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></div>
      </div>
      <p style={{ marginTop: 14 }}>{error ? <span className="neg">{error.message}</span> : loading ? <span className="muted">Fetching rate…</span> : result != null ? <><strong style={{ fontSize: '1.3rem' }}>{makeMoney(to)(result, { decimals: 2 })}</strong> <span className="muted small">at 1 {from} = {rate.toFixed(4)} {to}{data.stale ? ' (last known rate)' : ''}</span></> : '—'}</p>
    </Panel>
  );
}