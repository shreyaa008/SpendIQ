import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ListOrdered, ScanLine, Sparkles, TrendingUp, BarChart3, Target, PiggyBank, Repeat, Tags, Settings as Cog, LogOut, Sun, Moon, Menu, X, Wallet, ArrowLeftRight} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../api/client.js';

const NAV = [
  { label: 'Overview', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/income', label: 'Income', icon: Wallet },
    { to: '/transactions', label: 'Transactions', icon: ListOrdered },
    { to: '/scan', label: 'Scan receipt', icon: ScanLine },
    { to: '/converter', label: 'Converter', icon: ArrowLeftRight },
  ] },
  { label: 'Intelligence', items: [
    { to: '/assistant', label: 'AI assistant', icon: Sparkles },
    { to: '/forecast', label: 'Forecast', icon: TrendingUp },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
  ] },
  { label: 'Plan', items: [
    { to: '/budgets', label: 'Budgets', icon: Target },
    { to: '/goals', label: 'Savings goals', icon: PiggyBank },
    { to: '/recurring', label: 'Recurring', icon: Repeat },
    { to: '/categories', label: 'Categories', icon: Tags },
  ] },
];
const TABS = NAV[0].items;
// const TABS = [NAV[0].items[0], NAV[0].items[1], NAV[0].items[2], NAV[1].items[0]];

/** Shows a browser notification once per alert key (opt-in, with permission). In-app alerts always remain the reliable channel. */
function useBrowserNotifications(user, alerts) {
  const seen = useRef(null);
  useEffect(() => {
    if (!user?.browserNotifications || typeof Notification === 'undefined' || Notification.permission !== 'granted' || !alerts) return;
    if (seen.current === null) { try { seen.current = new Set(JSON.parse(localStorage.getItem('spendiq_notified') || '[]')); } catch { seen.current = new Set(); } }
    for (const a of alerts.filter((x) => x.severity !== 'info')) {
      if (seen.current.has(a.key)) continue;
      seen.current.add(a.key);
      try { new Notification(a.title, { body: a.message, tag: a.key }); } catch { /* some browsers only allow notifications from a service worker */ }
    }
    try { localStorage.setItem('spendiq_notified', JSON.stringify([...seen.current].slice(-200))); } catch { /* ignore */ }
  }, [user, alerts]);
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState(null);

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    let alive = true;
    api.get('/insights').then((r) => alive && setAlerts(r.data.alerts)).catch(() => {});
    return () => { alive = false; };
  }, [location.pathname]);
  useBrowserNotifications(user, alerts);

  const count = alerts?.filter((a) => a.severity !== 'info').length ?? 0;
  const doLogout = async () => { await logout(); toast.info('You have been signed out.'); navigate('/login'); };

  return (
    <div className="shell">
      <header className="mobile-bar">
        <span className="brand"><span className="brand-mark">S</span>SpendIQ</span>
        <div className="row">
          <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}>{resolved === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
          <button className="icon-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </header>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <NavLink to="/" className="brand"><span className="brand-mark">S</span><span>SpendIQ <small>AI</small></span></NavLink>
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.label} className="nav">
              <div className="nav-label">{g.label}</div>
              {g.items.map(({ to, label, icon: I, end }) => (
                <NavLink key={to} to={to} end={end}><I size={18} aria-hidden="true" />{label}{to === '/' && count > 0 && <span className="badge-dot" aria-label={`${count} alerts`}>{count}</span>}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="/settings" className="nav-link-plain" style={{ textDecoration: 'none' }}>
            <div className="user-chip"><span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span><div className="grow"><div style={{ fontWeight: 600, lineHeight: 1.2 }}>{user.name}</div><div className="faint small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div></div><Cog size={16} aria-hidden="true" color="var(--ink-3)" /></div>
          </NavLink>
          <div className="row" style={{ padding: '0 6px' }}>
            <button className="btn btn-ghost btn-sm grow" onClick={toggle}>{resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{resolved === 'dark' ? 'Light' : 'Dark'}</button>
            <button className="btn btn-ghost btn-sm grow" onClick={doLogout}><LogOut size={16} />Sign out</button>
          </div>
        </div>
      </aside>
      <main className="main" id="content"><Outlet /></main>
      <nav className="tabbar" aria-label="Quick navigation">
        {TABS.map(({ to, label, icon: I, end }) => <NavLink key={to} to={to} end={end}><I size={20} aria-hidden="true" />{label.replace('Scan receipt', 'Scan').replace('AI assistant', 'Assistant')}</NavLink>)}
        <button onClick={() => setOpen(true)}><Menu size={20} aria-hidden="true" />More</button>
      </nav>
    </div>
  );
}
