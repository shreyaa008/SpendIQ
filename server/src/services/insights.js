// Smart alerts. Each rule needs real evidence in the user's data, has a stable key (so dismissals stick), and is capped so users are not flooded.
import { DismissedAlert } from '../models/index.js';
import { loadExpenses, budgetStatuses, groupTotals, sum } from './analytics.js';
import { getForecast } from './forecast.js';
import { upcomingOccurrences } from './recurring.js';
import { listGoals } from './goals.js';
import { shiftPeriod, periodOf, daysInPeriod, round2, todayStr, addDays, parseDay, formatDay } from '../utils/dates.js';
import { cached } from '../utils/cache.js';
import { makeFmt } from '../utils/money.js';

const niceDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
export const MAX_ALERTS = 10;

export async function getInsights(user, { today = todayStr(), includeDismissed = false } = {}) {
  const all = await cached(user._id, 'insights', { today }, () => computeInsights(user, today));
  const dismissed = includeDismissed ? new Set() : new Set((await DismissedAlert.find({ user: user._id }).select('key').lean()).map((d) => d.key));
  const visible = all.filter((a) => !dismissed.has(a.key));
  return { alerts: visible.slice(0, MAX_ALERTS), total: visible.length, dismissedCount: all.length - visible.length };
}

export async function computeInsights(user, today) {
  const inr = makeFmt(user.currency);
  const period = periodOf(today);
  const prev = shiftPeriod(period, -1);
  const d = Number(today.slice(8, 10));
  const from = `${shiftPeriod(period, -3)}-01`;
  const [expenses, forecast, goals, upcoming] = await Promise.all([
    loadExpenses(user._id, from, `${period}-${String(daysInPeriod(period)).padStart(2, '0')}`),
    getForecast(user, { today }),
    listGoals(user._id, today),
    upcomingOccurrences(user._id, today, formatDay(addDays(parseDay(today), 7)), { includeOverdue: true }),
  ]);
  const bs = await budgetStatuses(user, period, expenses);
  const alerts = [];
  const cur = expenses.filter((e) => e.period === period);
  const prevAll = expenses.filter((e) => e.period === prev);

  // 1. Budgets
  for (const b of bs) {
    if (b.status === 'exceeded') alerts.push({ key: `budget-exceeded:${b.categoryId}:${period}`, type: 'budget_exceeded', severity: 'critical', category: b.category, title: `${b.category} budget exceeded`, message: `You have spent ${inr(b.spent)} against a ${inr(b.limit)} budget, ${inr(-b.remaining)} over.`, action: { label: 'Review budget', to: '/budgets' } });
    else if (b.status === 'warning') alerts.push({ key: `budget-warning:${b.categoryId}:${period}`, type: 'budget_warning', severity: 'warning', category: b.category, title: `${b.category} is at ${Math.round(b.percent)}% of its budget`, message: `${inr(b.remaining)} left of ${inr(b.limit)}. Your alert threshold is ${b.threshold}%.`, action: { label: 'Review budget', to: '/budgets' } });
  }

  // 2. Forecast says a budget is likely to be exceeded
  for (const b of forecast.budgets) {
    if (b.risk === 'likely' && !alerts.some((a) => a.category === b.category && a.type.startsWith('budget_'))) {
      alerts.push({ key: `forecast-budget:${b.budgetId}:${period}`, type: 'forecast_budget', severity: 'warning', category: b.category, title: `${b.category} may go over budget`, message: `At the current pace ${b.category} may reach about ${inr(b.projected)} against a ${inr(b.limit)} budget (an estimate, roughly ${Math.round(b.probabilityExceed * 100)}% likely).`, action: { label: 'See forecast', to: '/forecast' } });
    }
  }

  // 3. Spending up vs last month (like-for-like days, so a part-month is never compared with a full one)
  if (d >= 5 && prevAll.length >= 3) {
    const curTotal = sum(cur.filter((e) => e.day <= today));
    const prevLike = sum(prevAll.filter((e) => Number(e.day.slice(8, 10)) <= d));
    const prevFull = sum(prevAll);
    if (prevLike > 0 && curTotal >= prevLike * 1.2 && curTotal - prevLike >= prevFull * 0.03) {
      const catDiff = groupTotals(cur, (e) => e.category).map((g) => ({ name: g.key, diff: g.total - sum(prevAll.filter((e) => e.category === g.key && Number(e.day.slice(8, 10)) <= d)) })).sort((a, b) => b.diff - a.diff)[0];
      alerts.push({ key: `mom-increase:${period}`, type: 'spending_up', severity: 'warning', title: 'Spending is higher than last month', message: `Through day ${d} you have spent ${inr(curTotal)}, up ${Math.round(((curTotal - prevLike) / prevLike) * 100)}% on the same days last month (${inr(prevLike)}).${catDiff && catDiff.diff > 0 ? ` ${catDiff.name} accounts for most of the rise (+${inr(catDiff.diff)}).` : ''}`, action: { label: 'Compare months', to: '/reports' } });
    }
  }

  // 4. Recurring payments due soon / overdue
  for (const u of upcoming.slice(0, 5)) {
    const overdue = u.date < today;
    alerts.push({ key: `recurring:${u.ruleId}:${u.date}`, type: 'recurring_due', severity: overdue ? 'warning' : 'info', title: overdue ? `${u.description} is overdue` : `${u.description} is due ${u.date === today ? 'today' : `on ${niceDay(u.date)}`}`, message: `${inr(u.amount)} (${u.frequency}). Record it when paid, or skip it.`, action: { label: 'Open recurring', to: '/recurring' } });
  }

  // 5. One category dominating spending
  const monthTotal = sum(cur);
  if (cur.length >= 8 && monthTotal > 0) {
    const top = groupTotals(cur, (e) => e.category)[0];
    if (top && top.total / monthTotal >= 0.45 && groupTotals(cur, (e) => e.category).length >= 3) {
      alerts.push({ key: `share:${top.key}:${period}`, type: 'category_share', severity: 'info', category: top.key, title: `${top.key} is ${Math.round((top.total / monthTotal) * 100)}% of this month’s spending`, message: `${inr(top.total)} of ${inr(monthTotal)} went to ${top.key}.`, action: { label: 'View transactions', to: '/transactions' } });
    }
  }

  // 6. Pattern change (category well above its own recent average)
  for (const c of forecast.currentMonth.byCategory) {
    if (c.vsUsualPct != null && c.vsUsualPct >= 50 && c.usual > 0 && !forecast.dataQuality.preliminary && !alerts.some((a) => a.category === c.category)) {
      alerts.push({ key: `pattern:${c.category}:${period}`, type: 'pattern_change', severity: 'info', category: c.category, title: `${c.category} spending is unusually high`, message: `On pace for ${inr(c.projected)} this month versus a usual ${inr(c.usual)} (an estimate).`, action: { label: 'See forecast', to: '/forecast' } });
    }
  }

  // 7. Savings goals needing attention
  for (const g of goals) {
    if (g.status === 'overdue') alerts.push({ key: `goal-overdue:${g.id}`, type: 'goal', severity: 'warning', title: `“${g.title}” passed its target date`, message: `${inr(g.saved)} of ${inr(g.targetAmount)} saved. Extend the date or add a contribution.`, action: { label: 'Open goals', to: '/goals' } });
    else if (g.requiredMonthly != null && g.onTrack === false && g.status !== 'completed') alerts.push({ key: `goal-pace:${g.id}:${period}`, type: 'goal', severity: 'info', title: `“${g.title}” needs ${inr(g.requiredMonthly)} a month`, message: `You have been setting aside about ${inr(g.recentMonthlyAverage)} a month recently. Reaching the target by ${niceDay(g.targetDate)} needs ${inr(g.requiredMonthly)}.`, action: { label: 'Open goals', to: '/goals' } });
  }

  // 8. Possible duplicates in the last 30 days
  const since = formatDay(addDays(parseDay(today), -30));
  const seen = new Map();
  for (const e of expenses.filter((x) => x.day >= since && !x.recurringRule)) {
    const k = `${e.day}|${e.amount}|${(e.merchant || e.description).toLowerCase().trim()}`;
    seen.set(k, [...(seen.get(k) ?? []), e]);
  }
  for (const [k, list] of seen) {
    if (list.length >= 2) alerts.push({ key: `dup:${k}`.slice(0, 190), type: 'duplicate', severity: 'info', title: 'Possible duplicate transaction', message: `${list.length} entries of ${inr(list[0].amount)} for “${list[0].merchant || list[0].description || list[0].category}” on ${list[0].day}.`, action: { label: 'Check transactions', to: '/transactions' } });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).map((a) => ({ ...a, period }));
}