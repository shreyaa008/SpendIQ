import { useState } from 'react';
import { Download, Printer, ArrowUpRight, ArrowDownRight, Minus, Info } from 'lucide-react';
import { api } from '../api/client.js';
import { useAsync, useDocumentTitle } from '../hooks/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Button, Panel, PageHeader, PeriodSwitcher, PanelSkeleton, ErrorState, Stat, ProgressBar, Chip, Banner, ColorDot, Tabs } from '../components/ui/index.jsx';
import { Donut, DailyBars, CompareBars } from '../components/charts/index.jsx';
import { currentPeriod, periodLabel, shiftPeriod, pct, formatDay, shortDay } from '../utils/format.js';

const Change = ({ value, pctValue, money, invert }) => {
  if (value === 0) return <span className="faint"><Minus size={12} /> no change</span>;
  const up = value > 0;
  const bad = invert ? !up : up;
  return <span className={bad ? 'neg' : 'pos'} style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>{up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{money(Math.abs(value))}{pctValue != null ? ` (${pctValue > 0 ? '+' : ''}${pctValue}%)` : <span className="faint small"> · no baseline %</span>}</span>;
};

export default function Reports() {
  useDocumentTitle('Reports');
  const { money } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState(currentPeriod());
  const [tab, setTab] = useState('overview');
  const { data: r, loading, error, reload } = useAsync(() => api.get('/reports/monthly', { period }), [period]);

  const exportCsv = async () => { try { await api.download('/reports/monthly.csv', { period }, `spendiq-report-${period}.csv`); } catch (e) { toast.error(e.message); } };
  const header = <PageHeader title="Monthly report" subtitle={periodLabel(period)} actions={<><PeriodSwitcher value={period} onChange={setPeriod} /><Button variant="secondary" icon={Download} onClick={exportCsv}>CSV</Button><Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print / PDF</Button></>} />;
  if (error) return <>{header}<ErrorState error={error} onRetry={reload} /></>;
  if (loading && !r) return <>{header}<div className="stack"><PanelSkeleton rows={2} /><PanelSkeleton rows={6} /></div></>;

  const c = r.comparison;
  const s = r.summary;
  const prevLabel = periodLabel(shiftPeriod(period, -1));
  return (
    <>
      {header}
      <div className="stack">
        {r.notes.map((n) => <Banner key={n} icon={Info}>{n}</Banner>)}
        <div className="kpis">
          <div><Stat label="Total expenses" value={money(s.total)} sub={`${s.count} transactions`} /></div>
          <div><Stat label="Income" value={s.income != null ? money(s.income) : '—'} sub={s.income == null ? 'Not entered' : undefined} /></div>
          <div><Stat label="Net cash flow" value={s.netCashFlow != null ? money(s.netCashFlow) : '—'} tone={s.netCashFlow < 0 ? 'neg' : undefined} sub={s.savingsRate != null ? `${s.savingsRate}% of income kept` : 'Needs income'} /></div>
          <div><Stat label="Daily average" value={money(s.dailyAverage)} sub={s.highest ? `Largest: ${money(s.highest.amount)}` : undefined} /></div>
        </div>
        {s.incomeNote && <p className="faint small">{s.incomeNote}</p>}
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'overview', label: 'Overview' }, { value: 'compare', label: 'Month vs month' }, { value: 'budgets', label: 'Budgets & goals' }, { value: 'transactions', label: 'Notable transactions' }]} />

        {tab === 'overview' && (
          <>
            <div className="grid-2">
              <Panel title="By category">
                {r.byCategory.length === 0 ? <p className="muted">No spending this month.</p> : <><Donut data={r.byCategory.map((x) => ({ name: x.category, value: x.total, color: x.color }))} />{r.byCategory.map((x) => <div className="list-row" key={x.category}><ColorDot color={x.color} /><span className="grow">{x.category}</span><span className="muted small">{x.count} · {pct(x.share)}</span><strong className="num">{money(x.total)}</strong></div>)}</>}
              </Panel>
              <Panel title="By payment mode">
                {r.byPaymentMode.length === 0 ? <p className="muted">No spending this month.</p> : r.byPaymentMode.map((x) => <div key={x.paymentMode} style={{ padding: '8px 0' }}><div className="row between small"><span style={{ fontWeight: 600 }}>{x.paymentMode}</span><span className="muted">{money(x.total)} · {pct(x.share)}</span></div><ProgressBar percent={x.share} label={x.paymentMode} /></div>)}
              </Panel>
            </div>
            <Panel title="Daily spending" subtitle="Each bar is one day of the month"><DailyBars data={r.daily.filter((d) => !d.future)} /></Panel>
            <div className="grid-2">
              <Panel title="Weekly trend">{r.weekly.map((w) => <div key={w.label} className="list-row"><span className="grow">{w.label}</span><strong className="num">{money(w.total)}</strong></div>)}</Panel>
              <Panel title="Recurring">
                <p>Recorded this month: <strong>{money(r.recurring.paidThisMonth)}</strong> <span className="muted">({r.recurring.paidCount} payments)</span></p>
                {(r.isCurrentMonth || r.isFutureMonth) && <p>Still scheduled: <strong>{money(r.recurring.stillScheduled)}</strong></p>}
                {r.recurring.rules.filter((x) => x.status === 'active').slice(0, 6).map((x) => <div className="list-row small" key={x.id}><span className="grow">{x.description}</span><span className="muted">{x.frequency}</span><span className="num">{money(x.amount)}</span></div>)}
                {r.recurring.rules.length === 0 && <p className="muted">No recurring rules.</p>}
              </Panel>
            </div>
            {(r.forecast.projectedTotal != null || r.forecast.expectedForPastMonth) && (
              <Panel title="Forecast vs actual">
                {r.forecast.projectedTotal != null ? <p>Expected month-end: <strong>{money(r.forecast.projectedTotal)}</strong> ({money(r.forecast.range.low)}–{money(r.forecast.range.high)}); spent so far <strong>{money(s.total)}</strong>.{r.forecast.preliminary && <> <Chip tone="gold">preliminary</Chip></>}</p>
                  : <p>Based on the months before it, this month was expected to be about <strong>{money(r.forecast.expectedForPastMonth.expected)}</strong>; actual was <strong>{money(r.forecast.expectedForPastMonth.actual)}</strong>{r.forecast.expectedForPastMonth.errorPct != null && <> ({r.forecast.expectedForPastMonth.errorPct > 0 ? 'over-estimated' : 'under-estimated'} by {Math.abs(r.forecast.expectedForPastMonth.errorPct)}%)</>}.</p>}
              </Panel>
            )}
          </>
        )}

        {tab === 'compare' && (
          <>
            {!c.hasPreviousData ? <Banner tone="gold">There is no spending recorded for {prevLabel}, so there is nothing to compare against. Percent changes are not shown when the baseline is zero.</Banner> : (
              <>
                {c.basis === 'like_for_like' && <Banner icon={Info}>{periodLabel(period)} is still in progress, so it is compared with the first {c.daysCompared} days of {prevLabel} ({money(c.total.previous)}). {prevLabel} finished at {money(c.previousFullMonthTotal)}.</Banner>}
                <Panel title="Total spending">
                  <div className="grid-3">
                    <Stat label={periodLabel(period)} value={money(c.total.current)} />
                    <Stat label={c.basis === 'like_for_like' ? `${prevLabel} (same days)` : prevLabel} value={money(c.total.previous)} />
                    <Stat label="Change" value={<Change value={c.total.change} pctValue={c.total.changePct} money={money} />} />
                  </div>
                </Panel>
                <div className="grid-main">
                  <Panel title="Categories"><CompareBars rows={c.categories} current={periodLabel(period, true)} previous={prevLabel.split(' ')[0].slice(0, 3)} /></Panel>
                  <Panel title="What drove the change">
                    {c.drivers.length === 0 ? <p className="muted">No category increased.</p> : <>
                      <p className="muted small">Categories contributing most to the increase:</p>
                      {c.drivers.map((d) => <div className="list-row" key={d.category}><span className="grow"><strong>{d.category}</strong><div className="faint small">{d.previous === 0 ? 'Nothing last month' : `${money(d.previous)} → ${money(d.current)}`}</div></span><span className="neg">+{money(d.change)}{d.shareOfIncrease != null && <span className="faint small"> · {Math.round(d.shareOfIncrease)}% of rise</span>}</span></div>)}
                      <Banner tone="gold">{c.drivers[0].category} is the biggest contributor. Review those entries, and consider a budget for it.</Banner></>}
                  </Panel>
                </div>
                <Panel flat title="Category detail"><div className="table-wrap"><table className="table"><thead><tr><th>Category</th><th className="right">This month</th><th className="right">Previous</th><th className="right">Change</th></tr></thead><tbody>
                  {c.categories.map((x) => <tr key={x.category}><td>{x.category}</td><td className="right num">{money(x.current)}</td><td className="right num">{money(x.previous)}</td><td className="right"><Change value={x.change} pctValue={x.changePct} money={money} /></td></tr>)}</tbody></table></div></Panel>
                <Panel flat title="Payment modes"><div className="table-wrap"><table className="table"><thead><tr><th>Mode</th><th className="right">This month</th><th className="right">Previous</th><th className="right">Change</th></tr></thead><tbody>
                  {c.payments.map((x) => <tr key={x.paymentMode}><td>{x.paymentMode}</td><td className="right num">{money(x.current)}</td><td className="right num">{money(x.previous)}</td><td className="right"><Change value={x.change} pctValue={x.changePct} money={money} /></td></tr>)}</tbody></table></div></Panel>
                {c.budgets.length > 0 && <Panel flat title="Budget performance"><div className="table-wrap"><table className="table"><thead><tr><th>Category</th><th className="right">Budget used now</th><th className="right">Last month</th></tr></thead><tbody>
                  {c.budgets.map((b) => <tr key={b.category}><td>{b.category}</td><td className="right">{pct(b.percent)} of {money(b.limit)}</td><td className="right">{b.previousPercent != null ? pct(b.previousPercent) : <span className="faint">no budget</span>}</td></tr>)}</tbody></table></div></Panel>}
              </>
            )}
            {s.income != null && <p className="muted small">Income for this month: {money(s.income)}. Income comparison needs income entered for both months.</p>}
          </>
        )}

        {tab === 'budgets' && (
          <div className="grid-2">
            <Panel title="Budget vs actual">{r.budgets.length === 0 ? <p className="muted">No budgets for this month.</p> : r.budgets.map((b) => <div key={b.id} style={{ padding: '8px 0' }}><div className="row between small"><strong>{b.category}</strong><span className={b.status === 'exceeded' ? 'neg' : 'muted'}>{money(b.spent)} / {money(b.limit)}</span></div><ProgressBar percent={b.percent} status={b.status} label={b.category} /></div>)}</Panel>
            <Panel title="Savings goals">{r.goals.length === 0 ? <p className="muted">No goals yet.</p> : r.goals.map((g) => <div key={g.id} style={{ padding: '8px 0' }}><div className="row between small"><strong>{g.title}</strong><span className="muted">{money(g.saved)} / {money(g.targetAmount)}</span></div><ProgressBar percent={g.percent} label={g.title} /></div>)}</Panel>
          </div>
        )}

        {tab === 'transactions' && (
          <div className="grid-2">
            <Panel title="Largest transactions">{r.largest.length === 0 ? <p className="muted">None.</p> : r.largest.map((t) => <div className="list-row" key={t.id}><div className="grow"><div style={{ fontWeight: 600 }}>{t.merchant || t.description || t.category}</div><div className="faint small">{t.category} · {shortDay(t.date)}</div></div><strong className="num">{money(t.amount)}</strong></div>)}</Panel>
            <Panel title="Unusual spending" subtitle="Large compared with your usual pattern">{r.unusual.length === 0 ? <p className="muted">Nothing stood out. This needs a few months of history to judge.</p> : r.unusual.map((t) => <div className="list-row" key={t.id}><div className="grow"><div style={{ fontWeight: 600 }}>{t.merchant || t.description || t.category}</div><div className="faint small">{formatDay(t.date)} · {t.reasons.join('; ')}</div></div><strong className="num">{money(t.amount)}</strong></div>)}</Panel>
          </div>
        )}
      </div>
    </>
  );
}