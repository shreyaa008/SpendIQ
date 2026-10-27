import { Link } from 'react-router-dom';
import { Info, TrendingUp, TrendingDown, Minus, AlertTriangle, Lightbulb } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Panel, PageHeader, PanelSkeleton, ErrorState, Stat, Chip, Banner, ColorDot, EmptyState } from '../components/ui/index.jsx';
import Runway from '../components/Runway.jsx';
import { ForecastPath, ExpectedActual, HistoryForecast } from '../components/charts/index.jsx';
import { pct } from '../utils/format.js';

const Trend = ({ dir, change }) => {
  if (dir === 'increasing') return <Chip tone="neg"><TrendingUp size={12} />rising{change != null ? ` ${change > 0 ? '+' : ''}${Math.round(change)}%` : ''}</Chip>;
  if (dir === 'decreasing') return <Chip tone="pos"><TrendingDown size={12} />falling{change != null ? ` ${Math.round(change)}%` : ''}</Chip>;
  if (dir === 'stable') return <Chip><Minus size={12} />stable</Chip>;
  return <Chip>not enough data</Chip>;
};
const RISK = { exceeded: ['neg', 'Exceeded'], likely: ['neg', 'Likely to exceed'], possible: ['warn', 'Could exceed'], unlikely: ['pos', 'Unlikely to exceed'] };

export default function Forecast() {
  useDocumentTitle('Forecast');
  const { money: fmt } = useAuth();
  const money = (n, o) => fmt(n, { decimals: 0, ...o });
  const { data: f, loading, error, reload } = useAsync(() => api.get('/forecast'), []);
  const header = <PageHeader title="Expense forecast" subtitle={f ? `${f.label} and the months ahead` : 'Estimates from your own spending history'} />;
  if (error) return <>{header}<ErrorState error={error} onRetry={reload} /></>;
  if (loading && !f) return <>{header}<div className="stack"><PanelSkeleton rows={3} /><PanelSkeleton rows={6} /></div></>;

  const c = f.currentMonth;
  const q = f.dataQuality;
  return (
    <>
      {header}
      <div className="stack">
        <Banner tone="gold" icon={Info}><strong>These are estimates, not guarantees.</strong> {f.disclaimer} {q.preliminary && <>There is limited history so this is a <strong>preliminary</strong> estimate.</>} <Chip tone={q.confidence === 'high' ? 'pos' : q.confidence === 'medium' ? 'warn' : 'neg'}>{q.confidence} confidence</Chip> <span className="faint small">based on {q.completedMonths} completed month{q.completedMonths === 1 ? '' : 's'} and {q.transactions} transactions</span>{q.notes.map((n) => <div key={n} className="small" style={{ marginTop: 4 }}>{n}</div>)}</Banner>

        {!c.canProject ? (
          <Panel><EmptyState icon={TrendingUp} title="Not enough data to project this month yet" action={<Link className="btn" to="/transactions">Add expenses</Link>}>Add a few days of expenses or import past months and the forecast will appear. Nothing is made up in the meantime.</EmptyState></Panel>
        ) : (
          <>
            <div className="kpis">
              <div><Stat label="Spent so far" value={money(c.actualToDate)} sub={`Day ${c.daysElapsed} of ${c.daysInMonth}`} /></div>
              <div><Stat label="Expected month-end" value={money(c.projectedTotal)} sub={`Likely ${money(c.low, { compact: true })}–${money(c.high, { compact: true })}`} /></div>
              <div><Stat label="Still to come" value={money(c.projectedTotal - c.actualToDate - c.loggedFuture)} sub={`${money(c.recurringRemaining)} recurring + ${money(c.discretionaryRemaining)} everyday`} /></div>
              <div><Stat label={c.income != null ? 'Projected balance' : 'Daily pace'} value={c.income != null ? money(c.projectedBalance) : money(c.paceDaily)} tone={c.projectedBalance < 0 ? 'neg' : undefined} sub={c.income != null ? `income ${money(c.income)}` : c.usualDaily != null ? `usual ${money(c.usualDaily)}/day` : 'per day this month'} /></div>
            </div>
            <Panel title="Month runway"><Runway spent={c.actualToDate} low={c.low} high={c.high} projected={c.projectedTotal} preliminary={q.preliminary} /></Panel>
            <Panel title="Spending through the month" subtitle="Solid line = what you've spent. Dashed = estimate; shaded band = 80% likely range."><ForecastPath path={c.path} /></Panel>
            <div className="grid-2">
              <Panel title="Why this estimate"><ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>{f.factors.map((x) => <li key={x}>{x}</li>)}</ul></Panel>
              <Panel title="Where to pay attention">
                {f.attention.length === 0 ? <p className="muted">No category stands out right now.</p> : f.attention.map((a) => <div className="list-row" key={a.category}><AlertTriangle size={16} color="var(--warn)" /><div className="grow"><strong>{a.category}</strong><div className="muted small">{a.reason}</div></div></div>)}
                {f.suggestions.length > 0 && <div style={{ marginTop: 12 }} className="stack-sm">{f.suggestions.map((s) => <Banner key={s.category} tone="gold" icon={Lightbulb}>{s.message}</Banner>)}</div>}
              </Panel>
            </div>
            <Panel flat title="Category outlook" subtitle="Projected month-end vs your recent monthly average">
              <div className="table-wrap"><table className="table"><thead><tr><th>Category</th><th className="right">So far</th><th className="right">Projected</th><th className="right">Usual</th><th>Trend</th></tr></thead><tbody>
                {c.byCategory.filter((x) => x.projected > 0).map((x) => <tr key={x.category}><td><span className="row" style={{ gap: 8 }}><ColorDot color={x.color} />{x.category}</span></td><td className="right num">{money(x.actual)}</td><td className="right num"><strong>{money(x.projected)}</strong>{x.vsUsualPct != null && Math.abs(x.vsUsualPct) >= 15 && <span className={x.vsUsualPct > 0 ? 'neg small' : 'pos small'}> {x.vsUsualPct > 0 ? '+' : ''}{Math.round(x.vsUsualPct)}%</span>}</td><td className="right num">{x.usual != null ? money(x.usual) : '—'}</td><td><Trend dir={x.trend} change={x.trendChangePct} /></td></tr>)}</tbody></table></div>
            </Panel>
          </>
        )}

        {f.budgets.length > 0 && (
          <Panel flat title="Budget outlook" subtitle="Chance of exceeding each budget by month end (estimate)">
            <div className="table-wrap"><table className="table"><thead><tr><th>Budget</th><th className="right">Spent</th><th className="right">Limit</th><th className="right">Projected</th><th>Outlook</th></tr></thead><tbody>
              {f.budgets.map((b) => { const [tone, label] = RISK[b.risk]; return <tr key={b.budgetId}><td>{b.category}</td><td className="right num">{money(b.spent)}</td><td className="right num">{money(b.limit)}</td><td className="right num">{money(b.projected)}</td><td><Chip tone={tone}>{label}{b.risk !== 'exceeded' ? ` · ~${Math.round(b.probabilityExceed * 100)}%` : ''}</Chip></td></tr>; })}</tbody></table></div>
          </Panel>
        )}

        <div className="grid-main">
          <Panel title="History and next months"><HistoryForecast history={f.history} next={f.nextMonths} /></Panel>
          <Panel title="Next three months">
            {f.nextMonths.map((n) => <div key={n.period} style={{ padding: '8px 0' }} className="list-row"><div className="grow"><strong>{n.label}</strong><div className="faint small">{n.total != null ? `${money(n.low, { compact: true })}–${money(n.high, { compact: true })} · incl. ${money(n.recurring)} recurring` : n.basis}</div></div><strong className="num">{n.total != null ? money(n.total) : '—'}</strong></div>)}
            <div className="faint small" style={{ marginTop: 8 }}>Basis: {f.nextMonths[0].basis}.</div>
          </Panel>
        </div>

        <Panel title="Expected vs actual" subtitle={f.expectedVsActual.mape != null ? `Walk-forward test: on average the model was off by ${f.expectedVsActual.mape}% for past months` : 'Needs at least three months of history'}>
          {f.expectedVsActual.rows.length === 0 && !c.canProject ? <p className="muted">Not enough history yet.</p> : <ExpectedActual rows={f.expectedVsActual.rows} current={{ period: f.period, expected: c.projectedTotal, actualSoFar: c.actualToDate }} />}
        </Panel>

        <Panel title="Savings outlook">
          {f.savingsOutlook.expectedSavings != null ? <p>Next month you could save about <strong>{money(f.savingsOutlook.expectedSavings)}</strong> ({money(f.savingsOutlook.income)} income − {money(f.savingsOutlook.expectedSpending)} estimated spending).</p> : <p className="muted">{f.savingsOutlook.note} <Link to="/settings">Settings</Link></p>}
          {f.savingsOutlook.expectedSavings != null && <p className="faint small">{f.savingsOutlook.note}</p>}
        </Panel>

        <details className="panel"><summary style={{ cursor: 'pointer', fontWeight: 600 }}>How the forecast works</summary>
          <div className="stack-sm" style={{ marginTop: 10 }}>{Object.entries(f.method).map(([k, v]) => <p key={k} className="muted small">{v}</p>)}</div></details>
      </div>
    </>
  );
}