import { useState } from 'react';
import { Plus, Pencil, Trash2, Copy, Target, AlertTriangle } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, Modal, ConfirmDialog, EmptyState, ErrorState, PanelSkeleton, ProgressBar, PeriodSwitcher, SelectField, TextField, Chip, Banner, Segmented } from '../components/ui/index.jsx';
import CategoryIcon from '../components/CategoryIcon.jsx';
import { currentPeriod, periodLabel, shiftPeriod } from '../utils/format.js';

function BudgetForm({ period, initial, onDone, onCancel }) {
  const { user } = useAuth();
  const { categories } = useMeta();
  const toast = useToast();
  const [v, setV] = useState({ category: initial?.categoryId ?? '', limit: initial?.limit ?? '', threshold: initial?.threshold ?? user.warningThreshold, scope: initial ? (initial.period === 'default' ? 'default' : 'month') : 'month' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setV((s) => ({ ...s, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!v.category) er.category = 'Choose a category';
    if (!(Number(v.limit) > 0)) er.limit = 'Enter a limit above 0';
    if (!(Number(v.threshold) >= 1 && Number(v.threshold) <= 100)) er.threshold = 'Between 1 and 100';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      await api.post('/budgets', { category: v.category, period: v.scope === 'default' ? 'default' : period, limit: Number(v.limit), threshold: Number(v.threshold) });
      toast.success('Budget saved.'); onDone();
    } catch (err) { setErrors(err.details ?? {}); toast.error(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <SelectField label="Category" value={v.category} onChange={set('category')} error={errors.category} placeholder="Choose…" disabled={Boolean(initial)} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
      <TextField label="Monthly limit" type="number" min="0" step="0.01" value={v.limit} onChange={set('limit')} error={errors.limit} />
      <TextField label="Warn me at (% used)" type="number" min="1" max="100" value={v.threshold} onChange={set('threshold')} error={errors.threshold} hint="You'll see a warning once spending reaches this share of the limit." />
      <div className="field"><span className="label">Applies to</span>
        <Segmented label="Budget scope" value={v.scope} onChange={(s) => setV((x) => ({ ...x, scope: s }))} options={[{ value: 'month', label: periodLabel(period) }, { value: 'default', label: 'Every month' }]} />
        <span className="field-hint">“Every month” is the default; a month-specific budget overrides it.</span></div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save budget</Button></div>
    </form>
  );
}

export default function Budgets() {
  useDocumentTitle('Budgets');
  const { money } = useAuth();
  const { categories } = useMeta();
  const toast = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { data, loading, error, reload } = useAsync(() => api.get('/budgets', { period }), [period]);
  const { data: forecast } = useAsync(() => api.get('/forecast'), []);
  const riskOf = (id) => (period === currentPeriod() ? forecast?.budgets.find((b) => b.budgetId === id) : null);

  const remove = async () => { try { await api.del(`/budgets/${deleting.id}`); toast.success('Budget deleted.'); setDeleting(null); reload(); } catch (e) { toast.error(e.message); } };
  const copyPrev = async () => { try { const r = await api.post('/budgets/copy', { from: shiftPeriod(period, -1), to: period }); toast.success(`Copied ${r.data.copied} budget(s).`); reload(); } catch (e) { toast.error(e.message); } };

  const over = data?.filter((b) => b.status === 'exceeded') ?? [];
  const near = data?.filter((b) => b.status === 'warning') ?? [];
  return (
    <>
      <PageHeader title="Budgets" subtitle="Set limits per category and get warned before you overspend." actions={<><PeriodSwitcher value={period} onChange={setPeriod} /><Button variant="secondary" icon={Copy} onClick={copyPrev}>Copy last month</Button><Button icon={Plus} onClick={() => setEditing({})}>Add budget</Button></>} />
      {error ? <ErrorState error={error} onRetry={reload} /> : loading && !data ? <PanelSkeleton rows={5} /> : data.length === 0 ? (
        <Panel><EmptyState icon={Target} title={`No budgets for ${periodLabel(period)}`} action={<Button icon={Plus} onClick={() => setEditing({})}>Create a budget</Button>}>Pick a category and a limit. You'll get alerts when spending nears or passes it.</EmptyState></Panel>
      ) : (
        <div className="stack">
          {(over.length > 0 || near.length > 0) && <Banner tone={over.length ? 'neg' : 'warn'} icon={AlertTriangle}>{over.length > 0 && <>Over budget: <strong>{over.map((b) => b.category).join(', ')}</strong>. </>}{near.length > 0 && <>Close to the limit: <strong>{near.map((b) => b.category).join(', ')}</strong>.</>}</Banner>}
          <div className="grid-2">
            {data.map((b) => {
              const cat = categories.find((c) => c.id === b.categoryId);
              const f = riskOf(b.id);
              return (
                <Panel key={b.id}>
                  <div className="row between" style={{ marginBottom: 12 }}>
                    <div className="row"><CategoryIcon icon={cat?.icon} color={b.color} /><div><h3>{b.category}</h3><span className="faint small">{b.period === 'default' ? 'Every month' : periodLabel(b.period)} · warns at {b.threshold}%</span></div></div>
                    <div><button className="icon-btn" aria-label={`Edit ${b.category} budget`} onClick={() => setEditing(b)}><Pencil size={16} /></button><button className="icon-btn" aria-label={`Delete ${b.category} budget`} onClick={() => setDeleting(b)}><Trash2 size={16} /></button></div>
                  </div>
                  <div className="row between" style={{ marginBottom: 6 }}><strong className="num" style={{ fontSize: '1.25rem' }}>{money(b.spent)}</strong><span className="muted">of {money(b.limit)}</span></div>
                  <ProgressBar percent={b.percent} status={b.status} label={`${b.category} budget used`} />
                  <div className="row between small" style={{ marginTop: 8 }}>
                    <span className={b.remaining < 0 ? 'neg' : 'muted'}>{b.remaining >= 0 ? `${money(b.remaining)} left` : `${money(-b.remaining)} over`}</span>
                    <Chip tone={{ ok: 'pos', warning: 'warn', exceeded: 'neg' }[b.status]}>{Math.round(b.percent)}% used</Chip>
                  </div>
                  {f && b.status !== 'exceeded' && f.risk !== 'unlikely' && <p className="small" style={{ marginTop: 10, color: 'var(--gold)' }}>Forecast: on pace for {money(f.projected)}; {f.risk === 'likely' ? 'likely' : 'could'} exceed this budget (an estimate).</p>}
                </Panel>
              );
            })}
          </div>
        </div>
      )}
      {editing && <Modal title={editing.id ? 'Edit budget' : 'Add budget'} onClose={() => setEditing(null)}><BudgetForm period={period} initial={editing.id ? editing : null} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} /></Modal>}
      {deleting && <ConfirmDialog title="Delete this budget?" message={`The ${deleting.category} budget will be removed. Your expenses are not affected.`} onConfirm={remove} onCancel={() => setDeleting(null)} />}
    </>
  );
}