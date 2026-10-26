import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { TrendingUp, ScanLine, Sparkles, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, TextField, Banner } from '../components/ui/index.jsx';
import { isEmail } from '../utils/validate.js';
import { useDocumentTitle } from '../hooks/index.js';

export function AuthArt() {
  return (
    <div className="auth-art">
      <span className="brand" style={{ color: 'inherit' }}><span className="brand-mark" style={{ background: 'rgba(255,255,255,.18)' }}>S</span>SpendIQ AI</span>
      <div className="stack-lg"><h1>Know where your money went, and where it's going.</h1>
        <ul><li><TrendingUp size={18} />Forecasts built from your own spending</li><li><ScanLine size={18} />Scan receipts, review, save</li><li><Sparkles size={18} />Ask your finances questions in plain English</li><li><ShieldCheck size={18} />Private to your account</li></ul></div>
      <span className="small" style={{ opacity: .75 }}>Estimates are based on your history and are not financial advice.</span>
    </div>
  );
}

// Topic 47/48: a controlled form with client-side validation and server error display.
export default function Login() {
  useDocumentTitle('Sign in');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const v = {};
    if (!isEmail(form.email)) v.email = 'Enter a valid email address';
    if (!form.password) v.password = 'Enter your password';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true); setFormError('');
    try { await login(form.email.trim(), form.password); navigate(location.state?.from && location.state.from !== '/login' ? location.state.from : '/', { replace: true }); }
    catch (err) { setFormError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <AuthArt />
      <div className="auth-form">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div><h1>Welcome back</h1><p className="muted" style={{ marginTop: 6 }}>Sign in to your SpendIQ workspace.</p></div>
          {formError && <Banner tone="neg">{formError}</Banner>}
          <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} autoFocus />
          <TextField label="Password" type="password" autoComplete="current-password" value={form.password} onChange={set('password')} error={errors.password} />
          <Button type="submit" block loading={busy}>Sign in</Button>
          <p className="muted small">New here? <Link to="/register">Create an account</Link></p>
        </form>
      </div>
    </div>
  );
}