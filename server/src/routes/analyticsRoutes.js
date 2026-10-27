import { Router } from 'express';
import { z } from 'zod';
import { DismissedAlert, ChatMessage } from '../models/index.js';
import { validate } from '../middleware/validate.js';
import { expensiveLimiter } from '../middleware/rateLimit.js';
import { ok } from './helpers.js';
import { PERIOD_RE, currentPeriod } from '../utils/dates.js';
import { buildMonthlyReport, buildDashboard } from '../services/reports.js';
import { getForecast } from '../services/forecast.js';
import { getInsights } from '../services/insights.js';
import { answerQuestion } from '../services/chat.js';
import { toCsv } from '../services/csv.js';
import { aiEnabled } from '../config/env.js';
import { getCategoryMap } from '../services/analytics.js';

export const dashboardRouter = Router();
export const reportRouter = Router();
export const forecastRouter = Router();
export const insightRouter = Router();
export const chatRouter = Router();

const periodQuery = z.object({ period: z.string().regex(PERIOD_RE, 'Use YYYY-MM').optional() });

dashboardRouter.get('/', validate({ query: periodQuery }), async (req, res) => ok(res, await buildDashboard(req.user, req.valid.query.period ?? currentPeriod())));

reportRouter.get('/monthly', validate({ query: periodQuery }), async (req, res) => {
  const report = await buildMonthlyReport(req.user, req.valid.query.period ?? currentPeriod());
  const colors = await getCategoryMap(req.userId);
  const colorByName = new Map([...colors.values()].map((c) => [c.name, c.color]));
  report.byCategory = report.byCategory.map((c) => ({ ...c, color: colorByName.get(c.category) ?? '#64748b' }));
  ok(res, report);
});

reportRouter.get('/monthly.csv', validate({ query: periodQuery }), async (req, res) => {
  const r = await buildMonthlyReport(req.user, req.valid.query.period ?? currentPeriod());
  const rows = [];
  const add = (...c) => rows.push(c);
  add('SpendIQ monthly report', r.label); add('Generated', r.generatedAt); add();
  add('SUMMARY'); add('Total expenses', r.summary.total); add('Transactions', r.summary.count); add('Average per transaction', r.summary.average);
  add('Income', r.summary.income ?? 'not entered'); add('Net cash flow', r.summary.netCashFlow ?? 'n/a'); add();
  add('CATEGORY', 'Total', 'Transactions', 'Share %'); r.byCategory.forEach((c) => add(c.category, c.total, c.count, c.share)); add();
  add('PAYMENT MODE', 'Total', 'Transactions', 'Share %'); r.byPaymentMode.forEach((c) => add(c.paymentMode, c.total, c.count, c.share)); add();
  add('BUDGET', 'Limit', 'Spent', 'Used %', 'Status'); r.budgets.forEach((b) => add(b.category, b.limit, b.spent, b.percent, b.status)); add();
  add('MONTH OVER MONTH', 'This month', 'Previous', 'Change', 'Change %'); r.comparison.categories.forEach((c) => add(c.category, c.current, c.previous, c.change, c.changePct ?? 'n/a')); add();
  add('LARGEST TRANSACTIONS', 'Date', 'Amount', 'Category', 'Description'); r.largest.forEach((l) => add(l.merchant || l.description, l.date, l.amount, l.category, l.description));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="spendiq-report-${r.period}.csv"`);
  const padded = rows.map((row) => (row.length ? row : ['']));
  res.send(toCsv(padded[0], padded.slice(1)));
});

reportRouter.get('/compare', validate({ query: periodQuery }), async (req, res) => {
  const r = await buildMonthlyReport(req.user, req.valid.query.period ?? currentPeriod());
  ok(res, r.comparison);
});

forecastRouter.get('/', async (req, res) => ok(res, await getForecast(req.user)));

insightRouter.get('/', async (req, res) => ok(res, await getInsights(req.user)));
insightRouter.post('/dismiss', validate({ body: z.object({ key: z.string().min(1).max(200) }) }), async (req, res) => {
  await DismissedAlert.updateOne({ user: req.userId, key: req.valid.body.key }, { $setOnInsert: { user: req.userId, key: req.valid.body.key } }, { upsert: true });
  ok(res, { dismissed: true });
});
insightRouter.delete('/dismissed', async (req, res) => {
  const r = await DismissedAlert.deleteMany({ user: req.userId });
  ok(res, { restored: r.deletedCount });
});

chatRouter.get('/status', (_req, res) => ok(res, { aiEnabled: aiEnabled(), mode: aiEnabled() ? 'ai' : 'rules' }));
chatRouter.get('/history', async (req, res) => {
  const rows = await ChatMessage.find({ user: req.userId }).sort({ createdAt: -1 }).limit(60).lean();
  ok(res, rows.reverse().map((m) => ({ id: String(m._id), role: m.role, content: m.content, meta: m.meta, createdAt: m.createdAt })));
});
chatRouter.delete('/history', async (req, res) => {
  const r = await ChatMessage.deleteMany({ user: req.userId });
  ok(res, { deleted: r.deletedCount });
});
chatRouter.post('/', expensiveLimiter, validate({ body: z.object({ message: z.string().trim().min(1, 'Type a question').max(500, 'Keep questions under 500 characters') }) }), async (req, res) => {
  const { message } = req.valid.body;
  const prior = (await ChatMessage.find({ user: req.userId }).sort({ createdAt: -1 }).limit(6).lean()).reverse().map((m) => ({ role: m.role, content: m.content }));
  const out = await answerQuestion(req.user, message, prior);
  const meta = { facts: out.facts, basis: out.basis, intent: out.intent, range: out.range, usedAI: out.usedAI, aiNote: out.aiNote, suggestions: out.suggestions };
  await ChatMessage.create({ user: req.userId, role: 'user', content: message });
  const saved = await ChatMessage.create({ user: req.userId, role: 'assistant', content: out.answer, meta });
  // keep the stored conversation bounded
  const old = await ChatMessage.find({ user: req.userId }).sort({ createdAt: -1 }).skip(200).select('_id').lean();
  if (old.length) await ChatMessage.deleteMany({ _id: { $in: old.map((o) => o._id) } });
  ok(res, { id: String(saved._id), role: 'assistant', content: out.answer, meta, createdAt: saved.createdAt, data: out.data });
});