// Recurring rules are *schedules*, not transactions. A rule never creates an expense by itself;
// an occurrence becomes an expense only when it is posted, and posting is idempotent (unique index + compare-and-swap).
import { RecurringRule, Expense } from '../models/index.js';
import { addDays, addMonthsClamped, formatDay, parseDay, round2, periodRange, todayStr } from '../utils/dates.js';
import { bus } from '../utils/events.js';
import { conflict, notFound } from '../utils/errors.js';

const MAX_AUTOPOST_PER_RULE = 36;

/** k-th occurrence, always computed from the start date (so Jan 31 → Feb 28 → Mar 31, with no drift). */
export function occurrenceAt(rule, k) {
  const start = new Date(rule.startDate);
  if (rule.frequency === 'weekly') return addDays(start, 7 * k);
  if (rule.frequency === 'monthly') return addMonthsClamped(start, k);
  return addMonthsClamped(start, 12 * k);
}

/** Smallest occurrence date >= `from` (and within start/end bounds), or null. */
export function firstOccurrenceOnOrAfter(rule, from) {
  const start = new Date(rule.startDate);
  const target = new Date(from) > start ? new Date(from) : start;
  let k = 0;
  const ms = target - start;
  if (rule.frequency === 'weekly') k = Math.max(0, Math.floor(ms / (7 * 86400000)) - 1);
  else {
    const months = (target.getUTCFullYear() - start.getUTCFullYear()) * 12 + (target.getUTCMonth() - start.getUTCMonth());
    k = Math.max(0, Math.floor(months / (rule.frequency === 'yearly' ? 12 : 1)) - 1);
  }
  for (let guard = 0; guard < 5000; guard++, k++) {
    const occ = occurrenceAt(rule, k);
    if (rule.endDate && occ > new Date(rule.endDate)) return null;
    if (occ >= target) return occ;
  }
  return null;
}

/** Occurrences with from <= date <= to (inclusive), honouring start/end dates. */
export function occurrencesBetween(rule, from, to, limit = 400) {
  const out = [];
  let cursor = firstOccurrenceOnOrAfter(rule, from);
  while (cursor && cursor <= new Date(to) && out.length < limit) {
    out.push(cursor);
    cursor = firstOccurrenceOnOrAfter(rule, addDays(cursor, 1));
  }
  return out;
}

export const nextAfter = (rule, date) => firstOccurrenceOnOrAfter(rule, addDays(date, 1));

/** Pointer = first occurrence after the last one already posted (never before the start date). */
export async function recomputePointer(rule, { notBefore = null } = {}) {
  const last = await Expense.findOne({ user: rule.user, recurringRule: rule._id }).sort({ occurrenceDate: -1 }).select('occurrenceDate').lean();
  let from = new Date(rule.startDate);
  if (last?.occurrenceDate) from = addDays(last.occurrenceDate, 1);
  if (notBefore && new Date(notBefore) > from) from = new Date(notBefore);
  return firstOccurrenceOnOrAfter(rule, from);
}

export function serializeRule(rule, today = todayStr()) {
  const next = rule.nextDueDate ? formatDay(rule.nextDueDate) : null;
  const due = rule.status === 'active' && next && next <= today;
  return {
    id: String(rule._id),
    description: rule.description,
    amount: rule.amount,
    category: rule.category && rule.category._id ? { id: String(rule.category._id), name: rule.category.name, color: rule.category.color } : { id: String(rule.category) },
    paymentMode: rule.paymentMode && rule.paymentMode._id ? { id: String(rule.paymentMode._id), name: rule.paymentMode.name } : { id: String(rule.paymentMode) },
    frequency: rule.frequency,
    startDate: formatDay(rule.startDate),
    endDate: rule.endDate ? formatDay(rule.endDate) : null,
    status: rule.status,
    autoPost: rule.autoPost,
    nextDueDate: next,
    isDue: Boolean(due),
    isEnded: rule.nextDueDate == null,
    estimatedMonthly: rule.frequency === 'weekly' ? round2((rule.amount * 52) / 12) : rule.frequency === 'yearly' ? round2(rule.amount / 12) : rule.amount,
  };
}

/** Posts exactly one occurrence. Safe against double clicks, retries and concurrent requests. */
export async function postOccurrence(userId, ruleId, today = todayStr(), expectedOccurrence = null) {
  const rule = await RecurringRule.findOne({ _id: ruleId, user: userId });
  if (!rule) throw notFound('Recurring rule not found');
  if (!rule.nextDueDate) throw conflict('This rule has no remaining payments.');
  const occ = rule.nextDueDate;
  // The caller names the occurrence it means to pay, so a repeated click or retry can never pay the *next* one by accident.
  if (expectedOccurrence && expectedOccurrence !== formatDay(occ)) throw conflict('That payment was already recorded.');
  const next = nextAfter(rule, occ);
  // Compare-and-swap: only the request that still sees the old pointer may advance it.
  const claimed = await RecurringRule.findOneAndUpdate({ _id: rule._id, user: userId, nextDueDate: occ }, { $set: { nextDueDate: next } }, { returnDocument: 'after' });
  if (!claimed) throw conflict('That payment was already recorded.');
  try {
    const expense = await Expense.create({
      user: userId,
      amount: rule.amount,
      description: rule.description,
      category: rule.category,
      paymentMode: rule.paymentMode,
      date: occ,
      source: 'recurring',
      recurringRule: rule._id,
      occurrenceDate: occ,
    });
    bus.emit('data:changed', { userId: String(userId) });
    return { expense, occurrence: formatDay(occ), rule: claimed };
  } catch (err) {
    if (err?.code === 11000) return { expense: null, occurrence: formatDay(occ), rule: claimed, alreadyPosted: true };
    await RecurringRule.updateOne({ _id: rule._id, nextDueDate: next }, { $set: { nextDueDate: occ } }); // roll the pointer back
    throw err;
  }
}

export async function skipOccurrence(userId, ruleId, expectedOccurrence = null) {
  const rule = await RecurringRule.findOne({ _id: ruleId, user: userId });
  if (!rule) throw notFound('Recurring rule not found');
  if (!rule.nextDueDate) throw conflict('This rule has no remaining payments.');
  const occ = rule.nextDueDate;
  if (expectedOccurrence && expectedOccurrence !== formatDay(occ)) throw conflict('That payment was already handled.');
  const claimed = await RecurringRule.findOneAndUpdate({ _id: rule._id, user: userId, nextDueDate: occ }, { $set: { nextDueDate: nextAfter(rule, occ) } }, { returnDocument: 'after' });
  if (!claimed) throw conflict('That payment was already handled.');
  bus.emit('data:changed', { userId: String(userId) });
  return { skipped: formatDay(occ), rule: claimed };
}

/** Auto-post rules (opt-in) that are due. Running it any number of times never creates duplicates. */
export async function processDueRules(userId, today = todayStr()) {
  const filter = { status: 'active', autoPost: true, nextDueDate: { $ne: null, $lte: parseDay(today) } };
  if (userId) filter.user = userId;
  const rules = await RecurringRule.find(filter).select('_id user').lean();
  let posted = 0;
  for (const r of rules) {
    for (let i = 0; i < MAX_AUTOPOST_PER_RULE; i++) {
      try {
        const res = await postOccurrence(r.user, r._id, today);
        if (res.expense) posted += 1;
      } catch (e) {
        if (e.status === 409 || e.status === 404) break;
        throw e;
      }
      const fresh = await RecurringRule.findById(r._id).select('nextDueDate status').lean();
      if (!fresh?.nextDueDate || fresh.nextDueDate > parseDay(today) || fresh.status !== 'active') break;
    }
  }
  return { posted, rules: rules.length };
}

/** Unposted occurrences of active rules inside [from, to] — what the user still expects to pay. */
export async function upcomingOccurrences(userId, from, to, { includeOverdue = false } = {}) {
  const rules = await RecurringRule.find({ user: userId, status: 'active' }).populate('category', 'name color').populate('paymentMode', 'name').lean();
  const out = [];
  for (const r of rules) {
    if (!r.nextDueDate) continue;
    const lower = includeOverdue ? r.nextDueDate : new Date(Math.max(r.nextDueDate, parseDay(from)));
    for (const occ of occurrencesBetween(r, lower < r.nextDueDate ? r.nextDueDate : lower, parseDay(to), 60)) {
      if (!includeOverdue && occ < parseDay(from)) continue;
      out.push({ ruleId: String(r._id), description: r.description, amount: r.amount, category: r.category?.name ?? '', categoryId: r.category?._id ? String(r.category._id) : null, date: formatDay(occ), frequency: r.frequency });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Scheduled (not yet posted) recurring amount per period, used by forecasts and reports. */
export async function scheduledForPeriod(userId, period) {
  const { start, end } = periodRange(period);
  const lastDay = addDays(end, -1);
  const items = await upcomingOccurrences(userId, formatDay(start), formatDay(lastDay), { includeOverdue: false });
  const byCategory = {};
  let total = 0;
  for (const i of items) {
    total += i.amount;
    byCategory[i.category] = (byCategory[i.category] ?? 0) + i.amount;
  }
  return { total: round2(total), byCategory, items };
}