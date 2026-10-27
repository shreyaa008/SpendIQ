import { Router } from 'express';
import { z } from 'zod';
import { Budget, Income } from '../models/index.js';
import { validate, objectId } from '../middleware/validate.js';
import { ok, assertOwnedRefs } from './helpers.js';
import { notFound } from '../utils/errors.js';
import { PERIOD_RE, currentPeriod, shiftPeriod, periodRange, formatDay } from '../utils/dates.js';
import { loadExpenses, budgetStatuses } from '../services/analytics.js';

export const budgetRouter = Router();
export const incomeRouter = Router();
const period = z.string().regex(PERIOD_RE, 'Use YYYY-MM');
const bodySchema = z.object({
  category: objectId,
  period: z.union([z.literal('default'), period]).default('default'),
  limit: z.coerce.number().positive('Limit must be greater than 0').max(100000000),
  threshold: z.coerce.number().min(1, 'Between 1 and 100').max(100, 'Between 1 and 100').nullish(),
});

budgetRouter.get('/', validate({ query: z.object({ period: period.optional() }) }), async (req, res) => {
  const p = req.valid.query.period ?? currentPeriod();
  const { start, end } = periodRange(p);
  const expenses = await loadExpenses(req.userId, formatDay(start), formatDay(new Date(end - 86400000)));
  const statuses = await budgetStatuses(req.user, p, expenses);
  ok(res, statuses, 200, { period: p, warningThreshold: req.user.warningThreshold });
});

// Create-or-update: one budget per category per period.
budgetRouter.post('/', validate({ body: bodySchema }), async (req, res) => {
  const b = req.valid.body;
  await assertOwnedRefs(req.userId, { category: b.category });
  const doc = await Budget.findOneAndUpdate({ user: req.userId, category: b.category, period: b.period }, { $set: { limit: b.limit, threshold: b.threshold ?? null } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
  ok(res, { id: String(doc._id), category: String(doc.category), period: doc.period, limit: doc.limit, threshold: doc.threshold }, 201);
});

budgetRouter.put('/:id', validate({ params: z.object({ id: objectId }), body: bodySchema.pick({ limit: true, threshold: true }) }), async (req, res) => {
  const doc = await Budget.findOneAndUpdate({ _id: req.valid.params.id, user: req.userId }, { $set: { limit: req.valid.body.limit, threshold: req.valid.body.threshold ?? null } }, { returnDocument: 'after' });
  if (!doc) throw notFound('Budget not found');
  ok(res, { id: String(doc._id), category: String(doc.category), period: doc.period, limit: doc.limit, threshold: doc.threshold });
});

budgetRouter.delete('/:id', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  const doc = await Budget.findOneAndDelete({ _id: req.valid.params.id, user: req.userId });
  if (!doc) throw notFound('Budget not found');
  ok(res, { deleted: true });
});

// Copy a month's effective budgets into another month (handy at month start).
budgetRouter.post('/copy', validate({ body: z.object({ from: period, to: period }) }), async (req, res) => {
  const { from, to } = req.valid.body;
  const src = await Budget.find({ user: req.userId, period: { $in: ['default', from] } }).lean();
  let n = 0;
  for (const b of src) {
    await Budget.updateOne({ user: req.userId, category: b.category, period: to }, { $setOnInsert: { limit: b.limit, threshold: b.threshold } }, { upsert: true });
    n += 1;
  }
  ok(res, { copied: n });
});

// ---- monthly income (kept from the original app) ----
incomeRouter.get('/', validate({ query: z.object({ period: period.optional() }) }), async (req, res) => {
  const p = req.valid.query.period ?? currentPeriod();
  const doc = await Income.findOne({ user: req.userId, period: p }).lean();
  ok(res, { period: p, amount: doc ? doc.amount : null });
});
incomeRouter.put('/', validate({ body: z.object({ period, amount: z.coerce.number().min(0).max(1000000000) }) }), async (req, res) => {
  const { period: p, amount } = req.valid.body;
  const doc = await Income.findOneAndUpdate({ user: req.userId, period: p }, { $set: { amount } }, { upsert: true, returnDocument: 'after' });
  ok(res, { period: doc.period, amount: doc.amount });
});
incomeRouter.delete('/', validate({ query: z.object({ period }) }), async (req, res) => {
  await Income.deleteOne({ user: req.userId, period: req.valid.query.period });
  ok(res, { deleted: true });
});
void shiftPeriod;