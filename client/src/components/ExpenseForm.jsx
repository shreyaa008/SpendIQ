// Topic 47/48: the expense form. Every input is controlled; validation runs on submit and clears as the user fixes fields.
import { useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { Button, TextField, SelectField, Banner } from './ui/index.jsx';
import { validateExpense } from '../utils/validate.js';
import { CURRENCIES, todayStr } from '../utils/format.js';

export function toFormValues(e, defaults = {}) {
  return { amount: e?.amount ?? '', description: e?.description ?? '', merchant: e?.merchant ?? '', category: e?.category?.id ?? defaults.category ?? '', paymentMode: e?.paymentMode?.id ?? defaults.paymentMode ?? '', date: e?.date ?? todayStr(), originalAmount: e?.originalAmount ?? null, originalCurrency: e?.originalCurrency ?? null };
}

export default function ExpenseForm({ initial, onSubmit, onCancel, submitLabel = 'Save expense' }) {
  const { user, money } = useAuth();
  const { categories, paymentModes } = useMeta();
  const [values, setValues] = useState(() => toFormValues(initial, { category: sessionStorage.getItem('spendiq_lastCategory') || '' }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fx, setFx] = useState({ open: false, currency: 'USD', amount: '', rates: null, error: '' });

  useEffect(() => { // default payment mode once the lists are available
    setValues((v) => ({ ...v, category: v.category || '', paymentMode: v.paymentMode || paymentModes.find((p) => p.name === 'UPI')?.id || paymentModes[0]?.id || '' }));
  }, [paymentModes]);

  const set = (k) => (e) => { setValues((v) => ({ ...v, [k]: e.target.value })); setErrors((er) => ({ ...er, [k]: undefined })); };

  // Currency conversion (kept from the original app): type an amount in another currency, we convert at today's rate.
  const loadRates = async () => {
    try { const r = await api.get('/currency/rates', { base: user.currency }); setFx((f) => ({ ...f, rates: r.data, error: '' })); }
    catch (err) { setFx((f) => ({ ...f, error: err.message })); }
  };
  useEffect(() => { if (fx.open && !fx.rates) loadRates(); /* eslint-disable-next-line */ }, [fx.open]);
  const converted = fx.rates && fx.amount !== '' && fx.rates.rates[fx.currency] ? Math.round((Number(fx.amount) / fx.rates.rates[fx.currency]) * 100) / 100 : null;
  const applyConversion = () => {
    if (converted == null || Number.isNaN(converted)) return;
    setValues((v) => ({ ...v, amount: converted, originalAmount: Number(fx.amount), originalCurrency: fx.currency }));
    setErrors((er) => ({ ...er, amount: undefined }));
    setFx((f) => ({ ...f, open: false }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validateExpense(values);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true); setFormError('');
    try {
      await onSubmit({ amount: Number(values.amount), description: values.description.trim(), merchant: values.merchant.trim(), category: values.category, paymentMode: values.paymentMode, date: values.date, originalAmount: values.originalAmount, originalCurrency: values.originalCurrency });
      sessionStorage.setItem('spendiq_lastCategory', values.category);
    } catch (err) { setFormError(err.message); setErrors((er) => ({ ...er, ...(err.details && typeof err.details === 'object' ? err.details : {}) })); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="stack">
      {formError && <Banner tone="neg">{formError}</Banner>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="exp-amount">Amount ({user.currency})</label>
          <input id="exp-amount" className="input" inputMode="decimal" type="number" step="0.01" min="0" value={values.amount} onChange={set('amount')} aria-invalid={errors.amount ? 'true' : undefined} autoFocus />
          {errors.amount && <span className="field-error" role="alert">{errors.amount}</span>}
          {values.originalCurrency && <span className="field-hint">Converted from {values.originalAmount} {values.originalCurrency}</span>}
          <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start', padding: '2px 6px', minHeight: 24 }} onClick={() => setFx((f) => ({ ...f, open: !f.open }))}><ArrowLeftRight size={14} />Paid in another currency?</button>
        </div>
        <TextField label="Date" type="date" value={values.date} onChange={set('date')} error={errors.date} />
        <SelectField label="Category" value={values.category} onChange={set('category')} error={errors.category} placeholder="Choose…" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        <SelectField label="Payment mode" value={values.paymentMode} onChange={set('paymentMode')} error={errors.paymentMode} placeholder="Choose…" options={paymentModes.map((p) => ({ value: p.id, label: p.name }))} />
        <TextField className="span-2" label="Description" value={values.description} onChange={set('description')} error={errors.description} placeholder="What was it for?" maxLength={200} />
        <TextField className="span-2" label="Merchant (optional)" value={values.merchant} onChange={set('merchant')} maxLength={120} />
      </div>
      {fx.open && (
        <div className="banner banner-gold" style={{ display: 'grid', gap: 10 }}>
          <div className="form-grid">
            <SelectField label="Currency" value={fx.currency} onChange={(e) => setFx((f) => ({ ...f, currency: e.target.value }))} options={CURRENCIES.filter((c) => c !== user.currency).map((c) => ({ value: c, label: c }))} />
            <TextField label="Amount paid" type="number" step="0.01" min="0" value={fx.amount} onChange={(e) => setFx((f) => ({ ...f, amount: e.target.value }))} />
          </div>
          {fx.error ? <span className="field-error">{fx.error}</span> : <span className="small">{converted != null ? `≈ ${money(converted)} at today's rate${fx.rates?.stale ? ' (last known rate)' : ''}` : 'Enter an amount to convert.'}</span>}
          <div className="row"><Button type="button" size="sm" disabled={converted == null} onClick={applyConversion}>Use {converted != null ? money(converted) : 'converted amount'}</Button></div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}