import { Router } from 'express';
import { z } from 'zod';
import { SavingsGoal, Contribution } from '../models/index.js';
import { validate, objectId } from '../middleware/validate.js';
import { ok } from './helpers.js';
import { notFound, badRequest } from '../utils/errors.js';
import { isValidDay, parseDay, formatDay, todayStr } from '../utils/dates.js';
import { describeGoal, listGoals } from '../services/goals.js';

const router = Router();
const day = z.string().refine(isValidDay, 'Use YYYY-MM-DD');
const goalBody = z.object({
  title: z.string().trim().min(1, 'Enter a title').max(80),
  targetAmount: z.coerce.number().min(1, 'Target must be at least 1').max(1000000000),
  targetDate: day.nullish(),
  note: z.string().trim().max(300).default(''),
});
const contribBody = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0').max(1000000000),
  type: z.enum(['deposit', 'withdrawal']).default('deposit'),
  date: day.default(() => todayStr()),
  note: z.string().trim().max(200).default(''),
});
const idParam = z.object({ id: objectId });

const one = async (userId, id) => {
  const g = await SavingsGoal.findOne({ _id: id, user: userId });
  if (!g) throw notFound('Goal not found');
  return g;
};
const view = async (userId, g) => describeGoal(g.toObject(), await Contribution.find({ user: userId, goal: g._id }).lean());

router.get('/', async (req, res) => ok(res, await listGoals(req.userId)));

router.post('/', validate({ body: goalBody }), async (req, res) => {
  const b = req.valid.body;
  const g = await SavingsGoal.create({ ...b, targetDate: b.targetDate ? parseDay(b.targetDate) : null, user: req.userId });
  ok(res, await view(req.userId, g), 201);
});

router.put('/:id', validate({ params: idParam, body: goalBody }), async (req, res) => {
  const g = await one(req.userId, req.valid.params.id);
  const b = req.valid.body;
  Object.assign(g, { ...b, targetDate: b.targetDate ? parseDay(b.targetDate) : null });
  await g.save();
  ok(res, await view(req.userId, g));
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const g = await one(req.userId, req.valid.params.id);
  await Contribution.deleteMany({ user: req.userId, goal: g._id });
  await g.deleteOne();
  ok(res, { deleted: true });
});

router.get('/:id/contributions', validate({ params: idParam }), async (req, res) => {
  const g = await one(req.userId, req.valid.params.id);
  const rows = await Contribution.find({ user: req.userId, goal: g._id }).sort({ date: -1, _id: -1 }).lean();
  ok(res, rows.map((c) => ({ id: String(c._id), type: c.type, amount: c.amount, date: formatDay(c.date), note: c.note })));
});

router.post('/:id/contributions', validate({ params: idParam, body: contribBody }), async (req, res) => {
  const g = await one(req.userId, req.valid.params.id);
  const b = req.valid.body;
  if (b.type === 'withdrawal') {
    const current = await view(req.userId, g);
    if (b.amount > current.saved) throw badRequest(`You can withdraw at most ${current.saved} from this goal.`);
  }
  await Contribution.create({ ...b, date: parseDay(b.date), user: req.userId, goal: g._id });
  ok(res, await view(req.userId, g), 201);
});

router.delete('/:id/contributions/:cid', validate({ params: z.object({ id: objectId, cid: objectId }) }), async (req, res) => {
  const g = await one(req.userId, req.valid.params.id);
  const r = await Contribution.deleteOne({ _id: req.valid.params.cid, user: req.userId, goal: g._id });
  if (!r.deletedCount) throw notFound('Contribution not found');
  ok(res, await view(req.userId, g));
});

export default router;