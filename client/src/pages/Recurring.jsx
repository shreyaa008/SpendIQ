import { useState } from 'react';
import { Plus, Pencil, Trash2, Pause, Play, Check, SkipForward, Repeat } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, Modal, ConfirmDialog, EmptyState, ErrorState, PanelSkeleton, TextField, SelectField, Chip, Banner, ColorDot } from '../components/ui/index.jsx';
import { formatDay, todayStr, shortDay } from '../utils/format.js';

const FREQ = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

function RuleForm({ initial, onDone, onCancel }) {
  const { user } = useAuth();
  const { categories, paymentModes } = useMeta();
  const toast = useToast();
  const [v, setV] = useState({ description: initial?.description ?? '', amount: initial?.amount ?? '', category: initial?.category.id ?? '', paymentMode: initial?.paymentMode.id ?? paymentModes[0]?.id ?? '', frequency: initial?.frequency ?? 'monthly', startDate: initial?.startDate ?? todayStr(), endDate: initial?.endDate ?? '', autoPost: initial?.autoPost ?? false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setV((s) => ({ ...s, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!v.description.trim()) er.description = 'Describe the payment';
    if (!(Number(v.amount) > 0)) er.amount = 'Enter an amount above 0';
    if (!v.category) er.category = 'Choose a category';
    if (!v.paymentMode) er.paymentMode = 'Choose a payment mode';
    if (!v.startDate) er.startDate = 'Choose a start date';
    if (v.endDate && v.endDate < v.startDate) er.endDate = 'Must be after the start date';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const body = { ...v, description: v.description.trim(), amount: Number(v.amount), endDate: v.endDate || null };
      if (initial) await api.put(`/recurring/${initial.id}`, body); else await api.post('/recurring', body);
      toast.success('Recurring payment saved.'); onDone();
    } catch (err) { setErrors(err.details ?? {}); toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <TextField className="span-2" label="Description" value={v.description} onChange={set('description')} error={errors.description} placeholder="e.g. Netflix, Rent, Gym" maxLength={200} />
        <TextField label={`Amount (${user.currency})`} type="number" min="0" step="0.01" value={v.amount} onChange={set('amount')} error={errors.amount} />
        <SelectField label="Repeats" value={v.frequency} onChange={set('frequency')} options={Object.entries(FREQ).map(([value, label]) => ({ value, label }))} />
        <SelectField label="Category" value={v.category} onChange={set('category')} error={errors.category} placeholder="Choose…" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        <SelectField label="Payment mode" value={v.paymentMode} onChange={set('paymentMode')} error={errors.paymentMode} options={paymentModes.map((p) => ({ value: p.id, label: p.name }))} />
        <TextField label="First payment" type="date" value={v.startDate} onChange={set('startDate')} error={errors.startDate} />
        <TextField label="Ends (optional)" type="date" value={v.endDate} onChange={set('endDate')} error={errors.endDate} />
      </div>
      <label className="check"><input type="checkbox" checked={v.autoPost} onChange={(e) => setV((s) => ({ ...s, autoPost: e.target.checked }))} /><span>Record automatically on the due date<span className="faint small"> (otherwise you confirm each payment)</span></span></label>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
    </form>
  );
}

export default function Recurring() {
  useDocumentTitle('Recurring');
  const { money } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/recurring'), []);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const act = async (rule, kind) => {
    setBusyId(rule.id);
    try {
      // Posting/skipping names the exact occurrence, so a double-click can never record the following month by mistake.
      if (kind === 'post') { await api.post(`/recurring/${rule.id}/post`, { occurrence: rule.nextDueDate }); toast.success(`${rule.description} recorded as paid.`); }
      else if (kind === 'skip') { await api.post(`/recurring/${rule.id}/skip`, { occurrence: rule.nextDueDate }); toast.info('Skipped.'); }
      else { await api.post(`/recurring/${rule.id}/${kind}`); toast.success(kind === 'pause' ? 'Paused.' : 'Resumed.'); }
      reload();
    } catch (e) { toast.error(e.message); reload(); } finally { setBusyId(null); }
  };
  const remove = async () => { try { await api.del(`/recurring/${deleting.id}`); toast.success('Deleted. Payments already recorded were kept.'); setDeleting(null); reload(); } catch (e) { toast.error(e.message); } };

  const rules = data?.rules ?? [];
  const monthly = rules.filter((r) => r.status === 'active' && !r.isEnded).reduce((t, r) => t + r.estimatedMonthly, 0);
  const dueNow = rules.filter((r) => r.isDue);
  return (
    <>
      <PageHeader title="Recurring payments" subtitle="Subscriptions and regular bills. A rule is a schedule, not a transaction: nothing is recorded until you confirm it (or opt in to auto-record)." actions={<Button icon={Plus} onClick={() => setEditing({})}>Add recurring</Button>} />
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <PanelSkeleton rows={4} /> : rules.length === 0 ? (
        <Panel><EmptyState icon={Repeat} title="No recurring payments yet" action={<Button icon={Plus} onClick={() => setEditing({})}>Add one</Button>}>Add rent, subscriptions or EMIs so forecasts include them and you get a reminder when one is due.</EmptyState></Panel>
      ) : (
        <div className="stack">
          {dueNow.length > 0 && <Banner tone="warn">{dueNow.length} payment{dueNow.length === 1 ? ' is' : 's are'} due or overdue: {dueNow.map((r) => r.description).join(', ')}.</Banner>}
          <p className="muted">Active rules add up to about <strong>{money(monthly)}</strong> a month.</p>
          <Panel flat>
            <div className="table-wrap"><table className="table cards">
              <thead><tr><th>Payment</th><th>Repeats</th><th>Next due</th><th className="right">Amount</th><th /></tr></thead>
              <tbody>{rules.map((r) => (
                <tr key={r.id}>
                  <td><div style={{ fontWeight: 600 }}>{r.description}</div><div className="row faint small" style={{ gap: 6 }}><ColorDot color={r.category.color} />{r.category.name} · {r.paymentMode.name}{r.status === 'paused' && <Chip tone="warn">Paused</Chip>}{r.autoPost && <Chip>auto</Chip>}</div></td>
                  <td data-hide-mobile>{FREQ[r.frequency]}</td>
                  <td>{r.isEnded ? <Chip>Ended</Chip> : r.status === 'paused' ? <span className="faint">—</span> : r.isDue ? <Chip tone="warn">{shortDay(r.nextDueDate)} · due</Chip> : formatDay(r.nextDueDate)}</td>
                  <td className="right num"><strong>{money(r.amount)}</strong></td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }} data-hide-mobile>
                    {r.status === 'active' && !r.isEnded && <><Button size="sm" variant="secondary" icon={Check} loading={busyId === r.id} onClick={() => act(r, 'post')}>Mark paid</Button>{' '}<button className="icon-btn" title="Skip this payment" aria-label={`Skip ${r.description}`} onClick={() => act(r, 'skip')}><SkipForward size={16} /></button></>}
                    <button className="icon-btn" aria-label={r.status === 'active' ? `Pause ${r.description}` : `Resume ${r.description}`} onClick={() => act(r, r.status === 'active' ? 'pause' : 'resume')}>{r.status === 'active' ? <Pause size={16} /> : <Play size={16} />}</button>
                    <button className="icon-btn" aria-label={`Edit ${r.description}`} onClick={() => setEditing(r)}><Pencil size={16} /></button>
                    <button className="icon-btn" aria-label={`Delete ${r.description}`} onClick={() => setDeleting(r)}><Trash2 size={16} /></button>
                  </td>
                </tr>))}</tbody>
            </table></div>
          </Panel>
          <Panel title="Next 45 days" subtitle="Unpaid occurrences coming up">
            {data.upcoming.length === 0 ? <p className="muted">Nothing scheduled.</p> : data.upcoming.map((u) => (
              <div className="list-row" key={`${u.ruleId}${u.date}`}><div className="grow"><div style={{ fontWeight: 600 }}>{u.description}</div><div className="faint small">{formatDay(u.date)} · {u.category}</div></div><strong className="num">{money(u.amount)}</strong></div>
            ))}
          </Panel>
        </div>
      )}
      {editing && <Modal title={editing.id ? 'Edit recurring payment' : 'New recurring payment'} onClose={() => setEditing(null)}><RuleForm initial={editing.id ? editing : null} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} /></Modal>}
      {deleting && <ConfirmDialog title="Delete this rule?" message={`“${deleting.description}” will stop being scheduled. Payments you already recorded stay in your transactions.`} onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </>
  );
}