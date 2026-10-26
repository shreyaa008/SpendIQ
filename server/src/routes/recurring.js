import { Router } from 'express';
import { z } from 'zod';
import { RecurringRule } from '../models/index.js';
import { validate, objectId } from '../middleware/validate.js';
import { ok, assertOwnedRefs, serializeExpense } from './helpers.js';
import { notFound, badRequest } from '../utils/errors.js';
import { isValidDay, parseDay, todayStr, addDays, formatDay } from '../utils/dates.js';
import { serializeRule, recomputePointer, postOccurrence, skipOccurrence, processDueRules, upcomingOccurrences, firstOccurrenceOnOrAfter } from '../services/recurring.js';

const router = Router();
const day = z.string().refine(isValidDay, 'Use YYYY-MM-DD');
const body = z.object({
  description: z.string().trim().min(1, 'Enter a description').max(200),
  amount: z.coerce.number().positive('Amount must be greater than 0').max(100000000),
  category: objectId,
  paymentMode: objectId,
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  startDate: day,
  endDate: day.nullish(),
  autoPost: z.boolean().default(false),
});
const idParam = z.object({ id: objectId });
const populate = (q) => q.populate('category', 'name color').populate('paymentMode', 'name');

const load = async (userId, id) => {
  const r = await populate(RecurringRule.findOne({ _id: id, user: userId }));
  if (!r) throw notFound('Recurring rule not found');
  return r;
};

router.get('/', async (req, res) => {
  await processDueRules(req.userId); // only affects rules the user opted into with autoPost; idempotent
  const rules = await populate(RecurringRule.find({ user: req.userId }).sort({ status: 1, nextDueDate: 1 }));
  const today = todayStr();
  const upcoming = await upcomingOccurrences(req.userId, today, formatDay(addDays(parseDay(today), 45)), { includeOverdue: true });
  ok(res, { rules: rules.map((r) => serializeRule(r, today)), upcoming });
});

router.post('/', validate({ body }), async (req, res) => {
  const b = req.valid.body;
  if (b.endDate && b.endDate < b.startDate) throw badRequest('The end date must be after the start date.', { details: { endDate: 'Must be after start date' } });
  await assertOwnedRefs(req.userId, b);
  const rule = new RecurringRule({ ...b, user: req.userId, startDate: parseDay(b.startDate), endDate: b.endDate ? parseDay(b.endDate) : null });
  rule.nextDueDate = firstOccurrenceOnOrAfter(rule, rule.startDate);
  await rule.save();
  ok(res, serializeRule(await load(req.userId, rule._id)), 201);
});

router.put('/:id', validate({ params: idParam, body }), async (req, res) => {
  const b = req.valid.body;
  if (b.endDate && b.endDate < b.startDate) throw badRequest('The end date must be after the start date.', { details: { endDate: 'Must be after start date' } });
  await assertOwnedRefs(req.userId, b);
  const rule = await RecurringRule.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!rule) throw notFound('Recurring rule not found');
  const scheduleChanged = b.frequency !== rule.frequency || b.startDate !== formatDay(rule.startDate) || (b.endDate ?? null) !== (rule.endDate ? formatDay(rule.endDate) : null);
  Object.assign(rule, { ...b, startDate: parseDay(b.startDate), endDate: b.endDate ? parseDay(b.endDate) : null });
  if (scheduleChanged) rule.nextDueDate = await recomputePointer(rule);
  await rule.save();
  ok(res, serializeRule(await load(req.userId, rule._id)));
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const r = await RecurringRule.findOneAndDelete({ _id: req.valid.params.id, user: req.userId });
  if (!r) throw notFound('Recurring rule not found');
  ok(res, { deleted: true }); // already-posted expenses stay in the ledger
});

router.post('/:id/pause', validate({ params: idParam }), async (req, res) => {
  const rule = await load(req.userId, req.valid.params.id);
  rule.status = 'paused';
  await rule.save();
  ok(res, serializeRule(rule));
});

router.post('/:id/resume', validate({ params: idParam }), async (req, res) => {
  const rule = await load(req.userId, req.valid.params.id);
  rule.status = 'active';
  rule.nextDueDate = await recomputePointer(rule, { notBefore: parseDay(todayStr()) }); // payments missed while paused are not back-filled
  await rule.save();
  ok(res, serializeRule(rule));
});

const occBody = z.object({ occurrence: day.optional() });
router.post('/:id/post', validate({ params: idParam, body: occBody }), async (req, res) => {
  const out = await postOccurrence(req.userId, req.valid.params.id, todayStr(), req.valid.body.occurrence ?? null);
  const rule = await load(req.userId, req.valid.params.id);
  if (out.expense) await out.expense.populate([{ path: 'category', select: 'name color icon' }, { path: 'paymentMode', select: 'name' }]);
  ok(res, { rule: serializeRule(rule), expense: out.expense ? serializeExpense(out.expense) : null, occurrence: out.occurrence }, 201);
});

router.post('/:id/skip', validate({ params: idParam, body: occBody }), async (req, res) => {
  const out = await skipOccurrence(req.userId, req.valid.params.id, req.valid.body.occurrence ?? null);
  ok(res, { rule: serializeRule(await load(req.userId, req.valid.params.id)), skipped: out.skipped });
});

router.post('/process', async (req, res) => ok(res, await processDueRules(req.userId)));

export default router;