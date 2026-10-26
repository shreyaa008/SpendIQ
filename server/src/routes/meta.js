import { Router } from 'express';
import { z } from 'zod';
import { Category, PaymentMode, Expense, Budget, RecurringRule, CATEGORY_ICONS } from '../models/index.js';
import { validate, objectId } from '../middleware/validate.js';
import { ok } from './helpers.js';
import { conflict, notFound, badRequest } from '../utils/errors.js';

export const categoryRouter = Router();
export const paymentRouter = Router();

const catBody = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(40),
  icon: z.enum(CATEGORY_ICONS).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1f7a4d').optional(),
});
const idParam = z.object({ id: objectId });
const delQuery = z.object({ reassignTo: objectId.optional() });

async function usage(Model, userId, id, key) {
  const [expenses, recurring, budgets] = await Promise.all([
    Expense.countDocuments({ user: userId, [key]: id }),
    RecurringRule.countDocuments({ user: userId, [key]: id }),
    key === 'category' ? Budget.countDocuments({ user: userId, category: id }) : 0,
  ]);
  return { expenses, recurring, budgets, total: expenses + recurring + budgets };
}

// ---- categories ----
categoryRouter.get('/', async (req, res) => {
  const cats = await Category.find({ user: req.userId }).sort({ name: 1 }).lean();
  const counts = await Expense.aggregate([{ $match: { user: req.userId } }, { $group: { _id: '$category', n: { $sum: 1 } } }]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  ok(res, cats.map((c) => ({ id: String(c._id), name: c.name, icon: c.icon, color: c.color, isDefault: c.isDefault, isFallback: c.isFallback, expenseCount: byId.get(String(c._id)) ?? 0 })));
});

categoryRouter.post('/', validate({ body: catBody }), async (req, res) => {
  const { name, icon, color } = req.valid.body;
  if (await Category.exists({ user: req.userId, nameKey: name.toLowerCase() })) throw conflict('You already have a category with that name.', { details: { name: 'Already exists' } });
  const c = await Category.create({ user: req.userId, name, ...(icon ? { icon } : {}), ...(color ? { color } : {}) });
  ok(res, { id: String(c._id), name: c.name, icon: c.icon, color: c.color, isDefault: false, isFallback: false, expenseCount: 0 }, 201);
});

categoryRouter.put('/:id', validate({ params: idParam, body: catBody.partial() }), async (req, res) => {
  const c = await Category.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!c) throw notFound('Category not found');
  const { name, icon, color } = req.valid.body;
  if (name && name !== c.name) {
    if (c.isFallback) throw badRequest('The “Other” category cannot be renamed.');
    if (await Category.exists({ user: req.userId, nameKey: name.toLowerCase(), _id: { $ne: c._id } })) throw conflict('You already have a category with that name.', { details: { name: 'Already exists' } });
    c.name = name;
  }
  if (icon) c.icon = icon;
  if (color) c.color = color;
  await c.save();
  ok(res, { id: String(c._id), name: c.name, icon: c.icon, color: c.color, isDefault: c.isDefault, isFallback: c.isFallback });
});

categoryRouter.delete('/:id', validate({ params: idParam, query: delQuery }), async (req, res) => {
  const c = await Category.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!c) throw notFound('Category not found');
  if (c.isFallback) throw badRequest('The “Other” category is the safe fallback and cannot be deleted.');
  const use = await usage(Category, req.userId, c._id, 'category');
  const target = req.valid.query.reassignTo;
  if (use.total > 0) {
    if (!target) throw conflict(`“${c.name}” is used by ${use.expenses} expense(s), ${use.recurring} recurring rule(s) and ${use.budgets} budget(s). Choose a category to move them to.`, { details: { usage: use } });
    if (target === String(c._id)) throw badRequest('Choose a different category to move records to.');
    if (!(await Category.exists({ _id: target, user: req.userId }))) throw badRequest('The category to move records to does not exist.');
    await Expense.updateMany({ user: req.userId, category: c._id }, { $set: { category: target } });
    await RecurringRule.updateMany({ user: req.userId, category: c._id }, { $set: { category: target } });
    // Budgets: keep the target's own budget where one already exists for that period; otherwise move ours.
    for (const b of await Budget.find({ user: req.userId, category: c._id })) {
      if (await Budget.exists({ user: req.userId, category: target, period: b.period })) await b.deleteOne();
      else { b.category = target; await b.save(); }
    }
  }
  await c.deleteOne();
  ok(res, { deleted: true, moved: use.total });
});

// ---- payment modes ----
const payBody = z.object({ name: z.string().trim().min(1, 'Enter a name').max(40) });
paymentRouter.get('/', async (req, res) => {
  const pays = await PaymentMode.find({ user: req.userId }).sort({ name: 1 }).lean();
  const counts = await Expense.aggregate([{ $match: { user: req.userId } }, { $group: { _id: '$paymentMode', n: { $sum: 1 } } }]);
  const byId = new Map(counts.map((c) => [String(c._id), c.n]));
  ok(res, pays.map((p) => ({ id: String(p._id), name: p.name, isDefault: p.isDefault, expenseCount: byId.get(String(p._id)) ?? 0 })));
});
paymentRouter.post('/', validate({ body: payBody }), async (req, res) => {
  const { name } = req.valid.body;
  if (await PaymentMode.exists({ user: req.userId, nameKey: name.toLowerCase() })) throw conflict('You already have a payment mode with that name.', { details: { name: 'Already exists' } });
  const p = await PaymentMode.create({ user: req.userId, name });
  ok(res, { id: String(p._id), name: p.name, isDefault: false, expenseCount: 0 }, 201);
});
paymentRouter.put('/:id', validate({ params: idParam, body: payBody }), async (req, res) => {
  const p = await PaymentMode.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!p) throw notFound('Payment mode not found');
  const { name } = req.valid.body;
  if (await PaymentMode.exists({ user: req.userId, nameKey: name.toLowerCase(), _id: { $ne: p._id } })) throw conflict('You already have a payment mode with that name.', { details: { name: 'Already exists' } });
  p.name = name;
  await p.save();
  ok(res, { id: String(p._id), name: p.name, isDefault: p.isDefault });
});
paymentRouter.delete('/:id', validate({ params: idParam, query: delQuery }), async (req, res) => {
  const p = await PaymentMode.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!p) throw notFound('Payment mode not found');
  if ((await PaymentMode.countDocuments({ user: req.userId })) <= 1) throw badRequest('You need at least one payment mode.');
  const use = await usage(PaymentMode, req.userId, p._id, 'paymentMode');
  const target = req.valid.query.reassignTo;
  if (use.total > 0) {
    if (!target) throw conflict(`“${p.name}” is used by ${use.expenses} expense(s) and ${use.recurring} recurring rule(s). Choose a payment mode to move them to.`, { details: { usage: use } });
    if (target === String(p._id)) throw badRequest('Choose a different payment mode to move records to.');
    if (!(await PaymentMode.exists({ _id: target, user: req.userId }))) throw badRequest('The payment mode to move records to does not exist.');
    await Expense.updateMany({ user: req.userId, paymentMode: p._id }, { $set: { paymentMode: target } });
    await RecurringRule.updateMany({ user: req.userId, paymentMode: p._id }, { $set: { paymentMode: target } });
  }
  await p.deleteOne();
  ok(res, { deleted: true, moved: use.total });
});