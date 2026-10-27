// Expense forecasting. Everything here is an *estimate* derived from the user's own history; nothing is guaranteed.
import { RecurringRule } from '../models/index.js';
import { loadExpenses, effectiveBudgets, getIncome, groupTotals, sum, getCategoryMap } from './analytics.js';
import { scheduledForPeriod } from './recurring.js';
import { shiftPeriod, periodOf, daysInPeriod, round2, periodsBetween, periodLabel, todayStr, periodRange, formatDay } from '../utils/dates.js';
import { mean, sd, variance, quantile, median, ewma, theilSen, normalCdf } from '../utils/stats.js';
import { cached } from '../utils/cache.js';
import { makeFmt } from '../utils/money.js';

const HISTORY_MONTHS = 7;
const SHRINK_DAYS = 7; // how many "pseudo-days" of historical pace are blended with this month's pace
const Z80 = 1.2816;

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function isRecurringLike(e, rules) {
  if (e.recurringRule) return true;
  const d = norm(e.description || e.merchant);
  if (!d) return false;
  return rules.some((r) => {
    const rd = norm(r.description);
    return rd && (d === rd || d.includes(rd) || rd.includes(d)) && Math.abs(e.amount - r.amount) <= r.amount * 0.05;
  });
}

/** Amount above which a one-off is treated as unusual (kept in actuals, excluded from "normal pace"). */
export function outlierThreshold(amounts) {
  if (amounts.length < 15) return Infinity;
  const q1 = quantile(amounts, 0.25);
  const q3 = quantile(amounts, 0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return Infinity;
  return Math.max(q3 + 3 * iqr, 3 * median(amounts));
}

export function directionOf(series) {
  // series: chronological monthly totals of complete months
  if (series.length < 2) return { direction: 'insufficient', changePct: null, recentAvg: series[0] ?? 0, priorAvg: null };
  const recent = series.slice(-Math.min(3, Math.ceil(series.length / 2)));
  const prior = series.slice(0, series.length - recent.length).slice(-3);
  if (!prior.length) return { direction: 'insufficient', changePct: null, recentAvg: mean(recent), priorAvg: null };
  const r = mean(recent);
  const p = mean(prior);
  const changePct = p > 0 ? ((r - p) / p) * 100 : null;
  let direction = 'stable';
  if (changePct == null) direction = r > 0 ? 'increasing' : 'stable';
  else if (changePct >= 12) direction = 'increasing';
  else if (changePct <= -12) direction = 'decreasing';
  return { direction, changePct: changePct == null ? null : round2(changePct), recentAvg: round2(r), priorAvg: round2(p) };
}

/** Smoothed baseline for the next `h` months from a chronological monthly series. */
export function projectMonthly(series, h) {
  const n = series.length;
  if (n === 0) return { value: 0, method: 'none' };
  if (n < 3) return { value: mean(series), method: 'average' };
  const level = ewma(series, 0.5);
  const slope = theilSen(series);
  const raw = level + 0.5 * slope * h; // damped trend
  return { value: Math.max(0, Math.min(Math.max(raw, level * 0.6), level * 1.5)), method: 'smoothed-trend' };
}

/** Walk-forward backtest: forecast each past month using only earlier months. */
export function backtest(monthlyTotals) {
  const rows = [];
  for (let i = 2; i < monthlyTotals.length; i++) {
    const expected = ewma(monthlyTotals.slice(0, i).map((m) => m.total), 0.5);
    const actual = monthlyTotals[i].total;
    rows.push({ period: monthlyTotals[i].period, expected: round2(expected), actual: round2(actual), errorPct: actual > 0 ? round2(((expected - actual) / actual) * 100) : null });
  }
  const valid = rows.filter((r) => r.errorPct != null);
  const mape = valid.length ? round2(mean(valid.map((r) => Math.abs(r.errorPct)))) : null;
  return { rows: rows.slice(-6), mape };
}

export async function getForecast(user, { today = todayStr() } = {}) {
  return cached(user._id, 'forecast', { today }, () => computeForecast(user, today));
}

export async function computeForecast(user, today) {
  const fm = makeFmt(user.currency);
  const period = periodOf(today);
  const first = shiftPeriod(period, -(HISTORY_MONTHS - 1));
  const { end } = periodRange(period);
  const [expenses, rules, budgets, income, catMap] = await Promise.all([
    loadExpenses(user._id, `${first}-01`, formatDay(new Date(end - 86400000))),
    RecurringRule.find({ user: user._id }).lean(),
    effectiveBudgets(user._id, period),
    getIncome(user._id, period),
    getCategoryMap(user._id),
  ]);
  const colorOf = (name) => [...catMap.values()].find((c) => c.name === name)?.color ?? '#64748b';
  const d = Number(today.slice(8, 10));
  const D = daysInPeriod(period);
  const r = D - d;

  const classified = expenses.map((e) => ({ ...e, recurringLike: isRecurringLike(e, rules) }));
  const histAll = classified.filter((e) => e.period < period);
  const cur = classified.filter((e) => e.period === period);

  // Which earlier months can be trusted as "complete"? The first month of data may be half-tracked.
  const monthsWithData = [...new Set(histAll.map((e) => e.period))].sort();
  let completeMonths = monthsWithData;
  const notes = [];
  if (monthsWithData.length) {
    const firstMonth = monthsWithData[0];
    const firstDay = histAll.find((e) => e.period === firstMonth).day;
    if (Number(firstDay.slice(8, 10)) > 10 && monthsWithData.length > 1) {
      completeMonths = monthsWithData.slice(1);
      notes.push(`${periodLabel(firstMonth)} looks only partly tracked (first entry on day ${Number(firstDay.slice(8, 10))}), so it was left out of the baseline.`);
    }
  }
  const histMonthsRange = completeMonths.length ? periodsBetween(completeMonths[0], completeMonths[completeMonths.length - 1]) : [];
  const completeSet = new Set(histMonthsRange);
  const hist = histAll.filter((e) => completeSet.has(e.period));

  const threshold = outlierThreshold(hist.filter((e) => !e.recurringLike).map((e) => e.amount));
  const isOutlier = (e) => !e.recurringLike && e.amount > threshold;
  const histDisc = hist.filter((e) => !e.recurringLike && !isOutlier(e));
  const curDisc = cur.filter((e) => !e.recurringLike && !isOutlier(e) && e.day <= today);
  const unusualRecent = cur.filter((e) => isOutlier(e) || (e.amount > threshold && !e.recurringLike));

  const monthlyTotals = histMonthsRange.map((p) => ({ period: p, total: sum(hist.filter((e) => e.period === p)) }));
  const nMonths = histMonthsRange.length;
  const histDays = histMonthsRange.reduce((t, p) => t + daysInPeriod(p), 0);

  // data quality
  const txCount = expenses.length;
  const confidence = nMonths >= 3 && txCount >= 30 ? 'high' : nMonths >= 1 && txCount >= 10 ? 'medium' : 'low';
  const preliminary = nMonths < 2 || txCount < 10;
  if (preliminary) notes.push('There is limited history, so these figures are a preliminary estimate. They will sharpen as you record more months.');
  if (Number.isFinite(threshold) && unusualRecent.length) notes.push(`${unusualRecent.length} unusually large purchase(s) this month are counted in your totals but excluded from the daily pace.`);

  // ---- current month ----
  const catNames = [...new Set(classified.map((e) => e.category))];
  const recSched = await scheduledForPeriod(user._id, period);
  const histCatRate = (name) => (histDays ? sum(histDisc.filter((e) => e.category === name)) / histDays : 0);
  const canProject = nMonths > 0 || d >= 3;

  const perCategory = catNames.map((name) => {
    const actual = sum(cur.filter((e) => e.category === name));
    const curMtd = sum(curDisc.filter((e) => e.category === name));
    const curRate = curMtd / d;
    const hr = histCatRate(name);
    const rate = nMonths > 0 ? (d * curRate + SHRINK_DAYS * hr) / (d + SHRINK_DAYS) : curRate;
    const recRem = recSched.byCategory[name] ?? 0;
    const projected = actual + recRem + rate * r;
    const catHistMonthly = histMonthsRange.map((p) => sum(hist.filter((e) => e.period === p && e.category === name)));
    const usual = nMonths ? mean(catHistMonthly.slice(-3)) : null;
    const trend = directionOf(catHistMonthly);
    return { category: name, color: colorOf(name), actual: round2(actual), recurringRemaining: round2(recRem), rate: round2(rate), projected: round2(projected), usual: usual == null ? null : round2(usual), vsUsualPct: usual && usual > 0 ? round2(((projected - usual) / usual) * 100) : null, trend: trend.direction, trendChangePct: trend.changePct };
  });

  const actualToDate = sum(cur.filter((e) => e.day <= today));
  const loggedFuture = sum(cur.filter((e) => e.day > today));
  const recurringRemaining = round2(recSched.total);
  const totalRate = perCategory.reduce((t, c) => t + c.rate, 0);
  const discretionaryRemaining = canProject ? round2(totalRate * r) : 0;
  const committed = actualToDate + loggedFuture + recurringRemaining;
  const projectedTotal = canProject ? round2(committed + discretionaryRemaining) : null;

  // Uncertainty from day-to-day variation (zero-spend days included).
  const dayTotals = (list, days) => {
    const m = new Map();
    for (const e of list) m.set(e.day, (m.get(e.day) ?? 0) + e.amount);
    return days.map((dy) => m.get(dy) ?? 0);
  };
  const histDayList = histMonthsRange.flatMap((p) => Array.from({ length: daysInPeriod(p) }, (_, i) => `${p}-${String(i + 1).padStart(2, '0')}`));
  const curDayList = Array.from({ length: d }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
  const sigmaDaily = histDayList.length >= 14 ? sd(dayTotals(histDisc, histDayList)) : d >= 7 ? sd(dayTotals(curDisc, curDayList)) : totalRate * 1.2;
  const inflate = preliminary ? 1.3 : 1;
  const sdRemaining = Math.sqrt(Math.max(0, r)) * sigmaDaily * inflate;
  const low = projectedTotal == null ? null : round2(Math.max(committed, projectedTotal - Z80 * sdRemaining));
  const high = projectedTotal == null ? null : round2(projectedTotal + Z80 * sdRemaining);

  // Cumulative path for the "month runway" chart.
  const recByDay = new Map();
  for (const it of recSched.items) recByDay.set(it.date, (recByDay.get(it.date) ?? 0) + it.amount);
  const actualByDay = new Map();
  for (const e of cur) actualByDay.set(e.day, (actualByDay.get(e.day) ?? 0) + e.amount);
  let cumActual = 0;
  let cumProj = 0;
  const path = [];
  for (let i = 1; i <= D; i++) {
    const day = `${period}-${String(i).padStart(2, '0')}`;
    if (day <= today) {
      cumActual += actualByDay.get(day) ?? 0;
      cumProj = cumActual;
      path.push({ day, actual: round2(cumActual), projected: day === today ? round2(cumActual) : null, low: null, high: null });
    } else {
      cumProj += totalRate * (canProject ? 1 : 0) + (recByDay.get(day) ?? 0) + (actualByDay.get(day) ?? 0);
      const k = i - d;
      const band = Z80 * Math.sqrt(k) * sigmaDaily * inflate;
      path.push({ day, actual: null, projected: canProject ? round2(cumProj) : null, low: canProject ? round2(Math.max(cumActual, cumProj - band)) : null, high: canProject ? round2(cumProj + band) : null });
    }
  }

  // ---- budgets ----
  const budgetRows = budgets.map((b) => {
    const cat = perCategory.find((c) => c.category === b.category.name);
    const spent = cat?.actual ?? 0;
    const projected = cat?.projected ?? spent;
    const catDaily = histDayList.length >= 14 ? sd(dayTotals(histDisc.filter((e) => e.category === b.category.name), histDayList)) : cat ? cat.rate * 1.2 : 0;
    const sdCat = Math.max(Math.sqrt(Math.max(0, r)) * catDaily * inflate, projected * 0.02);
    const exceeded = spent > b.limit;
    let prob = exceeded ? 1 : r === 0 ? (spent > b.limit ? 1 : 0) : 1 - normalCdf((b.limit - projected) / (sdCat || 1));
    if (!exceeded && projected > b.limit) prob = Math.max(prob, 0.5);
    if (!exceeded && projected <= b.limit) prob = Math.min(prob, 0.5);
    const risk = exceeded ? 'exceeded' : prob >= 0.6 ? 'likely' : prob >= 0.3 ? 'possible' : 'unlikely';
    return { budgetId: String(b._id), category: b.category.name, color: b.category.color, limit: b.limit, spent: round2(spent), projected: round2(projected), probabilityExceed: round2(prob), risk, projectedOverBy: projected > b.limit ? round2(projected - b.limit) : 0, estimateOnly: !canProject };
  }).sort((a, b) => b.probabilityExceed - a.probabilityExceed);

  // ---- history, trend, backtest ----
  const overallTrend = directionOf(monthlyTotals.map((m) => m.total));
  const bt = backtest(monthlyTotals);
  const history = monthlyTotals.map((m) => ({ period: m.period, actual: m.total }));

  // ---- next months ----
  const nextMonths = [];
  const monthlyDiscTotals = histMonthsRange.map((p) => sum(histDisc.filter((e) => e.period === p)));
  const sdMonth = sd(monthlyDiscTotals);
  for (let h = 1; h <= 3; h++) {
    const p = shiftPeriod(period, h);
    const sched = await scheduledForPeriod(user._id, p);
    const byCategory = [];
    for (const name of catNames) {
      const series = histMonthsRange.map((m) => sum(histDisc.filter((e) => e.period === m && e.category === name)));
      let amount;
      if (nMonths > 0) amount = projectMonthly(series, h).value;
      else amount = canProject && d >= 7 ? (sum(curDisc.filter((e) => e.category === name)) / d) * daysInPeriod(p) : 0;
      if (amount > 0.005) byCategory.push({ category: name, color: colorOf(name), amount: round2(amount) });
    }
    for (const [name, amt] of Object.entries(sched.byCategory)) {
      const row = byCategory.find((c) => c.category === name);
      if (row) row.amount = round2(row.amount + amt);
      else byCategory.push({ category: name, color: colorOf(name), amount: round2(amt) });
    }
    const discretionary = round2(byCategory.reduce((t, c) => t + c.amount, 0) - sched.total);
    const total = round2(discretionary + sched.total);
    const spread = nMonths >= 3 ? Z80 * sdMonth * (1 + 0.2 * (h - 1)) : total * (0.35 + 0.1 * (h - 1));
    nextMonths.push({
      period: p,
      label: periodLabel(p),
      total: total > 0 ? total : null,
      discretionary: Math.max(0, discretionary),
      recurring: sched.total,
      low: total > 0 ? round2(Math.max(sched.total, total - spread)) : null,
      high: total > 0 ? round2(total + spread) : null,
      byCategory: byCategory.sort((a, b) => b.amount - a.amount),
      basis: nMonths >= 3 ? 'smoothed trend of your recent months' : nMonths > 0 ? 'average of the months you have recorded' : canProject && d >= 7 ? 'this month’s pace (no completed months yet)' : 'not enough data',
      confidence: nMonths >= 3 ? 'medium' : 'low',
    });
  }

  // ---- narrative: factors, attention, suggestions ----
  const factors = [];
  if (canProject && projectedTotal != null) {
    factors.push(`${Math.round((committed / projectedTotal) * 100)}% of the estimate is already recorded or scheduled (${fm(committed)} of ${fm(projectedTotal)}).`);
    const usualDaily = nMonths ? histDisc.length && histDays ? sum(histDisc) / histDays : 0 : null;
    if (usualDaily != null && d >= 3) {
      const curDaily = sum(curDisc) / d;
      factors.push(`Everyday spending (excluding recurring bills and unusual purchases) is running at ${fm(Math.round(curDaily))}/day this month versus ${fm(Math.round(usualDaily))}/day in your history.`);
    }
    if (recurringRemaining > 0) factors.push(`${fm(recurringRemaining)} of recurring payments are still due this month (${recSched.items.length} item${recSched.items.length === 1 ? '' : 's'}).`);
    if (r === 0) factors.push('Today is the last day of the month, so the estimate is almost entirely actual spending.');
  } else {
    factors.push('There is not enough data this month to project a pace yet. Add a few more days of expenses.');
  }
  if (nMonths) factors.push(`The baseline uses ${nMonths} completed month${nMonths === 1 ? '' : 's'} of history.`);
  if (overallTrend.direction !== 'insufficient') factors.push(`Overall spending has been ${overallTrend.direction}${overallTrend.changePct != null ? ` (${overallTrend.changePct > 0 ? '+' : ''}${overallTrend.changePct}% recent vs. earlier months)` : ''}.`);

  const attention = [];
  const totalAvg = nMonths ? mean(monthlyTotals.map((m) => m.total)) : 0;
  for (const c of perCategory) {
    const brisk = budgetRows.find((b) => b.category === c.category);
    if (brisk && (brisk.risk === 'exceeded' || brisk.risk === 'likely')) attention.push({ category: c.category, reason: brisk.risk === 'exceeded' ? 'Budget already exceeded.' : `Likely to exceed its budget (about ${Math.round(brisk.probabilityExceed * 100)}% chance).` });
    else if (c.usual != null && c.vsUsualPct != null && c.vsUsualPct >= 25 && c.projected - c.usual >= totalAvg * 0.03) attention.push({ category: c.category, reason: `On pace for ${c.vsUsualPct}% above its recent monthly average.` });
    else if (c.trend === 'increasing' && c.projected >= totalAvg * 0.05 && (c.usual == null || c.projected >= c.usual * 0.9)) attention.push({ category: c.category, reason: 'Has been rising over recent months.' });
  }

  const suggestions = perCategory
    .filter((c) => c.usual != null && c.projected - c.usual > Math.max(totalAvg * 0.03, 100) && canProject)
    .sort((a, b) => b.projected - b.usual - (a.projected - a.usual))
    .slice(0, 3)
    .map((c) => ({ category: c.category, potentialSaving: round2(c.projected - c.usual), message: `${c.category} is on pace for ${fm(c.projected)}, about ${fm(round2(c.projected - c.usual))} above its usual ${fm(c.usual)}. Holding it near the usual level would free up that amount.` }));

  const nextTotal = nextMonths[0]?.total ?? null;
  const nextIncome = await getIncome(user._id, nextMonths[0].period);
  const incomeRef = nextIncome ?? income;
  const savingsOutlook = incomeRef != null && nextTotal != null
    ? { income: incomeRef, incomeBasis: nextIncome != null ? 'income entered for next month' : 'this month’s income (none entered for next month)', expectedSpending: nextTotal, expectedSavings: round2(incomeRef - nextTotal), note: 'Savings = income minus estimated spending. It ignores any income or costs you have not recorded.' }
    : { income: null, expectedSpending: nextTotal, expectedSavings: null, note: incomeRef == null ? 'No monthly income has been entered, so savings cannot be estimated. Add your income in Settings.' : 'Not enough data to estimate next month’s spending.' };

  return {
    asOf: today,
    period,
    label: periodLabel(period),
    disclaimer: 'Forecasts are statistical estimates based on your past spending. Real spending can differ.',
    dataQuality: { completedMonths: nMonths, transactions: txCount, confidence, preliminary, notes },
    method: {
      currentMonth: 'Actual spending so far + recurring payments still due + an estimated daily pace. The pace blends this month’s daily rate with your historical rate (more weight on history early in the month).',
      nextMonths: 'Per-category exponentially smoothed monthly spending with a damped, outlier-robust trend, plus the exact schedule of your recurring rules.',
      range: 'The shaded range is an 80% interval from your day-to-day spending variation.',
      backtest: 'Expected values are produced using only the months before each month (walk-forward test).',
    },
    currentMonth: {
      daysElapsed: d, daysInMonth: D, actualToDate: round2(actualToDate), loggedFuture: round2(loggedFuture),
      recurringRemaining, discretionaryRemaining, projectedTotal, low, high, canProject,
      paceDaily: round2(sum(curDisc) / d), usualDaily: nMonths && histDays ? round2(sum(histDisc) / histDays) : null,
      income, projectedBalance: income != null && projectedTotal != null ? round2(income - projectedTotal) : null,
      byCategory: perCategory.sort((a, b) => b.projected - a.projected), path,
    },
    budgets: budgetRows,
    nextMonths,
    history,
    expectedVsActual: { rows: bt.rows, currentMonth: { period, expected: projectedTotal, actualSoFar: round2(actualToDate) }, mape: bt.mape },
    trends: { overall: overallTrend, categories: perCategory.map((c) => ({ category: c.category, direction: c.trend, changePct: c.trendChangePct })) },
    attention,
    factors,
    suggestions,
    savingsOutlook,
  };
}