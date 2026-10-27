import { RecurringRule } from '../models/index.js';
import { loadExpenses, groupTotals, sum, dailySeries, weeklySeries, budgetStatuses, compareMonths, getIncome, effectiveBudgets, summarizeExpenses } from './analytics.js';
import { getForecast, isRecurringLike } from './forecast.js';
import { listGoals } from './goals.js';
import { upcomingOccurrences, scheduledForPeriod } from './recurring.js';
import { getInsights } from './insights.js';
import { periodOf, shiftPeriod, daysInPeriod, periodLabel, todayStr, round2, addDays, parseDay, formatDay } from '../utils/dates.js';
import { quantile, median } from '../utils/stats.js';

const lastDay = (p) => `${p}-${String(daysInPeriod(p)).padStart(2, '0')}`;

/** Transactions that are large for this user: above the usual spread of the last 6 months, or ≥3× their category's median. */
export function findUnusual(monthExpenses, history) {
  const amounts = history.map((e) => e.amount);
  const q3 = quantile(amounts, 0.75);
  const iqr = q3 - quantile(amounts, 0.25);
  const globalCut = amounts.length >= 15 && iqr > 0 ? q3 + 1.5 * iqr : Infinity;
  const byCat = new Map();
  for (const e of history) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e.amount]);
  return monthExpenses
    .map((e) => {
      const list = byCat.get(e.category) ?? [];
      const med = list.length >= 5 ? median(list) : null;
      const reasons = [];
      if (e.amount > globalCut) reasons.push('much larger than your typical transaction');
      if (med && e.amount >= med * 3 && e.amount > globalCut * 0.5) reasons.push(`over 3× your usual ${e.category} purchase`);
      return reasons.length ? { ...e, reasons } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
}

export async function buildMonthlyReport(user, period, today = todayStr()) {
  const from = `${shiftPeriod(period, -6)}-01`;
  const expenses = await loadExpenses(user._id, from, lastDay(period));
  const cur = expenses.filter((e) => e.period === period);
  const history = expenses.filter((e) => e.period < period);
  const isCurrent = periodOf(today) === period;
  const isFuture = period > periodOf(today);
  const [income, budgets, prevBudgets, goals, rules, forecast] = await Promise.all([
    getIncome(user._id, period),
    budgetStatuses(user, period, expenses),
    budgetStatuses(user, shiftPeriod(period, -1), expenses),
    listGoals(user._id, today),
    RecurringRule.find({ user: user._id }).populate('category', 'name').lean(),
    getForecast(user, { today }),
  ]);
  const total = sum(cur);
  const daily = dailySeries(cur, period, isCurrent ? today : null);
  const rulesInReport = rules.map((r) => ({ id: String(r._id), description: r.description, amount: r.amount, frequency: r.frequency, status: r.status, category: r.category?.name ?? '' }));
  const recurringPaid = cur.filter((e) => isRecurringLike(e, rules));
  const scheduled = isCurrent || isFuture ? await scheduledForPeriod(user._id, period) : { total: 0, items: [] };
  const comparison = compareMonths({ expenses, period, today, budgets, prevBudgets });
  const btRow = forecast.expectedVsActual.rows.find((r) => r.period === period);

  const summary = {
    total, count: cur.length, average: cur.length ? round2(total / cur.length) : 0,
    dailyAverage: round2(total / (isCurrent ? Number(today.slice(8, 10)) : daysInPeriod(period))),
    highest: summarizeExpenses(cur).highest,
    income,
    netCashFlow: income != null ? round2(income - total) : null,
    savingsRate: income != null && income > 0 ? round2(((income - total) / income) * 100) : null,
    incomeNote: income == null ? 'No income has been entered for this month, so net cash flow and savings rate are not shown.' : isCurrent ? 'The month is not over; net cash flow reflects spending so far.' : null,
  };

  return {
    period, label: periodLabel(period), isCurrentMonth: isCurrent, isFutureMonth: isFuture, generatedAt: new Date().toISOString(),
    summary,
    byCategory: groupTotals(cur, (e) => e.category).map((g) => ({ category: g.key, total: g.total, count: g.count, share: total ? round2((g.total / total) * 100) : 0 })),
    byPaymentMode: groupTotals(cur, (e) => e.paymentMode).map((g) => ({ paymentMode: g.key, total: g.total, count: g.count, share: total ? round2((g.total / total) * 100) : 0 })),
    daily, weekly: weeklySeries(daily),
    budgets,
    goals: goals.map((g) => ({ id: g.id, title: g.title, saved: g.saved, targetAmount: g.targetAmount, percent: g.percent, status: g.status, requiredMonthly: g.requiredMonthly })),
    recurring: { rules: rulesInReport, paidThisMonth: sum(recurringPaid), paidCount: recurringPaid.length, stillScheduled: scheduled.total, scheduledItems: scheduled.items },
    largest: [...cur].sort((a, b) => b.amount - a.amount).slice(0, 10).map(({ id, day, amount, description, merchant, category, paymentMode }) => ({ id, date: day, amount, description, merchant, category, paymentMode })),
    unusual: findUnusual(cur, history).map(({ id, day, amount, description, merchant, category, reasons }) => ({ id, date: day, amount, description, merchant, category, reasons })),
    comparison,
    forecast: {
      projectedTotal: isCurrent ? forecast.currentMonth.projectedTotal : null,
      range: isCurrent ? { low: forecast.currentMonth.low, high: forecast.currentMonth.high } : null,
      expectedForPastMonth: !isCurrent && btRow ? { expected: btRow.expected, actual: btRow.actual, errorPct: btRow.errorPct } : null,
      preliminary: forecast.dataQuality.preliminary,
    },
    notes: [
      ...(cur.length === 0 ? ['No expenses are recorded for this month.'] : []),
      ...(isCurrent ? [`This month is in progress (day ${Number(today.slice(8, 10))} of ${daysInPeriod(period)}), so totals are partial.`] : []),
    ],
  };
}

export async function buildDashboard(user, period, today = todayStr()) {
  const months = Array.from({ length: 6 }, (_, i) => shiftPeriod(period, i - 5));
  const expenses = await loadExpenses(user._id, `${months[0]}-01`, lastDay(period));
  const cur = expenses.filter((e) => e.period === period);
  const isCurrent = periodOf(today) === period;
  const [income, budgets, goals, upcoming, insights, forecast] = await Promise.all([
    getIncome(user._id, period),
    budgetStatuses(user, period, expenses),
    listGoals(user._id, today),
    upcomingOccurrences(user._id, today, formatDay(addDays(parseDay(today), 14)), { includeOverdue: true }),
    getInsights(user, { today }),
    getForecast(user, { today }),
  ]);
  const total = sum(cur);
  const comparison = compareMonths({ expenses, period, today, budgets });
  const catTotals = groupTotals(cur, (e) => e.category);
  return {
    period, label: periodLabel(period), isCurrentMonth: isCurrent, today,
    totals: { spent: total, count: cur.length, average: cur.length ? round2(total / cur.length) : 0, income, balance: income != null ? round2(income - total) : null, highest: summarizeExpenses(cur).highest },
    categories: catTotals.map((g) => ({ category: g.key, total: g.total, count: g.count, share: total ? round2((g.total / total) * 100) : 0 })),
    trend: months.map((p) => ({ period: p, label: periodLabel(p).split(' ')[0].slice(0, 3), total: sum(expenses.filter((e) => e.period === p)) })),
    recent: [...cur].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 6).map(({ id, day, amount, description, merchant, category, paymentMode }) => ({ id, date: day, amount, description, merchant, category, paymentMode })),
    budgets: budgets.slice(0, 6),
    goals: goals.slice(0, 3),
    upcoming: upcoming.slice(0, 5),
    alerts: insights.alerts.slice(0, 4),
    alertCount: insights.total,
    comparison: { total: comparison.total, basis: comparison.basis, daysCompared: comparison.daysCompared, hasPreviousData: comparison.hasPreviousData, drivers: comparison.drivers },
    forecast: { available: isCurrent && forecast.currentMonth.canProject, projectedTotal: forecast.currentMonth.projectedTotal, low: forecast.currentMonth.low, high: forecast.currentMonth.high, preliminary: forecast.dataQuality.preliminary, path: isCurrent ? forecast.currentMonth.path : [], daysElapsed: forecast.currentMonth.daysElapsed, daysInMonth: forecast.currentMonth.daysInMonth },
    hasAnyData: expenses.length > 0,
  };
}

export async function budgetLimitTotal(userId, period) {
  return (await effectiveBudgets(userId, period)).reduce((t, b) => t + b.limit, 0);
}