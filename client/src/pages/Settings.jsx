import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, ArrowRightLeft, Bell, ShieldAlert, DatabaseBackup, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, TextField, SelectField, Tabs, Banner, Modal, Chip, Segmented } from '../components/ui/index.jsx';
import { CURRENCIES } from '../utils/format.js';
import { validatePassword } from '../utils/validate.js';

function Profile() {
  const { user, updateProfile } = useAuth();
  const { pref, setPref } = useTheme();
  const toast = useToast();
  const [v, setV] = useState({ name: user.name, currency: user.currency, warningThreshold: user.warningThreshold });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const save = async (e) => {
    e.preventDefault();
    const er = {};
    if (v.name.trim().length < 2) er.name = 'Enter your name';
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try { await updateProfile({ name: v.name.trim(), currency: v.currency, warningThreshold: Number(v.warningThreshold), theme: pref }); toast.success('Settings saved.'); } catch (err) { toast.error(err.message); } finally { setBusy(false); }
  };
  const toggleNotifications = async (on) => {
    if (on) {
      if (typeof Notification === 'undefined') return toast.error('This browser does not support notifications. In-app alerts still work.');
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') return toast.error('Notifications are blocked in your browser settings. In-app alerts still work.');
    }
    try { await updateProfile({ browserNotifications: on }); toast.success(on ? 'Browser notifications on.' : 'Browser notifications off.'); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="stack">
      <Panel title="Profile & preferences">
        <form className="stack" onSubmit={save} noValidate>
          <div className="form-grid">
            <TextField label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} />
            <TextField label="Email" value={user.email} disabled readOnly />
            <SelectField label="Currency" value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} hint="Changes how amounts are displayed. Existing amounts are not converted." />
          </div>
          <div className="field"><span className="label">Theme</span><Segmented label="Theme" value={pref} onChange={setPref} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /></div>
          <div><Button type="submit" loading={busy}>Save changes</Button></div>
        </form>
      </Panel>
      <Panel title="Notifications" subtitle="In-app alerts always work. Browser notifications are optional.">
        <label className="check"><input type="checkbox" checked={user.browserNotifications} onChange={(e) => toggleNotifications(e.target.checked)} /><span><Bell size={14} style={{ verticalAlign: -2 }} /> Show a browser notification for new budget and bill warnings</span></label>
      </Panel>
    </div>
  );
}

/** Brings the original SpendIQ's browser data across. Works from a backup file, or directly if the old app ran on this same address. */
function Migration() {
  const toast = useToast();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const { data: status, reload } = useAsync(() => api.get('/migration/status'), []);
  const localKeys = (() => { try { const k = {}; for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith('smartExpenseManager_') && !key.includes('rates') ) k[key] = localStorage.getItem(key); } return k; } catch { return {}; } })();
  const hasLocal = Boolean(localKeys.smartExpenseManager_expenses);

  const send = async (keys) => {
    setBusy(true); setError(''); setResult(null);
    try { const r = await api.post('/migration/legacy', { keys }); setResult(r.data); toast.success('Import finished.'); reload(); } catch (e) { setError(e.message + (e.details?.problems ? ` (${e.details.problems.slice(0, 3).join(' ')})` : '')); } finally { setBusy(false); }
  };
  const fromFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 5_000_000) return setError('That file is too large to be a SpendIQ backup.');
    let keys;
    try { const j = JSON.parse(await f.text()); if (!j?.keys || typeof j.keys !== 'object') throw new Error('not a backup'); keys = j.keys; }
    catch { return setError('That is not a SpendIQ backup file. In the old app choose “Download backup (JSON)”.'); }
    await send(keys);
  };
  return (
    <Panel title="Import data from the old SpendIQ" subtitle="Moves your expenses, budgets, income and warning threshold into your account. Safe to repeat: nothing is duplicated, and your old browser data is never deleted.">
      <div className="stack">
        {status?.migrated && <Banner tone="pos" icon={CheckCircle2}>Already imported on {new Date(status.lastRun).toLocaleDateString()} — {status.migratedExpenses} expenses from the old app are in your account. Running again will not add duplicates.</Banner>}
        {error && <Banner tone="neg">{error}</Banner>}
        {result && <Banner tone="pos"><strong>Done.</strong> {result.expensesImported} expenses imported, {result.expensesAlreadyPresent} already present, {result.budgets} budgets, {result.income} income entries. {result.skipped > 0 && <>{result.skipped} item(s) were skipped as invalid: {result.problems.slice(0, 3).join(' ')}</>}<div className="small" style={{ marginTop: 4 }}>{result.note}</div></Banner>}
        {hasLocal && <div className="banner banner-gold row between"><span>Old SpendIQ data was found in this browser ({JSON.parse(localKeys.smartExpenseManager_expenses || '[]').length} expenses).</span><Button size="sm" loading={busy} onClick={() => send(localKeys)}>Import it</Button></div>}
        <div className="row row-wrap"><input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={fromFile} aria-label="Backup file" /><Button variant="secondary" icon={Upload} loading={busy && !hasLocal} onClick={() => fileRef.current?.click()}>Choose backup file (.json)</Button></div>
        <p className="faint small">Open the old app (the <code>legacy/</code> folder) → <em>Move to SpendIQ AI</em> → <em>Download backup (JSON)</em>, then choose that file here.</p>
      </div>
    </Panel>
  );
}

function Security() {
  const { logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const change = async (e) => {
    e.preventDefault();
    const er = {};
    if (!pw.currentPassword) er.currentPassword = 'Enter your current password';
    const m = validatePassword(pw.newPassword); if (m) er.newPassword = m;
    setErrors(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try { await api.post('/auth/me/password', pw); toast.success('Password changed. Other devices were signed out.'); setPw({ currentPassword: '', newPassword: '' }); } catch (err) { setErrors(err.details ?? {}); toast.error(err.message); } finally { setBusy(false); }
  };
  const signOutAll = async () => { try { await api.post('/auth/logout-all'); toast.info('Signed out everywhere.'); await logout().catch(() => {}); navigate('/login'); } catch (e) { toast.error(e.message); } };
  const deleteAccount = async () => { try { await api.del('/auth/me', undefined, { password: del.password }); toast.info('Your account and data were deleted.'); await logout().catch(() => {}); navigate('/login'); } catch (e) { setDel((d) => ({ ...d, error: e.message })); } };
  return (
    <div className="stack">
      <Panel title="Change password"><form className="stack" onSubmit={change} noValidate><div className="form-grid"><TextField label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} error={errors.currentPassword} /><TextField label="New password" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} error={errors.newPassword} /></div><div><Button type="submit" loading={busy}>Update password</Button></div></form></Panel>
      <Panel title="Sessions"><p className="muted" style={{ marginBottom: 12 }}>Sign out of every device where you're logged in.</p><Button variant="secondary" onClick={signOutAll}>Sign out everywhere</Button></Panel>
      <Panel title="Delete account"><p className="muted" style={{ marginBottom: 12 }}>Permanently deletes your account, expenses, budgets, goals, receipts and chat history. This cannot be undone.</p><Button variant="danger" icon={ShieldAlert} onClick={() => setDel({ password: '' })}>Delete my account</Button></Panel>
      {del && <Modal title="Delete your account?" onClose={() => setDel(null)} footer={<><Button variant="secondary" onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" disabled={!del.password} onClick={deleteAccount}>Delete everything</Button></>}><div className="stack"><Banner tone="neg">All your data will be permanently removed.</Banner><TextField label="Confirm with your password" type="password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value, error: '' })} error={del.error} /></div></Modal>}
    </div>
  );
}

function System() {
  const toast = useToast();
  const { data, error } = useAsync(() => api.get('/system/runtime'), []);
  const restore = async () => { try { const r = await api.del('/insights/dismissed'); toast.success(`Restored ${r.data.restored} dismissed alert(s).`); } catch (e) { toast.error(e.message); } };
  return (
    <div className="stack">
      <Panel title="Alerts"><p className="muted" style={{ marginBottom: 12 }}>Dismissed an alert by mistake? Bring them all back.</p><Button variant="secondary" onClick={restore}>Restore dismissed alerts</Button></Panel>
      <Panel title="Server status" subtitle="Node.js runtime information (event loop, V8, memory)">
        {error ? <span className="neg">{error.message}</span> : !data ? <span className="muted">Loading…</span> : (
          <div className="table-wrap"><table className="table"><tbody>
            <tr><td>Node.js / V8</td><td>{data.node} / {data.v8}</td></tr><tr><td>Platform</td><td>{data.platform}</td></tr><tr><td>Uptime</td><td>{Math.round(data.uptimeSeconds / 60)} min</td></tr>
            <tr><td>Memory (RSS / heap used / limit)</td><td>{data.memoryMb.rss} / {data.memoryMb.heapUsed} / {data.memoryMb.heapLimit} MB</td></tr>
            <tr><td>Event-loop delay (mean / p99)</td><td>{data.eventLoopDelayMs.mean} / {data.eventLoopDelayMs.p99} ms</td></tr>
            <tr><td>Database</td><td><Chip tone={data.database === 'connected' ? 'pos' : 'neg'}>{data.database}</Chip></td></tr>
            <tr><td>AI assistant</td><td>{data.services.ai}</td></tr><tr><td>Receipt reader</td><td>{data.services.receiptReader}{data.services.receiptReader === 'tesseract' && (data.services.localOcrInstalled ? ' (installed)' : ' (NOT installed)')}</td></tr></tbody></table></div>)}
      </Panel>
    </div>
  );
}

export default function Settings() {
  useDocumentTitle('Settings');
  const [tab, setTab] = useState('profile');
  return (
    <>
      <PageHeader title="Settings" subtitle="Your account, income, data import and security." />
      <div className="stack">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'profile', label: 'Profile' }, { value: 'import', label: 'Import old data' }, { value: 'security', label: 'Security' }, { value: 'system', label: 'System' }]} />
        {tab === 'profile' && <Profile />}{tab === 'import' && <Migration />}{tab === 'security' && <Security />}{tab === 'system' && <System />}
      </div>
    </>
  );
}