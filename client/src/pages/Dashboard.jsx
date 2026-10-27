import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ScanLine, Upload, Sparkles, ArrowUpRight, ArrowDownRight, PiggyBank, Repeat, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, Stat, PanelSkeleton, ErrorState, EmptyState, PeriodSwitcher, ProgressBar, Chip, ColorDot, Modal, Banner } from '../components/ui/index.jsx';
import ExpenseForm from '../components/ExpenseForm.jsx';
import Runway from '../components/Runway.jsx';
import AlertList from '../components/AlertList.jsx';
import { Donut, MonthBars } from '../components/charts/index.jsx';
import { currentPeriod, periodLabel, shortDay, pct, plural } from '../utils/format.js';
import { useMeta } from '../context/MetaContext.jsx';

export default function Dashboard() {
  useDocumentTitle('Dashboard');
  const { user, money } = useAuth();
  const { categories } = useMeta();
  const toast = useToast();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(currentPeriod());
  const [adding, setAdding] = useState(false);
  const { data: d, loading, error, reload } = useAsync(() => api.get('/dashboard', { period }), [period]);

  const colorOf = (name) => categories.find((c) => c.name === name)?.color ?? '#64748b';
  const create = async (body) => { await api.post('/expenses', body); setAdding(false); toast.success('Expense added.'); reload(); };

  const header = (
    <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} subtitle="Here is where your money stands." actions={<><PeriodSwitcher value={period} onChange={setPeriod} /><Button icon={Plus} onClick={() => setAdding(true)}>Add expense</Button></>} />
  );
  if (loading && !d) return <>{header}<div className="stack"><PanelSkeleton rows={2} /><div className="grid-main"><PanelSkeleton rows={6} /><PanelSkeleton rows={6} /></div></div></>;
  if (error && !d) return <>{header}<ErrorState error={error} onRetry={reload} /></>;

  const cmp = d.comparison;
  const donut = d.categories.map((c) => ({ name: c.category, value: c.total, color: colorOf(c.category) }));

  return (
    <>
      {header}
      {!d.hasAnyData ? (
        <Panel>
          <EmptyState icon={Sparkles} title="Let's get your first numbers in" action={
            <div className="row row-wrap" style={{ justifyContent: 'center' }}>
              <Button icon={Plus} onClick={() => setAdding(true)}>Add an expense</Button>
              <Button variant="secondary" icon={ScanLine} onClick={() => navigate('/scan')}>Scan a receipt</Button>
              <Button variant="secondary" icon={Upload} onClick={() => navigate('/transactions?import=1')}>Import a CSV</Button>
            </div>}>
            Everything here (forecasts, alerts, the assistant) is built from your own records. Used the old SpendIQ? <Link to="/settings">Bring your data across</Link>.
          </EmptyState>
        </Panel>
      ) : (
        <div className="stack">
          <div className="kpis">
            <div><Stat label={`Spent in ${periodLabel(period, true)}`} value={money(d.totals.spent)} sub={plural(d.totals.count, 'transaction')} /></div>
            <div><Stat label={d.totals.income != null ? 'Left from income' : 'Monthly income'} value={d.totals.income != null ? money(d.totals.balance) : '—'} tone={d.totals.balance < 0 ? 'neg' : undefined} sub={d.totals.income != null ? `of ${money(d.totals.income)}` : <Link to="/settings">Add your income</Link>} /></div>
            <div>
              <Stat label={cmp.basis === 'like_for_like' ? `vs first ${cmp.daysCompared} days of last month` : 'vs previous month'}
                value={cmp.hasPreviousData && cmp.total.changePct != null ? <span className={cmp.total.change > 0 ? 'neg' : 'pos'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{cmp.total.change > 0 ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}{pct(Math.abs(cmp.total.changePct))}</span> : '—'}
                sub={cmp.hasPreviousData ? (cmp.total.changePct == null ? 'No baseline to compare' : `${cmp.total.change > 0 ? '+' : '−'}${money(Math.abs(cmp.total.change))}`) : 'No earlier data'} /></div>
            <div><Stat label="Expected month-end" value={d.forecast.available ? money(d.forecast.projectedTotal, { compact: true }) : '—'} sub={d.forecast.available ? (d.forecast.preliminary ? 'Preliminary estimate' : 'Estimate from your history') : d.isCurrentMonth ? 'Needs a few more days of data' : 'Only for the current month'} /></div>
          </div>

          {d.isCurrentMonth && (
            <Panel title="This month's runway" subtitle={`Day ${d.forecast.daysElapsed} of ${d.forecast.daysInMonth}`} actions={<Link className="small" to="/forecast">Full forecast →</Link>}>
              <Runway spent={d.totals.spent} low={d.forecast.available ? d.forecast.low : null} high={d.forecast.available ? d.forecast.high : null} projected={d.forecast.available ? d.forecast.projectedTotal : null} preliminary={d.forecast.preliminary} />
            </Panel>
          )}

          {d.alerts.length > 0 && (
            <Panel title="Needs your attention" subtitle={d.alertCount > d.alerts.length ? `Showing ${d.alerts.length} of ${d.alertCount}` : undefined}><AlertList alerts={d.alerts} onChange={reload} /></Panel>
          )}

          <div className="grid-main">
            <div className="stack">
              <Panel title="Where it went" subtitle={periodLabel(period)}>
                {d.categories.length === 0 ? <EmptyState title="No spending in this month">Choose another month or add an expense.</EmptyState> : (
                  <div className="grid-2" style={{ alignItems: 'center' }}>
                    <Donut data={donut} />
                    <div>{d.categories.slice(0, 7).map((c) => (
                      <div className="list-row" key={c.category}><ColorDot color={colorOf(c.category)} /><span className="grow">{c.category}</span><span className="muted small">{pct(c.share)}</span><strong className="num">{money(c.total)}</strong></div>
                    ))}</div>
                  </div>
                )}
              </Panel>
              <Panel title="Last six months"><MonthBars data={d.trend} highlight={period} /></Panel>
              <Panel title="Recent transactions" actions={<Link className="small" to="/transactions">View all →</Link>}>
                {d.recent.length === 0 ? <p className="muted">Nothing recorded this month yet.</p> : d.recent.map((e) => (
                  <div className="list-row" key={e.id}><ColorDot color={colorOf(e.category)} /><div className="grow"><div style={{ fontWeight: 600 }}>{e.merchant || e.description || e.category}</div><div className="faint small">{e.category} · {e.paymentMode} · {shortDay(e.date)}</div></div><strong className="num">{money(e.amount)}</strong></div>
                ))}
              </Panel>
            </div>
            <div className="stack">
              <Panel title="Budgets" actions={<Link className="small" to="/budgets">Manage →</Link>}>
                {d.budgets.length === 0 ? <p className="muted">No budgets for this month. <Link to="/budgets">Set one</Link> to get alerts before you overspend.</p> : d.budgets.map((b) => (
                  <div key={b.id} style={{ padding: '8px 0' }}>
                    <div className="row between small"><span style={{ fontWeight: 600 }}>{b.category}</span><span className={b.status === 'exceeded' ? 'neg' : 'muted'}>{money(b.spent)} / {money(b.limit)}</span></div>
                    <ProgressBar percent={b.percent} status={b.status} label={`${b.category} budget`} />
                  </div>
                ))}
              </Panel>
              <Panel title="Savings goals" actions={<Link className="small" to="/goals">Manage →</Link>}>
                {d.goals.length === 0 ? <p className="muted">No goals yet. <Link to="/goals">Create one</Link>.</p> : d.goals.map((g) => (
                  <div key={g.id} style={{ padding: '8px 0' }}>
                    <div className="row between small"><span style={{ fontWeight: 600 }}><PiggyBank size={14} style={{ verticalAlign: -2 }} /> {g.title}</span><span className="muted">{pct(g.percent)}</span></div>
                    <ProgressBar percent={g.percent} status={g.status === 'completed' ? 'ok' : undefined} label={g.title} />
                    <div className="faint small">{money(g.saved)} of {money(g.targetAmount)}{g.requiredMonthly != null ? ` · ${money(g.requiredMonthly)}/month needed` : ''}</div>
                  </div>
                ))}
              </Panel>
              <Panel title="Coming up" actions={<Link className="small" to="/recurring">Recurring →</Link>}>
                {d.upcoming.length === 0 ? <p className="muted">No recurring payments due in the next two weeks.</p> : d.upcoming.map((u) => (
                  <div className="list-row" key={`${u.ruleId}${u.date}`}><Repeat size={16} color="var(--ink-3)" /><div className="grow"><div style={{ fontWeight: 600 }}>{u.description}</div><div className="faint small">{u.date < d.today ? <Chip tone="warn">Overdue</Chip> : shortDay(u.date)}</div></div><strong className="num">{money(u.amount)}</strong></div>
                ))}
              </Panel>
              {cmp.drivers.length > 0 && cmp.total.change > 0 && (
                <Banner tone="gold" icon={Sparkles}>Biggest increase vs last month: <strong>{cmp.drivers[0].category}</strong> (+{money(cmp.drivers[0].change)}). <Link to="/assistant">Ask the assistant why →</Link></Banner>
              )}
              {d.alerts.length === 0 && d.hasAnyData && <Banner tone="pos" icon={CheckCircle2}>No alerts right now. Nothing needs attention.</Banner>}
            </div>
          </div>
        </div>
      )}
      {adding && <Modal title="Add expense" onClose={() => setAdding(false)}><ExpenseForm onSubmit={create} onCancel={() => setAdding(false)} /></Modal>}
    </>
  );
}