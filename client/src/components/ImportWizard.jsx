// CSV import: choose file → map columns → preview with per-row validation → confirm. Nothing is saved until the last step.
import { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Download } from 'lucide-react';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Modal, Banner, Chip, SelectField } from './ui/index.jsx';
import { plural } from '../utils/format.js';

const FIELD_LABELS = { date: 'Date', amount: 'Amount', description: 'Description', merchant: 'Merchant', category: 'Category', paymentMode: 'Payment mode' };
const TONE = { valid: 'pos', invalid: 'neg', duplicate: 'warn' };

export default function ImportWizard({ onClose, onDone }) {
  const { money } = useAuth();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [dateFormat, setDateFormat] = useState('auto');
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [includeDuplicates, setIncludeDuplicates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const runPreview = async (f, map, fmt) => {
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('file', f);
      form.append('dateFormat', fmt);
      if (map) form.append('mapping', JSON.stringify(map));
      const r = await api.upload('/import/csv/preview', form);
      setPreview(r.data); setMapping(r.data.mapping);
    } catch (e) { setError(e.message); setPreview(null); }
    finally { setBusy(false); }
  };
  const pick = (e) => { const f = e.target.files?.[0]; if (!f) return; setFile(f); setResult(null); runPreview(f, null, dateFormat); };

  const changeMap = (field, value) => {
    const next = { ...mapping };
    if (value === '') delete next[field]; else next[field] = Number(value);
    setMapping(next);
    runPreview(file, next, dateFormat);
  };
  const commit = async () => {
    setBusy(true); setError('');
    try {
      const rows = preview.allRows.filter((r) => r.status === 'valid' || (includeDuplicates && r.status === 'duplicate')).map((r) => r.data);
      const r = await api.post('/import/csv/commit', { fileName: file.name, includeDuplicates, rows });
      setResult(r.data); onDone?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const s = preview?.summary;
  const importable = s ? s.valid + (includeDuplicates ? s.duplicate : 0) : 0;
  return (
    <Modal wide title="Import transactions from CSV" onClose={onClose} footer={result ? <Button onClick={onClose}>Done</Button> : <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button icon={Upload} disabled={!preview || preview.missingRequired.length > 0 || importable === 0} loading={busy} onClick={commit}>Import {plural(importable, 'transaction')}</Button></>}>
      <div className="stack">
        {error && <Banner tone="neg">{error}</Banner>}
        {result ? (
          <Banner tone="pos"><strong>Import finished.</strong> {plural(result.imported, 'transaction')} added. Skipped: {result.skippedInvalid} invalid, {result.skippedDuplicate} duplicate{result.failed ? `, ${result.failed} failed` : ''}.</Banner>
        ) : (
          <>
            <div className="row row-wrap between">
              <p className="muted small">Columns are detected automatically. Required: <strong>date</strong> and <strong>amount</strong>. Dates like 2026-10-05 or 05/10/2026 (day first) work.</p>
              <Button variant="ghost" size="sm" icon={Download} onClick={() => api.download('/import/csv/template', undefined, 'spendiq-import-template.csv')}>Template</Button>
            </div>
            <div className="row row-wrap">
              <input ref={input} type="file" accept=".csv,text/csv" onChange={pick} className="sr-only" aria-label="Choose CSV file" />
              <Button variant="secondary" icon={FileSpreadsheet} onClick={() => input.current?.click()}>{file ? 'Choose a different file' : 'Choose CSV file'}</Button>
              {file && <span className="muted small">{file.name} · {(file.size / 1024).toFixed(1)} KB</span>}
              <SelectField label="" aria-label="Date format" value={dateFormat} onChange={(e) => { setDateFormat(e.target.value); if (file) runPreview(file, mapping, e.target.value); }} options={[{ value: 'auto', label: 'Dates: auto (day first)' }, { value: 'dmy', label: 'Dates: DD/MM/YYYY' }, { value: 'mdy', label: 'Dates: MM/DD/YYYY' }]} />
            </div>
            {busy && !preview && <p className="muted">Reading file…</p>}
            {preview && (
              <>
                <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                  {Object.entries(FIELD_LABELS).map(([f, label]) => (
                    <SelectField key={f} label={`${label}${preview.requiredFields.includes(f) ? ' *' : ''}`} value={mapping[f] ?? ''} onChange={(e) => changeMap(f, e.target.value)} placeholder="— none —" options={preview.headers.map((h, i) => ({ value: i, label: h || `Column ${i + 1}` }))} />
                  ))}
                </div>
                {preview.missingRequired.length > 0 ? (
                  <Banner tone="warn">Choose which columns hold the {preview.missingRequired.join(' and ')}.</Banner>
                ) : (
                  <>
                    <div className="row row-wrap">
                      <Chip tone="pos">{s.valid} ready</Chip><Chip tone="warn">{s.duplicate} possible duplicates</Chip><Chip tone="neg">{s.invalid} invalid</Chip><span className="faint small">of {s.total} rows</span>
                      {s.duplicate > 0 && <label className="check small"><input type="checkbox" checked={includeDuplicates} onChange={(e) => setIncludeDuplicates(e.target.checked)} />Import duplicates too</label>}
                    </div>
                    <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
                      <table className="table"><thead><tr><th>Line</th><th>Status</th><th>Date</th><th>Description</th><th>Category</th><th className="right">Amount</th></tr></thead>
                        <tbody>{preview.rows.slice(0, 100).map((r) => (
                          <tr key={r.line}><td>{r.line}</td><td><Chip tone={TONE[r.status]}>{r.status}</Chip></td>
                            <td>{r.data?.date ?? '—'}</td><td>{r.data ? (r.data.merchant || r.data.description || '—') : <span className="neg small">{r.errors.join(' ')}</span>}{r.data && r.warnings.length > 0 && <div className="faint small">{r.warnings[0]}</div>}</td>
                            <td>{r.data?.category ?? ''}</td><td className="right num">{r.data ? money(r.data.amount) : ''}</td></tr>
                        ))}</tbody></table>
                    </div>
                    {preview.truncatedPreview && <p className="faint small">Showing the first 500 rows in the preview; all rows will be imported.</p>}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}