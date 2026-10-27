import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Download, Upload, Pencil, Trash2, SlidersHorizontal, Search, Repeat, Paperclip, X, ListOrdered } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDebounce, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, Modal, ConfirmDialog, EmptyState, ErrorState, Pager, Skeleton, Chip, SelectField, TextField, ColorDot, Stat } from '../components/ui/index.jsx';
import ExpenseForm from '../components/ExpenseForm.jsx';
import ImportWizard from '../components/ImportWizard.jsx';
import { formatDay } from '../utils/format.js';

const EMPTY = { q: '', category: '', paymentMode: '', minAmount: '', maxAmount: '', from: '', to: '', period: '', recurring: '', receipt: '', source: '', sort: 'dateDesc' };
const SORTS = [{ value: 'dateDesc', label: 'Newest first' }, { value: 'dateAsc', label: 'Oldest first' }, { value: 'amountDesc', label: 'Highest amount' }, { value: 'amountAsc', label: 'Lowest amount' }];

export default function Transactions() {
  useDocumentTitle('Transactions');
  const { money } = useAuth();
  const { categories, paymentModes } = useMeta();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | expense
  const [deleting, setDeleting] = useState(null);
  const [delBusy, setDelBusy] = useState(false);
  const [importing, setImporting] = useState(params.get('import') === '1');

  const debounced = useDebounce({ q: filters.q, minAmount: filters.minAmount, maxAmount: filters.maxAmount }, 350);
  const query = useMemo(() => ({ ...filters, ...debounced, page, limit: 20 }), [filters, debounced, page]);
  const { data: rows, meta, loading, error, reload } = useAsync(() => api.get('/expenses', query), [JSON.stringify(query)]);

  useEffect(() => { if (params.get('import')) { const p = new URLSearchParams(params); p.delete('import'); setParams(p, { replace: true }); } /* eslint-disable-next-line */ }, []);

  const setF = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1); };
  const clear = () => { setFilters(EMPTY); setPage(1); };
  const active = Object.entries(filters).filter(([k, v]) => v !== '' && k !== 'sort').length;

  const save = async (body) => {
    if (editing === 'new') {
      const r = await api.post('/expenses', body);
      toast.success(r.meta?.possibleDuplicateOf ? 'Saved, but it looks similar to an existing expense.' : 'Expense added.');
    } else { await api.put(`/expenses/${editing.id}`, body); toast.success('Expense updated.'); }
    setEditing(null); reload();
  };
  const remove = async () => {
    setDelBusy(true);
    try {
      const { data } = await api.del(`/expenses/${deleting.id}`);
      const e = data.expense;
      setDeleting(null);
      toast.success('Expense deleted.', { label: 'Undo', onClick: async () => { try { await api.post('/expenses', { amount: e.amount, description: e.description, merchant: e.merchant, category: e.category.id, paymentMode: e.paymentMode.id, date: e.date }); toast.success('Restored.'); reload(); } catch (err) { toast.error(err.message); } } });
      reload();
    } catch (e) { toast.error(e.message); } finally { setDelBusy(false); }
  };
  const exportCsv = async () => {
    try { const { page: _p, limit: _l, ...q } = query; await api.download('/expenses/export.csv', q, 'spendiq-expenses.csv'); } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader title="Transactions" subtitle="Search, filter and manage every expense." actions={<>
        <Button variant="secondary" icon={Upload} onClick={() => setImporting(true)}>Import CSV</Button>
        <Button variant="secondary" icon={Download} onClick={exportCsv}>Export{active ? ' filtered' : ''}</Button>
        <Button icon={Plus} onClick={() => setEditing('new')}>Add expense</Button></>} />
      <Panel flat>
        <div className="filters">
          <div className="row row-wrap">
            <div className="input-group grow" style={{ minWidth: 220 }}>
              <span className="prefix"><Search size={16} aria-hidden="true" /></span>
              <input className="input" type="search" placeholder="Search description or merchant…" aria-label="Search" value={filters.q} onChange={setF('q')} />
            </div>
            <SelectField label="" aria-label="Category" value={filters.category} onChange={setF('category')} placeholder="All categories" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            <SelectField label="" aria-label="Sort" value={filters.sort} onChange={setF('sort')} options={SORTS} />
            <Button variant="secondary" icon={SlidersHorizontal} aria-expanded={showAdvanced} onClick={() => setShowAdvanced((s) => !s)}>Filters{active ? ` (${active})` : ''}</Button>
            {active > 0 && <Button variant="ghost" icon={X} onClick={clear}>Clear</Button>}
          </div>
          {showAdvanced && (
            <div className="filter-row">
              <SelectField label="Payment mode" value={filters.paymentMode} onChange={setF('paymentMode')} placeholder="Any" options={paymentModes.map((p) => ({ value: p.id, label: p.name }))} />
              <TextField label="Min amount" type="number" min="0" value={filters.minAmount} onChange={setF('minAmount')} />
              <TextField label="Max amount" type="number" min="0" value={filters.maxAmount} onChange={setF('maxAmount')} />
              <TextField label="Month" type="month" value={filters.period} onChange={(e) => { setFilters((f) => ({ ...f, period: e.target.value, from: '', to: '' })); setPage(1); }} />
              <TextField label="From" type="date" value={filters.from} onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value, period: '' })); setPage(1); }} />
              <TextField label="To" type="date" value={filters.to} onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value, period: '' })); setPage(1); }} />
              <SelectField label="Recurring" value={filters.recurring} onChange={setF('recurring')} placeholder="Any" options={[{ value: 'yes', label: 'Recurring only' }, { value: 'no', label: 'Non-recurring only' }]} />
              <SelectField label="Receipt" value={filters.receipt} onChange={setF('receipt')} placeholder="Any" options={[{ value: 'yes', label: 'Has receipt' }, { value: 'no', label: 'No receipt' }]} />
              <SelectField label="Source" value={filters.source} onChange={setF('source')} placeholder="Any" options={[{ value: 'manual', label: 'Added manually' }, { value: 'receipt', label: 'Scanned receipt' }, { value: 'csv', label: 'CSV import' }, { value: 'recurring', label: 'Recurring' }, { value: 'migration', label: 'Old SpendIQ' }]} />
            </div>
          )}
        </div>
        {meta && (
          <div className="row row-wrap" style={{ padding: '14px 20px', gap: 32, borderBottom: '1px solid var(--line)' }}>
            <Stat label={active ? 'Matching total' : 'Total'} value={money(meta.totalAmount)} /><Stat label="Transactions" value={meta.count} /><Stat label="Average" value={money(meta.average)} /><Stat label="Highest" value={money(meta.highest)} />
          </div>
        )}
        {error ? <div style={{ padding: 20 }}><ErrorState error={error} onRetry={reload} /></div>
          : loading && !rows ? <div style={{ padding: 20 }} className="stack-sm">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={36} />)}</div>
          : rows.length === 0 ? (
            <EmptyState icon={ListOrdered} title={active ? 'No transactions match these filters' : 'No transactions yet'} action={active ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : <Button icon={Plus} onClick={() => setEditing('new')}>Add your first expense</Button>}>
              {active ? 'Try widening the date range or removing a filter.' : 'Add one by hand, scan a receipt, or import a CSV.'}
            </EmptyState>
             ) : (
            <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
              <table className="table cards">
                <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Payment</th><th className="right">Amount</th><th /></tr></thead>
                <tbody>{rows.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDay(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td><div style={{ fontWeight: 600 }}>{e.merchant || e.description || '—'}</div>
                      <div className="row faint small" style={{ gap: 6 }}>{e.merchant && e.description ? e.description : null}{e.isRecurring && <Chip tone="brand"><Repeat size={11} />recurring</Chip>}{e.receiptId && <Chip><Paperclip size={11} />receipt</Chip>}{e.originalCurrency && <Chip tone="gold">{e.originalAmount} {e.originalCurrency}</Chip>}</div></td>
                    <td data-hide-mobile><span className="row" style={{ gap: 8 }}><ColorDot color={e.category.color} />{e.category.name}</span></td>
                    <td data-hide-mobile>{e.paymentMode.name}</td>
                    <td className="right num"><strong>{money(e.amount)}</strong></td>
                    <td className="right" data-hide-mobile style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon-btn" aria-label={`Edit ${e.description || e.merchant || 'expense'}`} onClick={() => setEditing(e)}><Pencil size={16} /></button>
                      <button className="icon-btn" aria-label={`Delete ${e.description || e.merchant || 'expense'}`} onClick={() => setDeleting(e)}><Trash2 size={16} /></button>
                    </td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        {meta && meta.count > 0 && <Pager page={meta.page} pages={meta.pages} onPage={setPage} label={`${meta.count} result${meta.count === 1 ? '' : 's'}`} />}
      </Panel>

      {editing && <Modal title={editing === 'new' ? 'Add expense' : 'Edit expense'} onClose={() => setEditing(null)}><ExpenseForm initial={editing === 'new' ? null : editing} onSubmit={save} onCancel={() => setEditing(null)} submitLabel={editing === 'new' ? 'Save expense' : 'Save changes'} /></Modal>}
      {deleting && <ConfirmDialog title="Delete this expense?" message={`${deleting.merchant || deleting.description || 'This expense'} (${money(deleting.amount)} on ${formatDay(deleting.date)}) will be removed. You can undo right after.`} onConfirm={remove} onCancel={() => setDeleting(null)} busy={delBusy} />}
      {importing && <ImportWizard onClose={() => setImporting(false)} onDone={reload} />}
    </>
  );
}

            