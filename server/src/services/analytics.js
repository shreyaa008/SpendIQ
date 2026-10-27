// Shared analytics over a user's own expenses. Dashboard, reports, forecast, insights and the chatbot all use these,
// so every screen reports the same numbers.
import { Expense, Category, PaymentMode, Budget, Income } from '../models/index.js';
import { parseDay, formatDay, periodRange, periodOf, shiftPeriod, daysInPeriod, round2 } from '../utils/dates.js';

export const MAX_ANALYTICS_DOCS = 30000;

/** Loads a user's expenses between two inclusive YYYY-MM-DD days as plain objects with category/payment names resolved. */
export async function loadExpenses(userId, fromDay, toDay) {
  const [docs, cats, pays] = await Promise.all([
    Expense.find({ user: userId, date: { $gte: parseDay(fromDay), $lte: parseDay(toDay) } })
      .select('amount description merchant category paymentMode date source recurringRule receipt currency')
      .sort({ date: 1, _id: 1 })
      .limit(MAX_ANALYTICS_DOCS)
      .lean(),
    getCategoryMap(userId),
    getPaymentMap(userId),
  ]);
  return docs.map((e) => {
    const c = cats.get(String(e.category));
    const p = pays.get(String(e.paymentMode));
    return {
      id: String(e._id),
      amount: e.amount,
      description: e.description || '',
      merchant: e.merchant || '',
      categoryId: String(e.category),
      category: c?.name ?? 'Uncategorised',
      paymentModeId: String(e.paymentMode),
      paymentMode: p ?? 'Unknown',
      day: formatDay(e.date),
      period: periodOf(e.date),
      source: e.source,
      recurringRule: e.recurringRule ? String(e.recurringRule) : null,
      hasReceipt: Boolean(e.receipt),
    };
  });
}

export async function getCategoryMap(userId) {
  const cats = await Category.find({ user: userId }).lean();
  return new Map(cats.map((c) => [String(c._id), { id: String(c._id), name: c.name, color: c.color, icon: c.icon }]));
}
export async function getPaymentMap(userId) {
  const pays = await PaymentMode.find({ user: userId }).lean();
  return new Map(pays.map((p) => [String(p._id), p.name]));
}

export const sum = (list, f = (x) => x.amount) => round2(list.reduce((t, x) => t + (Number(f(x)) || 0), 0));

export function groupTotals(list, keyFn) {
  const map = new Map();
  for (const e of list) {
    const k = keyFn(e);
    const cur = map.get(k) ?? { key: k, total: 0, count: 0 };
    cur.total += e.amount;
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.values()].map((x) => ({ ...x, total: round2(x.total) })).sort((a, b) => b.total - a.total);
}

export function summarizeExpenses(list) {
  const total = sum(list);
  return {
    total,
    count: list.length,
    average: list.length ? round2(total / list.length) : 0,
    highest: list.reduce((h, e) => (!h || e.amount > h.amount ? e : h), null),
  };
}

export function dailySeries(list, period, upToDay = null) {
  const n = daysInPeriod(period);
  const arr = Array.from({ length: n }, (_, i) => ({ day: `${period}-${String(i + 1).padStart(2, '0')}`, total: 0 }));
  for (const e of list) {
    if (e.period !== period) continue;
    const i = Number(e.day.slice(8, 10)) - 1;
    if (arr[i]) arr[i].total += e.amount;
  }
  return arr.map((d) => ({ ...d, total: round2(d.total), future: upToDay ? d.day > upToDay : false }));
}

export function weeklySeries(daily) {
  const weeks = [];
  daily.forEach((d, i) => {
    const w = Math.floor(i / 7);
    if (!weeks[w]) weeks[w] = { label: `Days ${i + 1}–${Math.min(i + 7, daily.length)}`, total: 0 };
    weeks[w].total += d.total;
  });
  return weeks.map((w) => ({ ...w, total: round2(w.total) }));
}

// ---------- budgets ----------

/** Budgets that apply to a month: a month-specific budget overrides the "default" one for the same category. */
export async function effectiveBudgets(userId, period) {
  const rows = await Budget.find({ user: userId, period: { $in: ['default', period] } }).populate('category', 'name color icon').lean();
  const byCat = new Map();
  for (const b of rows) {
    if (!b.category) continue;
    const key = String(b.category._id);
    const existing = byCat.get(key);
    if (!existing || (existing.period === 'default' && b.period !== 'default')) byCat.set(key, b);
  }
  return [...byCat.values()];
}

export function budgetStatus({ limit, spent, threshold }) {
  const ratio = limit > 0 ? spent / limit : 0;
  let status = 'ok';
  if (spent > limit) status = 'exceeded';
  else if (ratio >= threshold / 100) status = 'warning';
  return { status, percent: round2(ratio * 100), remaining: round2(limit - spent) };
}

export async function budgetStatuses(user, period, expenses) {
  const budgets = await effectiveBudgets(user._id, period);
  const spentByCat = new Map(groupTotals(expenses.filter((e) => e.period === period), (e) => e.categoryId).map((g) => [g.key, g.total]));
  return budgets
    .map((b) => {
      const threshold = b.threshold ?? user.warningThreshold ?? 80;
      const spent = spentByCat.get(String(b.category._id)) ?? 0;
      return {
        id: String(b._id),
        categoryId: String(b.category._id),
        category: b.category.name,
        color: b.category.color,
        period: b.period,
        appliesTo: period,
        limit: b.limit,
        threshold,
        spent,
        ...budgetStatus({ limit: b.limit, spent, threshold }),
      };
    })
    .sort((a, b) => b.percent - a.percent);
}

export async function getIncome(userId, period) {
  const doc = await Income.findOne({ user: userId, period }).lean();
  return doc ? doc.amount : null; // null = never entered (not the same as 0)
}

// ---------- month-over-month ----------

export function pctChange(current, previous) {
  if (previous == null || previous === 0) return null; // no meaningful baseline
  return round2(((current - previous) / previous) * 100);
}

/**
 * Compares `period` with the previous month. For an unfinished month, `like_for_like` compares the same number of days,
 * so a half-finished month is never judged against a full one.
 */
export function compareMonths({ expenses, period, today, budgets = [], prevBudgets = [] }) {
  const prev = shiftPeriod(period, -1);
  const isCurrent = periodOf(today) === period;
  const isFuture = period > periodOf(today);
  const daysElapsed = isCurrent ? Number(today.slice(8, 10)) : daysInPeriod(period);
  const cur = expenses.filter((e) => e.period === period);
  const prv = expenses.filter((e) => e.period === prev);
  const prvLike = isCurrent ? prv.filter((e) => Number(e.day.slice(8, 10)) <= daysElapsed) : prv;

  const catKeys = new Set([...cur, ...prv].map((e) => e.category));
  const mk = (a, b) => ({ current: round2(a), previous: round2(b), change: round2(a - b), changePct: pctChange(a, b) });
  const catCur = new Map(groupTotals(cur, (e) => e.category).map((g) => [g.key, g.total]));
  const catPrev = new Map(groupTotals(prv, (e) => e.category).map((g) => [g.key, g.total]));
  const catPrevLike = new Map(groupTotals(prvLike, (e) => e.category).map((g) => [g.key, g.total]));
  const categories = [...catKeys]
    .map((name) => ({
      category: name,
      ...mk(catCur.get(name) ?? 0, isCurrent ? catPrevLike.get(name) ?? 0 : catPrev.get(name) ?? 0),
      previousFullMonth: round2(catPrev.get(name) ?? 0),
    }))
    .sort((a, b) => b.change - a.change);

  const payCur = new Map(groupTotals(cur, (e) => e.paymentMode).map((g) => [g.key, g.total]));
  const payPrev = new Map(groupTotals(prvLike, (e) => e.paymentMode).map((g) => [g.key, g.total]));
  const payments = [...new Set([...payCur.keys(), ...payPrev.keys()])]
    .map((name) => ({ paymentMode: name, ...mk(payCur.get(name) ?? 0, payPrev.get(name) ?? 0) }))
    .sort((a, b) => b.current - a.current);

  const curTotal = sum(cur);
  const prevLikeTotal = sum(prvLike);
  const prevFullTotal = sum(prv);
  const drivers = categories.filter((c) => c.change > 0).slice(0, 3);
  const totalIncrease = Math.max(0, curTotal - prevLikeTotal);

  return {
    period,
    previousPeriod: prev,
    isCurrentMonth: isCurrent,
    isFutureMonth: isFuture,
    daysCompared: daysElapsed,
    basis: isCurrent ? 'like_for_like' : 'full_month',
    hasPreviousData: prv.length > 0,
    hasCurrentData: cur.length > 0,
    total: mk(curTotal, prevLikeTotal),
    previousFullMonthTotal: prevFullTotal,
    categories,
    payments,
    drivers: drivers.map((d) => ({ ...d, shareOfIncrease: totalIncrease > 0 ? round2((d.change / totalIncrease) * 100) : null })),
    budgets: budgets.map((b) => ({ category: b.category, limit: b.limit, spent: b.spent, percent: b.percent, previousPercent: prevBudgets.find((p) => p.category === b.category)?.percent ?? null })),
  };
}

export { periodRange };