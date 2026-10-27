import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, TextField, SelectField, Banner } from '../components/ui/index.jsx';
import { isEmail, validatePassword } from '../utils/validate.js';
import { CURRENCIES } from '../utils/format.js';
import { useDocumentTitle } from '../hooks/index.js';
import { AuthArt } from './Login.jsx';

export default function Register() {
  useDocumentTitle('Create account');
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', currency: 'INR' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const v = {};
    if (form.name.trim().length < 2) v.name = 'Enter your name';
    if (!isEmail(form.email)) v.email = 'Enter a valid email address';
    const pw = validatePassword(form.password);
    if (pw) v.password = pw;
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true); setFormError('');
    try { await register({ ...form, name: form.name.trim(), email: form.email.trim() }); navigate('/', { replace: true }); }
    catch (err) { setFormError(err.message); setErrors(err.details ?? {}); }
    finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <AuthArt />
      <div className="auth-form">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div><h1>Create your workspace</h1><p className="muted" style={{ marginTop: 6 }}>Free, private, and ready in a minute.</p></div>
          {formError && <Banner tone="neg">{formError}</Banner>}
          <TextField label="Name" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} autoFocus />
          <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
          <TextField label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="At least 8 characters with a letter and a number." />
          <SelectField label="Currency" value={form.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          <Button type="submit" block loading={busy}>Create account</Button>
          <p className="muted small">Already have an account? <Link to="/login">Sign in</Link></p>
        </form>
      </div>
    </div>
  );
}
