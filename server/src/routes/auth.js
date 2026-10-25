// Topic 40: validation, bcrypt, JWT, protected routes.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User, Expense, Budget, Income, SavingsGoal, Contribution, RecurringRule, Category, PaymentMode, Receipt, DismissedAlert, ChatMessage, ImportLog } from '../models/index.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, signToken, cookieOptions, COOKIE_NAME } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { seedWorkspace } from '../services/workspace.js';
import { ok } from './helpers.js';
import { AppError, unauthorized } from '../utils/errors.js';
import { removeUserFiles } from '../services/storage.js';
import { bus } from '../utils/events.js';

const router = Router();
const password = z.string().min(8, 'Use at least 8 characters').max(128, 'Use at most 128 characters').refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number');
const registerSchema = z.object({ name: z.string().trim().min(2, 'Enter your name').max(60), email: z.string().trim().toLowerCase().email('Enter a valid email').max(254), password, currency: z.string().length(3).toUpperCase().optional() });
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email'), password: z.string().min(1, 'Enter your password').max(128) });
// A fixed hash so a login for an unknown email takes about as long as a real one (no account enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-0', 10);

router.post('/register', authLimiter, validate({ body: registerSchema }), async (req, res) => {
  const { name, email, password: pw, currency } = req.valid.body;
  if (await User.exists({ email })) throw new AppError(409, 'An account with this email already exists.', { code: 'EMAIL_TAKEN', details: { email: 'Already registered' } });
  const user = await User.create({ name, email, passwordHash: await bcrypt.hash(pw, 12), ...(currency ? { currency } : {}) });
  await seedWorkspace(user._id);
  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
  ok(res, { user: user.toSafe(), token: signToken(user) }, 201);
});

router.post('/login', authLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password: pw } = req.valid.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const good = await bcrypt.compare(pw, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !good) throw unauthorized('Incorrect email or password.');
  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
  ok(res, { user: user.toSafe(), token: signToken(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  ok(res, { loggedOut: true });
});

router.use(requireAuth);

router.post('/logout-all', async (req, res) => {
  await User.updateOne({ _id: req.userId }, { $inc: { tokenVersion: 1 } });
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  ok(res, { loggedOut: true });
});

router.get('/me', (req, res) => ok(res, { user: req.user.toSafe() }));

const profileSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  currency: z.string().length(3).toUpperCase().regex(/^[A-Z]{3}$/).optional(),
  warningThreshold: z.coerce.number().min(1).max(100).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  browserNotifications: z.boolean().optional(),
});
router.put('/me', validate({ body: profileSchema }), async (req, res) => {
  Object.assign(req.user, req.valid.body);
  await req.user.save();
  bus.emit('data:changed', { userId: String(req.userId) });
  ok(res, { user: req.user.toSafe() });
});

router.post('/me/password', authLimiter, validate({ body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }) }), async (req, res) => {
  const user = await User.findById(req.userId).select('+passwordHash');
  if (!(await bcrypt.compare(req.valid.body.currentPassword, user.passwordHash))) throw new AppError(400, 'Your current password is not correct.', { code: 'BAD_PASSWORD', details: { currentPassword: 'Incorrect password' } });
  user.passwordHash = await bcrypt.hash(req.valid.body.newPassword, 12);
  user.tokenVersion += 1; // signs out every other session
  await user.save();
  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
  ok(res, { changed: true, token: signToken(user) });
});

router.delete('/me', authLimiter, validate({ body: z.object({ password: z.string().min(1).max(128) }) }), async (req, res) => {
  const user = await User.findById(req.userId).select('+passwordHash');
  if (!(await bcrypt.compare(req.valid.body.password, user.passwordHash))) throw new AppError(400, 'Password is not correct.', { code: 'BAD_PASSWORD', details: { password: 'Incorrect password' } });
  const f = { user: req.userId };
  await Promise.all([Expense, Budget, Income, SavingsGoal, Contribution, RecurringRule, Category, PaymentMode, Receipt, DismissedAlert, ChatMessage, ImportLog].map((m) => m.deleteMany(f)));
  await removeUserFiles(req.userId);
  await User.deleteOne({ _id: req.userId });
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  ok(res, { deleted: true });
});

export default router;