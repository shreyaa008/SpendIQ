import { Router } from 'express';
import { z } from 'zod';
import { Category, PaymentMode, Expense, ImportLog, Budget, Income, User } from '../models/index.js';
import { csvUpload, decodeCsvBuffer } from '../middleware/upload.js';
import { expensiveLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { ok } from './helpers.js';
import { badRequest } from '../utils/errors.js';
import { parseCsvText, suggestMapping, normalizeRows, summarizePreview, FIELDS, toCsv } from '../services/csv.js';
import { ensureFallbackCategory } from '../services/workspace.js';
import { parseDay, isValidDay, PERIOD_RE, round2, currentPeriod } from '../utils/dates.js';
import { makeFingerprint } from '../models/Expense.js';

export const importRouter = Router();
export const migrationRouter = Router();

async function context(userId) {
  const [cats, pays, fallback] = await Promise.all([Category.find({ user: userId }).lean(), PaymentMode.find({ user: userId }).lean(), ensureFallbackCategory(userId)]);
  const fps = new Set((await Expense.find({ user: userId }).select('fingerprint').lean()).map((e) => e.fingerprint));
  const cash = pays.find((p) => p.nameKey === 'cash') ?? pays[0];
  return { categories: new Map(cats.map((c) => [c.nameKey, c.name])), payments: new Map(pays.map((p) => [p.nameKey, p.name])), fingerprints: fps, defaultPayment: cash?.name ?? 'Cash', fallbackCategory: fallback.name };
}

importRouter.get('/csv/template', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="spendiq-import-template.csv"');
  res.send(toCsv(['Date', 'Description', 'Merchant', 'Category', 'Payment Mode', 'Amount'], [['2026-10-05', 'Lunch with team', 'Green Leaf Cafe', 'Food', 'UPI', '450.00'], ['05/10/2026', 'Metro card recharge', '', 'Travel', 'Cash', '500']]));
});

const previewFields = z.object({ mapping: z.string().max(2000).optional(), dateFormat: z.enum(['auto', 'dmy', 'mdy']).default('auto') });

importRouter.post('/csv/preview', expensiveLimiter, (req, res, next) => csvUpload(req, res, (e) => (e ? next(e) : next())), validate({ body: previewFields }), async (req, res) => {
  if (!req.file) throw badRequest('Choose a CSV file to upload.', { details: { file: 'Required' } });
  const text = decodeCsvBuffer(req.file.buffer);
  const { headers, rows } = parseCsvText(text);
  let mapping = suggestMapping(headers);
  if (req.valid.body.mapping) {
    let m;
    try { m = JSON.parse(req.valid.body.mapping); } catch { throw badRequest('The column mapping is not valid JSON.'); }
    mapping = {};
    for (const f of FIELDS) if (Number.isInteger(m[f]) && m[f] >= 0 && m[f] < headers.length) mapping[f] = m[f];
  }
  const missing = ['date', 'amount'].filter((f) => mapping[f] == null);
  const ctx = await context(req.userId);
  const results = missing.length ? [] : normalizeRows(rows, mapping, ctx, { dateFormat: req.valid.body.dateFormat });
  ok(res, { fileName: req.file.originalname, headers, mapping, missingRequired: missing, requiredFields: ['date', 'amount'], summary: summarizePreview(results), rows: results.slice(0, 500).map((r) => ({ line: r.line, status: r.status, errors: r.errors, warnings: r.warnings, data: r.data })), truncatedPreview: results.length > 500, allRows: results.map((r) => ({ line: r.line, status: r.status, data: r.data })) });
});

const commitBody = z.object({
  fileName: z.string().max(200).default(''),
  includeDuplicates: z.boolean().default(false),
  rows: z.array(z.object({ date: z.string(), amount: z.union([z.number(), z.string()]), description: z.string().max(200).default(''), merchant: z.string().max(120).default(''), category: z.string().max(40).default(''), paymentMode: z.string().max(40).default('') })).min(1, 'Nothing to import').max(5000),
});

// The client sends back the rows it previewed; every row is validated AGAIN here (the client is never trusted).
importRouter.post('/csv/commit', expensiveLimiter, validate({ body: commitBody }), async (req, res) => {
  const { rows, includeDuplicates, fileName } = req.valid.body;
  const ctx = await context(req.userId);
  const asArrays = rows.map((r) => [r.date, String(r.amount), r.description, r.merchant, r.category, r.paymentMode]);
  const results = normalizeRows(asArrays, { date: 0, amount: 1, description: 2, merchant: 3, category: 4, paymentMode: 5 }, ctx, { dateFormat: 'dmy' });
  const toImport = results.filter((r) => r.status === 'valid' || (includeDuplicates && r.status === 'duplicate'));
  const catIds = new Map((await Category.find({ user: req.userId }).lean()).map((c) => [c.nameKey, c._id]));
  const payIds = new Map((await PaymentMode.find({ user: req.userId }).lean()).map((p) => [p.nameKey, p._id]));
  for (const r of toImport) {
    if (!catIds.has(r.data.category.toLowerCase())) { const c = await Category.create({ user: req.userId, name: r.data.category }); catIds.set(c.nameKey, c._id); }
    if (!payIds.has(r.data.paymentMode.toLowerCase())) { const p = await PaymentMode.create({ user: req.userId, name: r.data.paymentMode }); payIds.set(p.nameKey, p._id); }
  }
  const docs = toImport.map((r) => ({ user: req.userId, amount: r.data.amount, description: r.data.description, merchant: r.data.merchant, date: parseDay(r.data.date), category: catIds.get(r.data.category.toLowerCase()), paymentMode: payIds.get(r.data.paymentMode.toLowerCase()), currency: req.user.currency, source: 'csv', fingerprint: r.fingerprint }));
  let inserted = 0;
  try {
    const out = await Expense.insertMany(docs, { ordered: false });
    inserted = out.length;
  } catch (e) {
    inserted = e.insertedDocs?.length ?? e.result?.insertedCount ?? 0; // partial failure: what was inserted stays, the rest is reported
    if (!e.insertedDocs && !e.writeErrors) throw e;
  }
  const counts = { received: rows.length, imported: inserted, skippedInvalid: results.filter((r) => r.status === 'invalid').length, skippedDuplicate: includeDuplicates ? 0 : results.filter((r) => r.status === 'duplicate').length, failed: docs.length - inserted };
  await ImportLog.create({ user: req.userId, kind: 'csv', fileName, counts });
  ok(res, counts, 201);
});

// ---------- legacy localStorage migration ----------
const legacySchema = z.object({
  keys: z.record(z.string(), z.string().max(5_000_000)).refine((k) => Object.keys(k).length <= 50, 'Too many keys'),
});

function safeJson(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

/** Reads the old app's smartExpenseManager_* keys. Unknown / malformed entries are reported, never silently dropped. */
export function parseLegacy(keys) {
  const problems = [];
  const expensesRaw = safeJson(keys.smartExpenseManager_expenses ?? '[]', null);
  if (!Array.isArray(expensesRaw)) problems.push('Saved expenses could not be read.');
  const expenses = [];
  (Array.isArray(expensesRaw) ? expensesRaw : []).forEach((e, i) => {
    const amount = Number(e?.amount);
    const date = String(e?.date ?? '').slice(0, 10);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return problems.push(`Expense #${i + 1}: invalid amount.`);
    if (!isValidDay(date)) return problems.push(`Expense #${i + 1}: invalid date “${e?.date}”.`);
    expenses.push({ legacyId: Number.isFinite(Number(e.id)) ? Number(e.id) : Number(`${Date.parse(date)}${i}`.slice(0, 15)), amount: round2(amount), date, description: String(e.description ?? '').slice(0, 200), category: String(e.category || 'Other').slice(0, 40), paymentMode: String(e.paymentMode || e.payment || 'Cash').slice(0, 40) });
  });
  const income = [];
  let incRaw = safeJson(keys.smartExpenseManager_income ?? '{}', {});
  if (typeof incRaw === 'number' || typeof incRaw === 'string') incRaw = { [currentPeriod()]: Number(incRaw) }; // oldest app format: one plain number
  for (const [p, v] of Object.entries(incRaw && typeof incRaw === 'object' ? incRaw : {})) {
    const amt = Number(typeof v === 'object' ? v?.amount : v);
    if (PERIOD_RE.test(p) && Number.isFinite(amt) && amt >= 0) income.push({ period: p, amount: amt });
    else problems.push(`Income entry “${p}” was skipped.`);
  }
  const budgets = [];
  let budRaw = safeJson(keys.smartExpenseManager_budgets ?? '{}', {});
  // oldest format: { Food: 6000 } (not keyed by month) → treated as this month's budgets, exactly as the old app did
  if (budRaw && typeof budRaw === 'object' && Object.values(budRaw).some((v) => typeof v === 'number')) budRaw = { [currentPeriod()]: budRaw };
  for (const [p, cats] of Object.entries(budRaw && typeof budRaw === 'object' ? budRaw : {})) {
    if (!PERIOD_RE.test(p) || typeof cats !== 'object') continue;
    for (const [cat, limit] of Object.entries(cats)) {
      const l = Number(limit);
      if (Number.isFinite(l) && l > 0) budgets.push({ period: p, category: cat.slice(0, 40), limit: l });
    }
  }
  const t = Number(keys.smartExpenseManager_warningThreshold ?? keys.smartExpenseManager_threshold);
  return { expenses, income, budgets, threshold: Number.isFinite(t) && t >= 1 && t <= 100 ? t : null, problems };
}

migrationRouter.get('/status', async (req, res) => {
  const [log, n] = await Promise.all([ImportLog.findOne({ user: req.userId, kind: 'legacy' }).sort({ createdAt: -1 }).lean(), Expense.countDocuments({ user: req.userId, source: 'migration' })]);
  ok(res, { migrated: Boolean(log), lastRun: log?.createdAt ?? null, counts: log?.counts ?? null, migratedExpenses: n });
});

// Idempotent: re-running (or importing the same backup twice) updates in place and never duplicates.
migrationRouter.post('/legacy', expensiveLimiter, validate({ body: legacySchema }), async (req, res) => {
  const legacy = parseLegacy(req.valid.body.keys);
  if (!legacy.expenses.length && !legacy.income.length && !legacy.budgets.length) throw badRequest('No SpendIQ data was found in that backup.', { details: { problems: legacy.problems.slice(0, 20) } });
  const uid = req.userId;
  const catIds = new Map((await Category.find({ user: uid }).lean()).map((c) => [c.nameKey, c._id]));
  const payIds = new Map((await PaymentMode.find({ user: uid }).lean()).map((p) => [p.nameKey, p._id]));
  const getCat = async (name) => { const k = name.trim().toLowerCase(); if (!catIds.has(k)) { const c = await Category.create({ user: uid, name: name.trim() }); catIds.set(k, c._id); } return catIds.get(k); };
  const getPay = async (name) => { const k = name.trim().toLowerCase(); if (!payIds.has(k)) { const p = await PaymentMode.create({ user: uid, name: name.trim() }); payIds.set(k, p._id); } return payIds.get(k); };

  const ops = [];
  for (const e of legacy.expenses) {
    const category = await getCat(e.category);
    const paymentMode = await getPay(e.paymentMode);
    const d = parseDay(e.date);
    ops.push({ updateOne: { filter: { user: uid, legacyId: e.legacyId }, update: { $setOnInsert: { user: uid, legacyId: e.legacyId, amount: e.amount, description: e.description, date: d, category, paymentMode, currency: req.user.currency, source: 'migration', fingerprint: makeFingerprint({ date: d, amount: e.amount, description: e.description }) } }, upsert: true } });
  }
  let created = 0;
  let existing = 0;
  let failed = 0;
  if (ops.length) {
    try {
      const r = await Expense.bulkWrite(ops, { ordered: false });
      created = r.upsertedCount; existing = ops.length - created;
    } catch (err) {
      created = err.result?.upsertedCount ?? 0; failed = err.writeErrors?.length ?? ops.length - created; existing = ops.length - created - failed;
    }
  }
  let budgetsDone = 0;
  for (const b of legacy.budgets) {
    await Budget.updateOne({ user: uid, category: await getCat(b.category), period: b.period }, { $setOnInsert: { limit: b.limit } }, { upsert: true });
    budgetsDone += 1;
  }
  for (const i of legacy.income) await Income.updateOne({ user: uid, period: i.period }, { $setOnInsert: { amount: i.amount } }, { upsert: true });
  if (legacy.threshold != null) await User.updateOne({ _id: uid }, { $set: { warningThreshold: legacy.threshold } });
  await User.updateOne({ _id: uid }, { $set: { legacyMigratedAt: new Date() } });
  const counts = { expensesFound: legacy.expenses.length, expensesImported: created, expensesAlreadyPresent: existing, expensesFailed: failed, budgets: budgetsDone, income: legacy.income.length, skipped: legacy.problems.length };
  await ImportLog.create({ user: uid, kind: 'legacy', fileName: 'localStorage', counts });
  ok(res, { ...counts, problems: legacy.problems.slice(0, 30), note: 'Your old browser data was not deleted. After checking the import you can clear it from the old app.' }, 201);
});