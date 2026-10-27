import { useState } from 'react';
import { Plus, Pencil, Trash2, PiggyBank, PlusCircle, History } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, Modal, ConfirmDialog, EmptyState, ErrorState, PanelSkeleton, ProgressBar, TextField, TextArea, Chip, Banner, Segmented } from '../components/ui/index.jsx';
import { formatDay, todayStr } from '../utils/format.js';

const STATUS = { active: ['brand', 'In progress'], completed: ['pos', 'Completed'], overdue: ['neg', 'Past target date'], behind: ['warn', 'Behind pace'] };

function GoalForm({ initial, onDone, onCancel }) {
  const toast = useToast();
  const [v, setV] = useState({ title: initial?.title ?? '', targetAmount: initial?.targetAmount ?? '', targetDate: initial?.targetDate ?? '', note: initial?.note ?? '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setV((s) => ({ ...s, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!v.title.trim()) er.title = 'Give your goal a name';
    if (!(Number(v.targetAmount) >= 1)) er.targetAmount = 'Enter a target amount';
    if (v.targetDate && v.targetDate < todayStr() && !initial) er.targetDate = 'Choose a date in the future';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const body = { title: v.title.trim(), targetAmount: Number(v.targetAmount), targetDate: v.targetDate || null, note: v.note.trim() };
      if (initial) await api.put(`/goals/${initial.id}`, body); else await api.post('/goals', body);
      toast.success('Goal saved.'); onDone();
    } catch (err) { setErrors(err.details ?? {}); toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <TextField label="Goal" value={v.title} onChange={set('title')} error={errors.title} placeholder="e.g. Emergency fund, New laptop" maxLength={80} />
      <div className="form-grid"><TextField label="Target amount" type="number" min="1" value={v.targetAmount} onChange={set('targetAmount')} error={errors.targetAmount} /><TextField label="Target date (optional)" type="date" value={v.targetDate} onChange={set('targetDate')} error={errors.targetDate} /></div>
      <TextArea label="Note (optional)" value={v.note} onChange={set('note')} maxLength={300} />
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save goal</Button></div>
    </form>
  );
}

function ContributionModal({ goal, onClose, onDone }) {
  const { money } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ amount: '', date: todayStr(), note: '', type: 'deposit' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: history, reload } = useAsync(() => api.get(`/goals/${goal.id}/contributions`), [goal.id]);
  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(v.amount) > 0)) return setError('Enter an amount above 0');
    setBusy(true); setError('');
    try { await api.post(`/goals/${goal.id}/contributions`, { ...v, amount: Number(v.amount) }); toast.success(v.type === 'deposit' ? 'Contribution recorded.' : 'Withdrawal recorded.'); setV({ ...v, amount: '', note: '' }); reload(); onDone(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const del = async (id) => { try { await api.del(`/goals/${goal.id}/contributions/${id}`); reload(); onDone(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal title={`Savings: ${goal.title}`} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <Segmented label="Type" value={v.type} onChange={(t) => setV({ ...v, type: t })} options={[{ value: 'deposit', label: 'Add money' }, { value: 'withdrawal', label: 'Take out' }]} />
        <div className="form-grid"><TextField label="Amount" type="number" min="0" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} error={error} /><TextField label="Date" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
        <TextField label="Note (optional)" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} maxLength={200} />
        <Button type="submit" loading={busy}>Record</Button>
      </form>
      <h3 style={{ margin: '20px 0 4px' }}><History size={15} style={{ verticalAlign: -2 }} /> History</h3>
      {!history?.length ? <p className="muted small">Nothing recorded yet.</p> : history.map((c) => (
        <div className="list-row" key={c.id}><div className="grow"><div>{formatDay(c.date)}{c.note ? ` · ${c.note}` : ''}</div></div><strong className={c.type === 'withdrawal' ? 'neg' : 'pos'}>{c.type === 'withdrawal' ? '−' : '+'}{money(c.amount)}</strong><button className="icon-btn" aria-label="Remove entry" onClick={() => del(c.id)}><Trash2 size={15} /></button></div>
      ))}
    </Modal>
  );
}

export default function Goals() {
  useDocumentTitle('Savings goals');
  const { money } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useAsync(() => api.get('/goals'), []);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const remove = async () => { try { await api.del(`/goals/${deleting.id}`); toast.success('Goal deleted.'); setDeleting(null); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <>
      <PageHeader title="Savings goals" subtitle="Progress counts only the money you set aside for each goal. Regular expenses are never treated as savings." actions={<Button icon={Plus} onClick={() => setEditing({})}>New goal</Button>} />
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <PanelSkeleton rows={4} /> : data.length === 0 ? (
        <Panel><EmptyState icon={PiggyBank} title="No savings goals yet" action={<Button icon={Plus} onClick={() => setEditing({})}>Create your first goal</Button>}>Name what you're saving for, set a target, and record contributions as you go.</EmptyState></Panel>
      ) : (
        <div className="grid-2">
          {data.map((g) => {
            const [tone, label] = STATUS[g.status] ?? STATUS.active;
            return (
              <Panel key={g.id}>
                <div className="row between"><div><h3>{g.title}</h3>{g.note && <p className="faint small">{g.note}</p>}</div><div><button className="icon-btn" aria-label={`Edit ${g.title}`} onClick={() => setEditing(g)}><Pencil size={16} /></button><button className="icon-btn" aria-label={`Delete ${g.title}`} onClick={() => setDeleting(g)}><Trash2 size={16} /></button></div></div>
                <div className="row between" style={{ margin: '14px 0 6px' }}><strong className="num" style={{ fontSize: '1.5rem' }}>{money(g.saved)}</strong><span className="muted">of {money(g.targetAmount)}</span></div>
                <ProgressBar percent={g.percent} status={g.status === 'completed' ? 'ok' : g.status === 'overdue' || g.status === 'behind' ? 'warning' : undefined} label={`${g.title} progress`} />
                <div className="row between small" style={{ marginTop: 8 }}><span className="muted">{Math.round(g.percent)}% · {money(g.remaining)} to go</span><Chip tone={tone}>{label}</Chip></div>
                {g.targetDate && <p className="small muted" style={{ marginTop: 8 }}>Target {formatDay(g.targetDate)}{g.monthsLeft != null ? ` (${g.monthsLeft.toFixed(1)} months left)` : ''}</p>}
                {g.requiredMonthly != null && <Banner tone={g.onTrack ? 'pos' : 'gold'}>{g.onTrack ? <>You're on track: your recent saving rate (≈{money(g.recentMonthlyAverage)}/month) covers the {money(g.requiredMonthly)}/month needed.</> : <>Set aside about <strong>{money(g.requiredMonthly)}</strong> a month to reach this by {formatDay(g.targetDate)}. {g.recentMonthlyAverage > 0 ? `Lately you've averaged ${money(g.recentMonthlyAverage)}.` : 'No recent contributions yet.'}</>}</Banner>}
                <div style={{ marginTop: 12 }}><Button variant="secondary" size="sm" icon={PlusCircle} onClick={() => setAdding(g)}>Add / manage savings</Button></div>
              </Panel>
            );
          })}
        </div>
      )}
      {editing && <Modal title={editing.id ? 'Edit goal' : 'New savings goal'} onClose={() => setEditing(null)}><GoalForm initial={editing.id ? editing : null} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} /></Modal>}
      {adding && <ContributionModal goal={adding} onClose={() => setAdding(null)} onDone={reload} />}
      {deleting && <ConfirmDialog title="Delete this goal?" message={`“${deleting.title}” and its ${deleting.contributionCount} recorded contribution(s) will be removed.`} onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </>
  );
}