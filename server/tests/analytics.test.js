import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, newUser, meta, addExpense, day, request, app } from './helpers.js';
import { User } from '../src/models/index.js';
import { computeForecast, projectMonthly, directionOf, backtest, outlierThreshold, isRecurringLike } from '../src/services/forecast.js';
import { computeInsights } from '../src/services/insights.js';
import { compareMonths, pctChange, budgetStatus } from '../src/services/analytics.js';
import { normalCdf, theilSen, ewma } from '../src/utils/stats.js';
import { buildMonthlyReport } from '../src/services/reports.js';

before(setup);
after(teardown);

const TODAY = '2026-10-15';

// ---------- pure functions ----------
test('stats helpers behave', () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.2816) - 0.9) < 1e-3);
  assert.equal(theilSen([1, 2, 3, 4, 100, 6]), 1, 'robust to one wild point');
  assert.equal(ewma([10]), 10);
});

test('pct change is null (not misleading) when the baseline is zero', () => {
  assert.equal(pctChange(50, 0), null);
  assert.equal(pctChange(50, null), null);
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(0, 100), -100);
});

test('budget status thresholds', () => {
  assert.equal(budgetStatus({ limit: 100, spent: 79, threshold: 80 }).status, 'ok');
  assert.equal(budgetStatus({ limit: 100, spent: 80, threshold: 80 }).status, 'warning');
  assert.equal(budgetStatus({ limit: 100, spent: 100, threshold: 80 }).status, 'warning');
  assert.equal(budgetStatus({ limit: 100, spent: 100.01, threshold: 80 }).status, 'exceeded');
});

test('projection helpers: trend detection, damping, outliers, backtest', () => {
  assert.equal(directionOf([100, 100, 100, 150, 160, 170]).direction, 'increasing');
  assert.equal(directionOf([200, 200, 200, 100, 100, 100]).direction, 'decreasing');
  assert.equal(directionOf([100, 102, 99, 101, 100, 98]).direction, 'stable');
  assert.equal(directionOf([100]).direction, 'insufficient');
  const p = projectMonthly([100, 100, 100, 100, 400], 3);
  assert.ok(p.value <= 400 * 1.5 && p.value >= 0, 'bounded');
  assert.equal(projectMonthly([], 1).value, 0);
  assert.equal(outlierThreshold([10, 20]), Infinity, 'too little data to call anything an outlier');
  assert.ok(outlierThreshold([...Array.from({ length: 20 }, (_, i) => 100 + i), 9000]) < 9000);
  const bt = backtest([{ period: 'a', total: 100 }, { period: 'b', total: 100 }, { period: 'c', total: 120 }]);
  assert.equal(bt.rows.length, 1);
  assert.equal(bt.rows[0].expected, 100);
  assert.equal(isRecurringLike({ description: 'Netflix subscription', amount: 650 }, [{ description: 'Netflix', amount: 649 }]), true);
  assert.equal(isRecurringLike({ description: 'Netflix subscription', amount: 900 }, [{ description: 'Netflix', amount: 649 }]), false);
});

test('month-over-month: like-for-like for an unfinished month, zero baseline, missing data', () => {
  const mk = (period, d, amount, category = 'Food') => ({ id: `${period}${d}${amount}${category}`, amount, category, categoryId: category, paymentMode: 'UPI', paymentModeId: 'u', day: `${period}-${String(d).padStart(2, '0')}`, period });
  const expenses = [mk('2026-09', 3, 100), mk('2026-09', 10, 100), mk('2026-09', 25, 800), mk('2026-10', 4, 150), mk('2026-10', 9, 100, 'Travel')];
  const c = compareMonths({ expenses, period: '2026-10', today: '2026-10-12' });
  assert.equal(c.basis, 'like_for_like');
  assert.equal(c.total.previous, 200, 'only days 1–12 of September');
  assert.equal(c.previousFullMonthTotal, 1000);
  assert.equal(c.total.current, 250);
  assert.equal(c.total.changePct, 25);
  const travel = c.categories.find((x) => x.category === 'Travel');
  assert.equal(travel.previous, 0);
  assert.equal(travel.changePct, null, 'no percentage when nothing last month');
  assert.equal(c.drivers[0].category, 'Travel', 'the category with the largest increase leads');
  assert.equal(c.drivers.some((d) => d.category === 'Food'), false, 'Food fell, so it is not a driver of the increase');
  const empty = compareMonths({ expenses: [], period: '2026-10', today: '2026-10-12' });
  assert.equal(empty.hasPreviousData, false);
  assert.equal(empty.total.changePct, null);
  const done = compareMonths({ expenses, period: '2026-09', today: '2026-10-12' });
  assert.equal(done.basis, 'full_month');
});

// ---------- forecast against real data ----------
async function forecastUser() {
  const u = await newUser();
  const m = await meta(u.agent);
  const plan = { 5: { Food: 5800, Travel: 1000, Bills: 3000 }, 6: { Food: 6100, Travel: 1500, Bills: 3000 }, 7: { Food: 5900, Travel: 2000, Bills: 3000 }, 8: { Food: 6200, Travel: 2600, Bills: 3000 }, 9: { Food: 6000, Travel: 3300, Bills: 3000 } };
  for (const [mo, cats] of Object.entries(plan)) {
    for (const [cat, total] of Object.entries(cats)) {
      const n = cat === 'Bills' ? 1 : 6;
      for (let i = 0; i < n; i++) await addExpense(u.agent, m, { amount: Math.round((total / n) * 100) / 100, category: cat, date: `2026-${String(mo).padStart(2, '0')}-${String(2 + i * 4).padStart(2, '0')}`, description: `${cat} ${mo}-${i}`, merchant: `${cat} shop` });
    }
  }
  for (let i = 0; i < 5; i++) await addExpense(u.agent, m, { amount: 700, category: 'Food', date: `2026-10-${String(2 + i * 2).padStart(2, '0')}`, description: `Food oct ${i}` });
  await addExpense(u.agent, m, { amount: 1800, category: 'Travel', date: '2026-10-06', description: 'Cab' });
  await addExpense(u.agent, m, { amount: 3000, category: 'Bills', date: '2026-10-03', description: 'Bills oct' });
  const user = await User.findById(u.user.id);
  return { ...u, m, user };
}

test('forecast: current-month projection is bounded, explained and consistent', async () => {
  const { agent, m, user } = await forecastUser();
  await agent.post('/api/budgets').send({ category: m.cat('Food'), period: 'default', limit: 7000 });
  await agent.post('/api/recurring').send({ description: 'Netflix', amount: 649, category: m.cat('Entertainment'), paymentMode: m.pay('UPI'), frequency: 'monthly', startDate: '2026-10-20' });
  const f = await computeForecast(user, TODAY);
  const c = f.currentMonth;
  assert.equal(f.dataQuality.preliminary, false);
  assert.ok(f.dataQuality.completedMonths >= 4);
  assert.equal(c.actualToDate, 3500 + 1800 + 3000);
  assert.equal(c.recurringRemaining, 649, 'unpaid recurring rule counted exactly');
  assert.ok(c.projectedTotal >= c.actualToDate + c.recurringRemaining, 'never below what is already committed');
  assert.ok(c.low <= c.projectedTotal && c.projectedTotal <= c.high);
  assert.ok(c.projectedTotal < 40000, 'sane magnitude');
  assert.ok(f.factors.length >= 3 && f.factors.every((x) => typeof x === 'string'));
  assert.ok(f.disclaimer.toLowerCase().includes('estimate'));
  assert.equal(c.path.length, 31);
  assert.equal(c.path[14].actual, c.actualToDate, 'path meets actuals today');
  assert.ok(c.path[30].projected >= c.path[15].projected, 'cumulative path never decreases');
  const food = f.budgets.find((b) => b.category === 'Food');
  assert.ok(food && ['likely', 'possible', 'unlikely', 'exceeded'].includes(food.risk));
  assert.ok(food.projected > food.spent);
  const travelTrend = f.trends.categories.find((t) => t.category === 'Travel');
  assert.equal(travelTrend.direction, 'increasing');
  assert.ok(f.attention.some((a) => a.category === 'Travel'));
  assert.equal(f.nextMonths.length, 3);
  assert.ok(f.nextMonths[0].recurring === 649 && f.nextMonths[0].total > 649);
  assert.ok(f.nextMonths[0].low <= f.nextMonths[0].total && f.nextMonths[0].total <= f.nextMonths[0].high);
  assert.ok(f.expectedVsActual.rows.length >= 2);
  assert.ok(f.expectedVsActual.mape != null);
  assert.ok(f.history.length >= 5);
});

test('forecast: a budget already exceeded is reported as exceeded; a giant one-off does not distort the pace', async () => {
  const { agent, m, user } = await forecastUser();
  await agent.post('/api/budgets').send({ category: m.cat('Bills'), period: 'default', limit: 2000 });
  const base = (await computeForecast(user, TODAY)).currentMonth;
  await addExpense(agent, m, { amount: 90000, category: 'Shopping', date: '2026-10-10', description: 'Laptop' });
  const withOneOff = await computeForecast(user, TODAY);
  assert.equal(withOneOff.budgets.find((b) => b.category === 'Bills').risk, 'exceeded');
  assert.equal(withOneOff.currentMonth.actualToDate, base.actualToDate + 90000, 'one-off still counted as actual');
  const extra = withOneOff.currentMonth.projectedTotal - base.projectedTotal;
  assert.ok(Math.abs(extra - 90000) < 1500, `one-off counted once and not extrapolated forward (extra=${extra})`);
});

test('forecast: limited history is labelled preliminary; empty history does not crash or invent numbers', async () => {
  const u = await newUser();
  const m = await meta(u.agent);
  const user = await User.findById(u.user.id);
  const empty = await computeForecast(user, '2026-10-02');
  assert.equal(empty.currentMonth.canProject, false);
  assert.equal(empty.currentMonth.projectedTotal, null);
  assert.equal(empty.dataQuality.preliminary, true);
  assert.equal(empty.nextMonths[0].total, null);
  await addExpense(u.agent, m, { amount: 200, date: '2026-10-01' });
  await addExpense(u.agent, m, { amount: 300, date: '2026-10-04' });
  await addExpense(u.agent, m, { amount: 100, date: '2026-10-07' });
  const few = await computeForecast(user, '2026-10-10');
  assert.equal(few.dataQuality.preliminary, true);
  assert.equal(few.dataQuality.confidence, 'low');
  assert.ok(few.dataQuality.notes.join(' ').toLowerCase().includes('preliminary'));
  assert.ok(few.currentMonth.projectedTotal >= 600);
  assert.equal(few.expectedVsActual.rows.length, 0, 'no backtest without history');
});

test('forecast is computed only from the signed-in user (another user\'s spending is invisible)', async () => {
  const a = await forecastUser();
  const b = await newUser();
  const mb = await meta(b.agent);
  await addExpense(b.agent, mb, { amount: 5000000, date: '2026-10-05' });
  const fa = await computeForecast(a.user, TODAY);
  assert.ok(fa.currentMonth.projectedTotal < 100000);
  const fb = await computeForecast(await User.findById(b.user.id), TODAY);
  assert.ok(fb.currentMonth.actualToDate === 5000000);
});

test('insights: budget, increase, duplicate, recurring-due alerts; dismissible; capped; keyed per period', async () => {
  const { agent, m, user } = await forecastUser();
  await agent.post('/api/budgets').send({ category: m.cat('Bills'), period: 'default', limit: 2500 });
  await agent.post('/api/budgets').send({ category: m.cat('Food'), period: 'default', limit: 4200, threshold: 80 });
  await addExpense(agent, m, { amount: 123, category: 'Food', date: '2026-10-09', description: 'Chai', merchant: 'Stall' });
  await addExpense(agent, m, { amount: 123, category: 'Food', date: '2026-10-09', description: 'Chai', merchant: 'Stall' });
  await agent.post('/api/recurring').send({ description: 'Rent', amount: 9000, category: m.cat('Bills'), paymentMode: m.pay('Bank Transfer'), frequency: 'monthly', startDate: '2026-10-14' });
  const alerts = await computeInsights(user, TODAY);
  const types = alerts.map((a) => a.type);
  assert.ok(types.includes('budget_exceeded'));
  assert.ok(types.includes('duplicate'));
  assert.ok(types.includes('recurring_due'));
  assert.ok(alerts.every((a) => a.key && a.title && a.message && a.severity));
  assert.equal(alerts[0].severity, 'critical', 'most severe first');
  assert.ok(new Set(alerts.map((a) => a.key)).size === alerts.length, 'no duplicate alerts');
  // dismissal persists via API
  const list = await agent.get('/api/insights');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.alerts.length <= 10);
  const key = list.body.data.alerts[0].key;
  await agent.post('/api/insights/dismiss').send({ key });
  const after = await agent.get('/api/insights');
  assert.ok(!after.body.data.alerts.some((a) => a.key === key));
  assert.equal(after.body.data.dismissedCount, 1);
  await agent.delete('/api/insights/dismissed');
});

test('insights: a brand-new user gets no fabricated alerts', async () => {
  const u = await newUser();
  const r = await u.agent.get('/api/insights');
  assert.equal(r.body.data.alerts.length, 0);
});

test('monthly report: totals, breakdowns, budgets, unusual spend, income limitation, CSV export', async () => {
  const { agent, m, user } = await forecastUser();
  await agent.post('/api/budgets').send({ category: m.cat('Food'), period: '2026-09', limit: 5000 });
  const r = await buildMonthlyReport(user, '2026-09', TODAY);
  assert.equal(r.summary.total, 6000 + 3300 + 3000);
  assert.equal(r.summary.income, null);
  assert.equal(r.summary.netCashFlow, null, 'no income → no net cash flow invented');
  assert.ok(r.summary.incomeNote.includes('No income'));
  assert.equal(r.byCategory[0].category, 'Food');
  assert.equal(Math.round(r.byCategory.reduce((t, c) => t + c.share, 0)), 100);
  assert.equal(r.daily.length, 30);
  assert.equal(r.budgets.find((b) => b.category === 'Food').status, 'exceeded');
  assert.equal(r.comparison.previousPeriod, '2026-08');
  assert.ok(r.comparison.total.changePct != null);
  assert.equal(r.isCurrentMonth, false);
  assert.ok(r.forecast.expectedForPastMonth || r.forecast.expectedForPastMonth === null);
  await agent.put('/api/income').send({ period: '2026-09', amount: 20000 });
  const res = await agent.get('/api/reports/monthly').query({ period: '2026-09' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.summary.netCashFlow, 20000 - 12300);
  assert.equal(res.body.data.summary.savingsRate, Math.round(((20000 - 12300) / 20000) * 10000) / 100);
  const csv = await agent.get('/api/reports/monthly.csv').query({ period: '2026-09' });
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-disposition'], /spendiq-report-2026-09\.csv/);
  assert.ok(csv.text.includes('CATEGORY') && csv.text.includes('Food'));
  const bad = await agent.get('/api/reports/monthly').query({ period: '2026-13' });
  assert.equal(bad.status, 400);
  const empty = (await agent.get('/api/reports/monthly').query({ period: '2020-01' })).body.data;
  assert.equal(empty.summary.total, 0);
  assert.ok(empty.notes[0].includes('No expenses'));
});

test('dashboard, forecast and compare endpoints respond with consistent numbers', async () => {
  const { agent } = await forecastUser();
  const d = (await agent.get('/api/dashboard').query({ period: '2026-09' })).body.data;
  const r = (await agent.get('/api/reports/monthly').query({ period: '2026-09' })).body.data;
  assert.equal(d.totals.spent, r.summary.total, 'dashboard and report agree');
  assert.equal(d.trend.length, 6);
  const c = (await agent.get('/api/reports/compare').query({ period: '2026-09' })).body.data;
  assert.equal(c.total.current, r.summary.total);
  const f = await agent.get('/api/forecast');
  assert.equal(f.status, 200);
  assert.ok(f.body.data.method.currentMonth);
  assert.equal((await request(app).get('/api/forecast')).status, 401);
  const fresh = await newUser();
  const fd = (await fresh.agent.get('/api/dashboard')).body.data;
  assert.equal(fd.hasAnyData, false);
  assert.equal(fd.totals.spent, 0);
});