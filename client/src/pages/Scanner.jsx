// Receipt scanner: upload → OCR → the user REVIEWS and edits → confirm. Nothing is saved as an expense until confirmed.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine, Camera, FileText, RefreshCw, Trash2, Check, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useMeta } from '../context/MetaContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, Banner, Chip, TextField, SelectField, ConfirmDialog, Skeleton } from '../components/ui/index.jsx';
import { formatDay, todayStr } from '../utils/format.js';
import { isDay } from '../utils/validate.js';

const MAX_MB = 8;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const STATUS = { extracted: ['brand', 'Ready to review'], confirmed: ['pos', 'Saved'], failed: ['neg', 'Could not read'], processing: ['warn', 'Reading…'] };

function Review({ receipt, onSaved, onRetry, onDiscard, retrying }) {
  const { money, user } = useAuth();
  const { categories, paymentModes } = useMeta();
  const toast = useToast();
  const ex = receipt.extracted;
  const catByName = (n) => categories.find((c) => c.name.toLowerCase() === (n || '').toLowerCase())?.id ?? '';
  const payByName = (n) => paymentModes.find((p) => p.name.toLowerCase() === (n || '').toLowerCase())?.id ?? '';
  const [v, setV] = useState({ merchant: ex.merchant || '', amount: ex.total ?? '', date: ex.date || todayStr(), category: catByName(ex.suggestedCategory), paymentMode: payByName(ex.paymentMethod) || paymentModes.find((p) => p.name === 'UPI')?.id || '', description: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [ackDup, setAckDup] = useState(false);
  const [dupFromServer, setDupFromServer] = useState(null);
  const set = (k) => (e) => { setV((s) => ({ ...s, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };
  const dup = receipt.possibleDuplicateExpense || dupFromServer;
  const missing = { merchant: !ex.merchant, date: !ex.date, amount: ex.total == null };

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!v.merchant.trim()) er.merchant = 'Enter the merchant';
    if (!(Number(v.amount) > 0)) er.amount = 'Enter the total amount';
    if (!isDay(v.date)) er.date = 'Choose a valid date';
    if (!v.category) er.category = 'Choose a category';
    if (!v.paymentMode) er.paymentMode = 'Choose how you paid';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      const r = await api.post(`/receipts/${receipt.id}/confirm`, { merchant: v.merchant.trim(), amount: Number(v.amount), date: v.date, category: v.category, paymentMode: v.paymentMode, description: v.description.trim(), acknowledgeDuplicate: ackDup });
      toast.success('Receipt saved as an expense.'); onSaved(r.data);
    } catch (err) {
      if (err.details?.possibleDuplicate) setDupFromServer(err.details.possibleDuplicate);
      setErrors(typeof err.details === 'object' && !err.details.possibleDuplicate ? err.details : {});
      toast.error(err.message);
    } finally { setBusy(false); }
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {receipt.status === 'failed' ? <Banner tone="neg"><strong>We couldn't read this receipt.</strong> {receipt.errorMessage} You can retry, upload a clearer photo, or fill in the details by hand below.</Banner>
        : <Banner tone={receipt.warnings.length ? 'warn' : 'pos'}><strong>Please check the details.</strong> Scanned text can be wrong, so nothing is saved until you confirm. Reader: {receipt.provider === 'anthropic' ? 'AI' : 'local OCR'} · {Math.round((ex.confidence ?? 0) * 100)}% of key fields found.{receipt.warnings.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{receipt.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}</Banner>}
      {dup && <Banner tone="warn" icon={AlertTriangle}>An expense of the same amount around {formatDay(dup.date)}{dup.merchant ? ` (${dup.merchant})` : ''} already exists. <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={ackDup} onChange={(e) => setAckDup(e.target.checked)} />This is a different purchase; save it anyway</label></Banner>}
      <div className="form-grid">
        <TextField label={`Merchant${missing.merchant ? ' (not detected)' : ''}`} value={v.merchant} onChange={set('merchant')} error={errors.merchant} />
        <TextField label={`Total (${user.currency})${missing.amount ? ' (not detected)' : ''}`} type="number" step="0.01" min="0" value={v.amount} onChange={set('amount')} error={errors.amount} />
        <TextField label={`Date${missing.date ? ' (not detected)' : ''}`} type="date" value={v.date} onChange={set('date')} error={errors.date} />
        <SelectField label="Category" value={v.category} onChange={set('category')} error={errors.category} placeholder="Choose…" options={categories.map((c) => ({ value: c.id, label: c.name }))} hint={ex.suggestedCategory && catByName(ex.suggestedCategory) ? `Suggested: ${ex.suggestedCategory}` : undefined} />
        <SelectField label="Payment mode" value={v.paymentMode} onChange={set('paymentMode')} error={errors.paymentMode} options={paymentModes.map((p) => ({ value: p.id, label: p.name }))} hint={ex.paymentMethod ? `Receipt says: ${ex.paymentMethod}` : 'Not stated on the receipt'} />
        <TextField label="Note (optional)" value={v.description} onChange={set('description')} maxLength={200} />
      </div>
      {(ex.subtotal != null || ex.tax != null || ex.currency) && <p className="muted small">{ex.subtotal != null && <>Subtotal {money(ex.subtotal)} · </>}{ex.tax != null && <>Tax {money(ex.tax)} · </>}{ex.currency && <>Currency on receipt: {ex.currency}{ex.currency !== user.currency ? ' (check the amount is in your currency)' : ''}</>}</p>}
      {ex.lineItems.length > 0 && <details><summary style={{ cursor: 'pointer', fontWeight: 600 }}>{ex.lineItems.length} line items detected</summary><table className="table"><tbody>{ex.lineItems.map((l, i) => <tr key={i}><td>{l.description}</td><td className="right">×{l.quantity}</td><td className="right num">{l.amount != null ? money(l.amount) : ''}</td></tr>)}</tbody></table></details>}
      {receipt.rawText && <details><summary style={{ cursor: 'pointer' }} className="muted small">Show text that was read</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 12, borderRadius: 8, maxHeight: 220, overflow: 'auto' }}>{receipt.rawText}</pre></details>}
      <div className="row row-wrap" style={{ justifyContent: 'space-between' }}>
        <div className="row"><Button type="button" variant="secondary" icon={RefreshCw} loading={retrying} onClick={onRetry}>Retry scan</Button><Button type="button" variant="ghost" icon={Trash2} onClick={onDiscard}>Discard</Button></div>
        <Button type="submit" icon={Check} loading={busy}>Confirm &amp; save expense</Button>
      </div>
    </form>
  );
}

export default function Scanner() {
  useDocumentTitle('Scan receipt');
  const toast = useToast();
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const [stage, setStage] = useState('idle'); // idle | uploading | review | saved
  const [receipt, setReceipt] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [savedInfo, setSavedInfo] = useState(null);
  const { data: recent, reload } = useAsync(() => api.get('/receipts'), []);
  const { money } = useAuth();

  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const showFile = (file) => setPreview({ url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null, name: file.name, pdf: file.type === 'application/pdf' });
  const upload = async (file) => {
    setError('');
    if (!file) return;
    if (!OK_TYPES.includes(file.type)) return setError('Unsupported file type. Upload a JPG, PNG or WebP photo, or a PDF.');
    if (file.size > MAX_MB * 1024 * 1024) return setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${MAX_MB} MB.`);
    showFile(file); setStage('uploading');
    try {
      const form = new FormData(); form.append('receipt', file);
      const r = await api.upload('/receipts', form);
      setReceipt(r.data); setStage('review'); reload();
    } catch (e) {
      setStage('idle');
      if (e.status === 409 && e.details?.receiptId) { setError('You already uploaded this exact file. Opening it so you can finish.'); openExisting(e.details.receiptId); }
      else setError(e.message);
    }
  };
  const openExisting = async (id) => {
    try { const r = await api.get(`/receipts/${id}`); setReceipt(r.data); setStage(r.data.status === 'confirmed' ? 'saved' : 'review'); setSavedInfo(null);
      if (r.data.mimeType !== 'application/pdf') { const blob = await api.blob(`/receipts/${id}/file`); setPreview({ url: URL.createObjectURL(blob), name: r.data.originalName }); } else setPreview({ url: null, name: r.data.originalName, pdf: true });
    } catch (e) { toast.error(e.message); }
  };
  const retry = async () => { setRetrying(true); try { const r = await api.post(`/receipts/${receipt.id}/reprocess`); setReceipt(r.data); reload(); } catch (e) { toast.error(e.message); } finally { setRetrying(false); } };
  const discard = async () => { try { await api.del(`/receipts/${receipt.id}`); toast.info('Receipt discarded.'); reset(); reload(); } catch (e) { toast.error(e.message); } setDiscarding(false); };
  const reset = () => { setStage('idle'); setReceipt(null); setPreview(null); setError(''); setSavedInfo(null); };
  const onDrop = (e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); };

  return (
    <>
      <PageHeader title="Scan a receipt" subtitle="Upload a photo or PDF of a bill. We read it, you check it, then it becomes an expense." actions={stage !== 'idle' && <Button variant="secondary" onClick={reset}>Scan another</Button>} />
      <div className="grid-main">
        <div className="stack">
          {stage === 'idle' && (
            <Panel>
              <div className={`dropzone ${drag ? 'drag' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop} onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }} aria-label="Choose a receipt file">
                <ScanLine size={34} color="var(--brand)" aria-hidden="true" />
                <strong>Drop a receipt here, or click to choose</strong>
                <span className="muted small">JPG, PNG, WebP or PDF · up to {MAX_MB} MB · a clear, well-lit, whole-receipt photo reads best</span>
                <div className="row" onClick={(e) => e.stopPropagation()}><Button variant="secondary" icon={ImageIcon} onClick={() => fileRef.current?.click()}>Choose file</Button><Button variant="secondary" icon={Camera} onClick={() => camRef.current?.click()}>Use camera</Button></div>
              </div>
              <input ref={fileRef} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} aria-label="Receipt file" />
              <input ref={camRef} type="file" className="sr-only" accept="image/*" capture="environment" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} aria-label="Take a photo of a receipt" />
              {error && <div style={{ marginTop: 14 }}><Banner tone="neg">{error}</Banner></div>}
            </Panel>
          )}
          {stage === 'uploading' && <Panel><div className="stack-sm" aria-busy="true"><strong>Reading your receipt…</strong><p className="muted small">This can take several seconds.</p><Skeleton h={18} /><Skeleton h={18} w="80%" /><Skeleton h={18} w="60%" /></div></Panel>}
          {stage === 'review' && receipt && <Panel title="Review details"><Review key={`${receipt.id}-${receipt.updatedKey ?? receipt.status}-${receipt.extracted.total}-${receipt.extracted.merchant}`} receipt={receipt} retrying={retrying} onRetry={retry} onDiscard={() => setDiscarding(true)} onSaved={(d) => { setSavedInfo(d); setStage('saved'); reload(); }} /></Panel>}
          {stage === 'saved' && (
            <Panel><Banner tone="pos" icon={Check}><strong>Saved.</strong> {savedInfo ? <>{money(savedInfo.expense.amount)} at {savedInfo.expense.merchant} was added to {savedInfo.expense.category.name}. </> : 'This receipt is already saved as an expense. '}It now appears in your <Link to="/transactions?receipt=yes">transactions</Link>, dashboard, reports and forecasts.</Banner><div style={{ marginTop: 14 }}><Button onClick={reset}>Scan another receipt</Button></div></Panel>
          )}
        </div>
        <div className="stack">
          {preview && <Panel title="Your upload">{preview.url ? <img className="receipt-preview" src={preview.url} alt="Uploaded receipt" /> : <div className="empty"><FileText size={36} /><span>{preview.name}</span></div>}</Panel>}
          <Panel title="Recent scans">
            {!recent?.length ? <p className="muted small">Your scanned receipts will appear here.</p> : recent.slice(0, 8).map((r) => { const [tone, label] = STATUS[r.status] ?? STATUS.extracted; return (
              <button key={r.id} className="list-row" style={{ width: '100%', background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => openExisting(r.id)}>
                <FileText size={18} color="var(--ink-3)" /><div className="grow"><div style={{ fontWeight: 600 }}>{r.extracted.merchant || r.originalName}</div><div className="faint small">{r.extracted.total != null ? money(r.extracted.total) : 'amount unknown'}{r.extracted.date ? ` · ${formatDay(r.extracted.date)}` : ''}</div></div><Chip tone={tone}>{label}</Chip></button>); })}
          </Panel>
        </div>
      </div>
      {discarding && <ConfirmDialog title="Discard this receipt?" confirmLabel="Discard" message="The uploaded file and extracted details will be deleted. Nothing has been saved as an expense." onConfirm={discard} onCancel={() => setDiscarding(false)} />}
    </>
  );
}