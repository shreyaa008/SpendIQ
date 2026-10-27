import { SavingsGoal, Contribution } from '../models/index.js';
import { formatDay, parseDay, round2, todayStr } from '../utils/dates.js';

/** Months between two days, fractional (30.4375-day months). */
const monthsBetween = (fromDay, toDay) => (parseDay(toDay) - parseDay(fromDay)) / 86400000 / 30.4375;

export function describeGoal(goal, contribs, today = todayStr()) {
  const deposits = contribs.filter((c) => c.type !== 'withdrawal').reduce((t, c) => t + c.amount, 0);
  const withdrawals = contribs.filter((c) => c.type === 'withdrawal').reduce((t, c) => t + c.amount, 0);
  const saved = round2(Math.max(0, deposits - withdrawals));
  const remaining = round2(Math.max(0, goal.targetAmount - saved));
  const percent = round2(Math.min(100, (saved / goal.targetAmount) * 100));
  const targetDate = goal.targetDate ? formatDay(goal.targetDate) : null;
  const completed = saved >= goal.targetAmount;
  let status = 'active';
  if (completed) status = 'completed';
  else if (targetDate && targetDate < today) status = 'overdue';
  else if (targetDate) {
    // "behind" when the straight-line plan from the goal's creation to the target date says we should have saved more
    const created = formatDay(goal.createdAt ?? new Date());
    const total = Math.max(1, (parseDay(targetDate) - parseDay(created)) / 86400000);
    const elapsed = Math.max(0, (parseDay(today) - parseDay(created)) / 86400000);
    if (elapsed > 30 && saved / goal.targetAmount < (elapsed / total) * 0.7) status = 'behind';
  }
  let requiredMonthly = null;
  let monthsLeft = null;
  if (!completed && targetDate && targetDate >= today) {
    monthsLeft = Math.max(monthsBetween(today, targetDate), 1 / 30.4375);
    requiredMonthly = round2(remaining / Math.max(1, Math.ceil(monthsLeft - 0.001)));
  }
  const last90 = contribs.filter((c) => c.type !== 'withdrawal' && formatDay(c.date) >= formatDay(new Date(parseDay(today) - 90 * 86400000)));
  const recentMonthly = last90.length ? round2(last90.reduce((t, c) => t + c.amount, 0) / 3) : 0;
  return {
    id: String(goal._id),
    title: goal.title,
    targetAmount: goal.targetAmount,
    targetDate,
    note: goal.note ?? '',
    saved,
    remaining,
    percent,
    status,
    requiredMonthly,
    monthsLeft: monthsLeft == null ? null : round2(monthsLeft),
    recentMonthlyAverage: recentMonthly,
    onTrack: requiredMonthly == null ? null : recentMonthly >= requiredMonthly,
    contributionCount: contribs.length,
    lastContribution: contribs.length ? formatDay(contribs.reduce((m, c) => (c.date > m ? c.date : m), contribs[0].date)) : null,
    createdAt: goal.createdAt,
  };
}

export async function listGoals(userId, today = todayStr()) {
  const [goals, contribs] = await Promise.all([
    SavingsGoal.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    Contribution.find({ user: userId }).lean(),
  ]);
  const byGoal = new Map();
  for (const c of contribs) {
    const k = String(c.goal);
    if (!byGoal.has(k)) byGoal.set(k, []);
    byGoal.get(k).push(c);
  }
  return goals.map((g) => describeGoal(g, byGoal.get(String(g._id)) ?? [], today));
}