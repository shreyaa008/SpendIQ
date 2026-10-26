import { useState } from 'react';
import { Plus, Pencil, Trash2, Lock, CreditCard } from 'lucide-react';
import { api } from '../api/client.js';
import { useDocumentTitle } from '../hooks/index.js';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, Modal, ConfirmDialog, TextField, SelectField, Tabs, Chip, Banner } from '../components/ui/index.jsx';
import CategoryIcon, { ICONS, COLORS } from '../components/CategoryIcon.jsx';

function CategoryForm({ initial, onDone, onCancel }) {
  const toast = useToast();
  const [v, setV] = useState({ name: initial?.name ?? '', icon: initial?.icon ?? 'tag', color: initial?.color ?? COLORS[0] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!v.name.trim()) return setError('Enter a name');
    setBusy(true); setError('');
    try { if (initial) await api.put(`/categories/${initial.id}`, { ...v, name: v.name.trim() }); else await api.post('/categories', { ...v, name: v.name.trim() }); toast.success('Category saved.'); onDone(); }
    catch (err) { setError(err.details?.name || err.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <TextField label="Name" value={v.name} onChange={(e) => { setV({ ...v, name: e.target.value }); setError(''); }} error={error} maxLength={40} disabled={initial?.isFallback} hint={initial?.isFallback ? '"Other" is the safe fallback and cannot be renamed.' : undefined} />
      <div className="field"><span className="label">Icon</span><div className="icon-grid">{Object.entries(ICONS).map(([k, I]) => <button type="button" key={k} aria-label={k} aria-pressed={v.icon === k} onClick={() => setV({ ...v, icon: k })}><I size={18} /></button>)}</div></div>
      <div className="field"><span className="label">Colour</span><div className="swatches">{COLORS.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={v.color === c} onClick={() => setV({ ...v, color: c })} />)}</div></div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
    </form>
  );
}

function NameForm({ initial, onDone, onCancel }) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter a name');
    setBusy(true);
    try { if (initial) await api.put(`/payment-modes/${initial.id}`, { name: name.trim() }); else await api.post('/payment-modes', { name: name.trim() }); toast.success('Payment mode saved.'); onDone(); }
    catch (err) { setError(err.details?.name || err.message); } finally { setBusy(false); }
  };
  return <form className="stack" onSubmit={submit} noValidate><TextField label="Name" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} error={error} maxLength={40} placeholder="e.g. Wallet, Gift card" /><div className="row" style={{ justifyContent: 'flex-end' }}><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div></form>;
}

/** Deleting something that's in use requires choosing where its records go. Nothing is silently lost or orphaned. */
function DeleteDialog({ kind, item, others, onClose, onDone }) {
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [usage, setUsage] = useState(item.expenseCount > 0 ? { expenses: item.expenseCount } : null);
  const [busy, setBusy] = useState(false);
  const path = kind === 'category' ? 'categories' : 'payment-modes';
  const go = async () => {
    setBusy(true);
    try { const r = await api.del(`/${path}/${item.id}`, target ? { reassignTo: target } : undefined); toast.success(r.data.moved ? `Deleted; ${r.data.moved} record(s) moved.` : 'Deleted.'); onDone(); }
    catch (e) { if (e.status === 409 && e.details?.usage) setUsage(e.details.usage); else toast.error(e.message); } finally { setBusy(false); }
  };
  const needs = usage && (usage.total ?? usage.expenses) > 0;
  return (
    <Modal title={`Delete “${item.name}”?`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={needs && !target} onClick={go}>Delete{needs ? ' and move records' : ''}</Button></>}>
      {needs ? <div className="stack"><Banner tone="warn">This {kind === 'category' ? 'category' : 'payment mode'} is used by {usage.expenses ?? 0} expense(s){usage.recurring ? `, ${usage.recurring} recurring rule(s)` : ''}{usage.budgets ? ` and ${usage.budgets} budget(s)` : ''}. Choose where to move them. Nothing will be lost.</Banner>
        <SelectField label="Move records to" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Choose…" options={others.map((o) => ({ value: o.id, label: o.name }))} /></div>
        : <p className="muted">It isn't used by any expense, so it can be removed safely.</p>}
    </Modal>
  );
}

export default function Categories() {
  useDocumentTitle('Categories');
  const { categories, paymentModes, refresh } = useMeta();
  const [tab, setTab] = useState('categories');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const done = () => { setEditing(null); setDeleting(null); refresh(); };
  return (
    <>
      <PageHeader title="Categories & payment modes" subtitle="Organise spending your way. These appear in forms, filters, charts, reports and the assistant." actions={<Button icon={Plus} onClick={() => setEditing({})}>{tab === 'categories' ? 'New category' : 'New payment mode'}</Button>} />
      <div className="stack">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'categories', label: `Categories (${categories.length})` }, { value: 'payments', label: `Payment modes (${paymentModes.length})` }]} />
        {tab === 'categories' ? (
          <Panel flat>{categories.map((c) => (
            <div className="list-row" key={c.id} style={{ padding: '12px 20px' }}>
              <CategoryIcon icon={c.icon} color={c.color} size={18} /><div className="grow"><strong>{c.name}</strong><div className="faint small">{c.expenseCount} expense{c.expenseCount === 1 ? '' : 's'}</div></div>
              {c.isFallback && <Chip><Lock size={11} />fallback</Chip>}{c.isDefault && !c.isFallback && <Chip>default</Chip>}
              <button className="icon-btn" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Pencil size={16} /></button>
              <button className="icon-btn" aria-label={`Delete ${c.name}`} disabled={c.isFallback} onClick={() => setDeleting(c)}><Trash2 size={16} /></button>
            </div>))}</Panel>
        ) : (
          <Panel flat>{paymentModes.map((p) => (
            <div className="list-row" key={p.id} style={{ padding: '12px 20px' }}>
              <span className="avatar" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><CreditCard size={16} /></span><div className="grow"><strong>{p.name}</strong><div className="faint small">{p.expenseCount} expense{p.expenseCount === 1 ? '' : 's'}</div></div>
              {p.isDefault && <Chip>default</Chip>}
              <button className="icon-btn" aria-label={`Rename ${p.name}`} onClick={() => setEditing(p)}><Pencil size={16} /></button>
              <button className="icon-btn" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)} disabled={paymentModes.length <= 1}><Trash2 size={16} /></button>
            </div>))}</Panel>
        )}
      </div>
      {editing && <Modal title={tab === 'categories' ? (editing.id ? 'Edit category' : 'New category') : (editing.id ? 'Rename payment mode' : 'New payment mode')} onClose={() => setEditing(null)}>{tab === 'categories' ? <CategoryForm initial={editing.id ? editing : null} onCancel={() => setEditing(null)} onDone={done} /> : <NameForm initial={editing.id ? editing : null} onCancel={() => setEditing(null)} onDone={done} />}</Modal>}
      {deleting && <DeleteDialog kind={tab === 'categories' ? 'category' : 'payment'} item={deleting} others={(tab === 'categories' ? categories : paymentModes).filter((o) => o.id !== deleting.id)} onClose={() => setDeleting(null)} onDone={done} />}
    </>
  );
}