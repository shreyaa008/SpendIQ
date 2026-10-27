import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Expense } from '../models/index.js';
import { validate, objectId } from '../middleware/validate.js';
import { ok, serializeExpense, assertOwnedRefs, escapeRegex } from './helpers.js';
import { notFound } from '../utils/errors.js';
import { parseDay, periodRange, isValidDay, round2, formatDay } from '../utils/dates.js';
import { toCsv, EXPENSE_CSV_HEADER, expenseCsvRow } from '../services/csv.js';
import { makeFingerprint } from '../models/Expense.js';

const router = Router();
const day = z.string().refine(isValidDay, 'Use YYYY-MM-DD');
const money = z.coerce.number({ message: 'Enter a number' }).positive('Amount must be greater than 0').max(100000000, 'Amount is too large');
const cur = z.string().length(3).toUpperCase();

const bodySchema = z.object({
  amount: money,
  description: z.string().trim().max(200).default(''),
  merchant: z.string().trim().max(120).default(''),
  category: objectId,
  paymentMode: objectId,
  date: day,
  originalAmount: z.coerce.number().positive().max(1e12).nullish(),
  originalCurrency: cur.nullish(),
});

const csvList = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().optional().refine((v) => csvList(v).every((x) => /^[0-9a-f]{24}$/i.test(x)), 'Invalid category id'),
  paymentMode: z.string().optional().refine((v) => csvList(v).every((x) => /^[0-9a-f]{24}$/i.test(x)), 'Invalid payment mode id'),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  from: day.optional(),
  to: day.optional(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  recurring: z.enum(['yes', 'no']).optional(),
  receipt: z.enum(['yes', 'no']).optional(),
  source: z.enum(['manual', 'csv', 'receipt', 'recurring', 'migration']).optional(),
  sort: z.enum(['dateDesc', 'dateAsc', 'amountDesc', 'amountAsc']).default('dateDesc'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const SORTS = { dateDesc: { date: -1, _id: -1 }, dateAsc: { date: 1, _id: 1 }, amountDesc: { amount: -1, _id: -1 }, amountAsc: { amount: 1, _id: 1 } };

export function buildFilter(userId, q) {
  const f = { user: userId };
  const and = [];
  const oid = (s) => new mongoose.Types.ObjectId(s);
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    and.push({ $or: [{ description: rx }, { merchant: rx }] });
  }
  const cats = csvList(q.category);
  if (cats.length) f.category = { $in: cats.map(oid) };
  const pays = csvList(q.paymentMode);
  if (pays.length) f.paymentMode = { $in: pays.map(oid) };
  if (q.minAmount != null || q.maxAmount != null) f.amount = { ...(q.minAmount != null ? { $gte: q.minAmount } : {}), ...(q.maxAmount != null ? { $lte: q.maxAmount } : {}) };
  const date = {};
  if (q.period) { const { start, end } = periodRange(q.period); date.$gte = start; date.$lt = end; }
  else if (q.year) { date.$gte = new Date(Date.UTC(q.year, 0, 1)); date.$lt = new Date(Date.UTC(q.year + 1, 0, 1)); }
  if (q.from) date.$gte = date.$gte && date.$gte > parseDay(q.from) ? date.$gte : parseDay(q.from);
  if (q.to) { const t = new Date(parseDay(q.to).getTime() + 86400000); date.$lt = date.$lt && date.$lt < t ? date.$lt : t; }
  if (Object.keys(date).length) f.date = date;
  if (q.recurring === 'yes') f.recurringRule = { $type: 'objectId' };
  if (q.recurring === 'no') f.recurringRule = null;
  if (q.receipt === 'yes') f.receipt = { $type: 'objectId' };
  if (q.receipt === 'no') f.receipt = null;
  if (q.source) f.source = q.source;
  if (and.length) f.$and = and;
  return f;
}

router.get('/', validate({ query: querySchema }), async (req, res) => {
  const q = req.valid.query;
  const filter = buildFilter(req.userId, q);
  const [items, agg] = await Promise.all([
    Expense.find(filter).sort(SORTS[q.sort]).skip((q.page - 1) * q.limit).limit(q.limit).populate('category', 'name color icon').populate('paymentMode', 'name'),
    Expense.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 }, max: { $max: '$amount' } } }]),
  ]);
  const { total = 0, count = 0, max = 0 } = agg[0] ?? {};
  ok(res, items.map(serializeExpense), 200, { page: q.page, limit: q.limit, count, pages: Math.max(1, Math.ceil(count / q.limit)), totalAmount: round2(total), average: count ? round2(total / count) : 0, highest: max });
});

router.get('/export.csv', validate({ query: querySchema.omit({ page: true, limit: true }) }), async (req, res) => {
  const q = req.valid.query;
  const docs = await Expense.find(buildFilter(req.userId, q)).sort(SORTS[q.sort]).limit(50000).populate('category', 'name').populate('paymentMode', 'name').lean();
  const rows = docs.map((e) => expenseCsvRow({ date: formatDay(e.date), description: e.description, merchant: e.merchant, category: e.category?.name ?? '', paymentMode: e.paymentMode?.name ?? '', amount: e.amount, recurring: Boolean(e.recurringRule), hasReceipt: Boolean(e.receipt), source: e.source }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spendiq-expenses${q.period ? `-${q.period}` : ''}.csv"`);
  res.send(toCsv(EXPENSE_CSV_HEADER, rows));
});

async function duplicateOf(userId, data, excludeId) {
  const fp = makeFingerprint({ date: parseDay(data.date), amount: data.amount, description: data.description, merchant: data.merchant });
  const hit = await Expense.findOne({ user: userId, fingerprint: fp, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).select('_id').lean();
  return hit ? String(hit._id) : null;
}

router.post('/', validate({ body: bodySchema }), async (req, res) => {
  const b = req.valid.body;
  await assertOwnedRefs(req.userId, b);
  const dup = await duplicateOf(req.userId, b);
  const e = await Expense.create({ ...b, user: req.userId, date: parseDay(b.date), currency: req.user.currency, source: 'manual' });
  await e.populate([{ path: 'category', select: 'name color icon' }, { path: 'paymentMode', select: 'name' }]);
  ok(res, serializeExpense(e), 201, dup ? { possibleDuplicateOf: dup } : undefined);
});

const idParam = z.object({ id: objectId });
router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const e = await Expense.findOne({ _id: req.valid.params.id, user: req.userId }).populate('category', 'name color icon').populate('paymentMode', 'name');
  if (!e) throw notFound('Expense not found');
  ok(res, serializeExpense(e));
});

router.put('/:id', validate({ params: idParam, body: bodySchema }), async (req, res) => {
  const b = req.valid.body;
  await assertOwnedRefs(req.userId, b);
  const e = await Expense.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!e) throw notFound('Expense not found');
  Object.assign(e, { ...b, date: parseDay(b.date), originalAmount: b.originalAmount ?? null, originalCurrency: b.originalCurrency ?? null });
  await e.save();
  await e.populate([{ path: 'category', select: 'name color icon' }, { path: 'paymentMode', select: 'name' }]);
  ok(res, serializeExpense(e));
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const e = await Expense.findOneAndDelete({ _id: req.valid.params.id, user: req.userId }).populate('category', 'name color icon').populate('paymentMode', 'name');
  if (!e) throw notFound('Expense not found');
  ok(res, { deleted: true, expense: serializeExpense(e) });
});

export default router;