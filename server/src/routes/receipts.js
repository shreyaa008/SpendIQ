// Topic 41: Multer uploads; Topic 35: Buffers + streams.
import { Router } from 'express';
import { z } from 'zod';
import { pipeline } from 'node:stream/promises';
import { Receipt, Expense, Category } from '../models/index.js';
import { receiptUpload, sniffReceiptType } from '../middleware/upload.js';
import { expensiveLimiter } from '../middleware/rateLimit.js';
import { validate, objectId } from '../middleware/validate.js';
import { ok, serializeExpense, assertOwnedRefs } from './helpers.js';
import { AppError, badRequest, notFound, conflict } from '../utils/errors.js';
import { saveReceiptFile, openReceiptFile, deleteReceiptFile, sha256 } from '../services/storage.js';
import { readReceipt } from '../services/ocr.js';
import { parseReceiptText } from '../services/receiptParser.js';
import { isValidDay, parseDay, formatDay, addDays, round2 } from '../utils/dates.js';

const router = Router();
const idParam = z.object({ id: objectId });

function serialize(r, extra = {}) {
  return {
    id: String(r._id), originalName: r.originalName, mimeType: r.mimeType, size: r.size, status: r.status, provider: r.provider,
    extracted: r.extracted?.toObject ? r.extracted.toObject() : r.extracted, warnings: r.warnings, errorMessage: r.errorMessage,
    expenseId: r.expense ? String(r.expense) : null, createdAt: r.createdAt, rawText: r.rawText, ...extra,
  };
}

async function findPossibleDuplicate(userId, ex) {
  if (ex.total == null || !ex.date) return null;
  const from = parseDay(formatDay(addDays(parseDay(ex.date), -1)));
  const to = addDays(parseDay(ex.date), 2);
  const rows = await Expense.find({ user: userId, amount: ex.total, date: { $gte: from, $lt: to } }).select('merchant description date').lean();
  const m = (ex.merchant || '').toLowerCase();
  const hit = rows.find((e) => !m || `${e.merchant} ${e.description}`.toLowerCase().includes(m.split(' ')[0]) || !(e.merchant || e.description));
  return hit ? { id: String(hit._id), date: formatDay(hit.date), merchant: hit.merchant } : null;
}

/** Runs OCR + parsing on the stored file and updates the receipt. Never creates an expense. */
async function process(receipt, userId) {
  const { stream } = await openReceiptFile(receipt.storageKey);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const buffer = Buffer.concat(chunks);
  const cats = (await Category.find({ user: userId }).select('name').lean()).map((c) => c.name);
  try {
    const out = await readReceipt(buffer, receipt.mimeType);
    let parsed;
    if (out.structured) {
      const base = out.rawText ? parseReceiptText(out.rawText, { categories: cats }) : { warnings: [], suggestedCategory: '', lineItems: [] };
      parsed = { ...base, ...Object.fromEntries(Object.entries(out.structured).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))) };
      parsed.suggestedCategory = base.suggestedCategory;
      if (parsed.date && !isValidDay(parsed.date)) { parsed.date = ''; parsed.warnings = [...(parsed.warnings || []), 'The date could not be read reliably.']; }
      parsed.confidence = round2([parsed.merchant, parsed.date, parsed.total != null].filter(Boolean).length / 3);
    } else parsed = parseReceiptText(out.rawText, { categories: cats });

    // Learn from the user's own history: same merchant → same category as last time.
    if (parsed.merchant) {
      const prior = await Expense.findOne({ user: userId, merchant: new RegExp(`^${parsed.merchant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).sort({ date: -1 }).populate('category', 'name').lean();
      if (prior?.category?.name) parsed.suggestedCategory = prior.category.name;
    }
    const readable = (out.rawText || '').replace(/\s/g, '').length;
    receipt.provider = out.provider;
    receipt.rawText = (out.rawText || '').slice(0, 20000);
    receipt.extracted = { merchant: parsed.merchant || '', date: parsed.date || '', total: parsed.total ?? null, subtotal: parsed.subtotal ?? null, tax: parsed.tax ?? null, currency: parsed.currency || '', paymentMethod: parsed.paymentMethod || '', suggestedCategory: parsed.suggestedCategory || '', lineItems: parsed.lineItems || [], confidence: parsed.confidence ?? 0 };
    receipt.warnings = parsed.warnings || [];
    if (!out.structured && readable < 15) {
      receipt.status = 'failed';
      receipt.errorMessage = 'Almost no text could be read. The image may be blurry, too dark or cropped. Try a sharper, well-lit photo of the whole receipt.';
    } else {
      receipt.status = 'extracted';
      receipt.errorMessage = '';
      if (parsed.confidence < 0.5) receipt.warnings.push('Only some details could be read. Please complete the missing fields.');
    }
  } catch (err) {
    receipt.status = 'failed';
    receipt.errorMessage = err instanceof AppError ? err.message : 'The receipt could not be processed. Please retry.';
  }
  await receipt.save();
  return receipt;
}

router.post('/', expensiveLimiter, (req, res, next) => receiptUpload(req, res, (err) => (err ? next(err) : next())), async (req, res) => {
  if (!req.file) throw badRequest('Choose a receipt image or PDF to upload.', { details: { receipt: 'Required' } });
  const type = sniffReceiptType(req.file.buffer);
  if (!type) throw badRequest('That file is not a valid JPG, PNG, WebP or PDF (its contents do not match).');
  const hash = sha256(req.file.buffer);
  const existing = await Receipt.findOne({ user: req.userId, sha256: hash });
  if (existing) throw conflict('You have already uploaded this exact file.', { details: { receiptId: String(existing._id), status: existing.status } });
  const storageKey = await saveReceiptFile(req.userId, req.file.buffer, type.ext);
  let receipt;
  try {
    receipt = await Receipt.create({ user: req.userId, originalName: String(req.file.originalname || 'receipt').replace(/[^\w. \-()]/g, '_').slice(0, 120), mimeType: type.mime, size: req.file.size, sha256: hash, storageKey, status: 'processing' });
  } catch (e) {
    await deleteReceiptFile(storageKey);
    throw e;
  }
  await process(receipt, req.userId);
  const dup = receipt.status === 'extracted' ? await findPossibleDuplicate(req.userId, receipt.extracted) : null;
  ok(res, serialize(receipt, { possibleDuplicateExpense: dup }), 201);
});

router.get('/', async (req, res) => {
  const rows = await Receipt.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50).select('-rawText');
  ok(res, rows.map((r) => serialize(r, { rawText: undefined })));
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const r = await Receipt.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!r) throw notFound('Receipt not found');
  ok(res, serialize(r, { possibleDuplicateExpense: r.status === 'extracted' ? await findPossibleDuplicate(req.userId, r.extracted) : null }));
});

// Receipts are private: streamed only to their owner (never served from a public folder).
router.get('/:id/file', validate({ params: idParam }), async (req, res) => {
  const r = await Receipt.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!r) throw notFound('Receipt not found');
  const { stream, size } = await openReceiptFile(r.storageKey);
  res.setHeader('Content-Type', r.mimeType);
  res.setHeader('Content-Length', size);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  await pipeline(stream, res);
});

router.post('/:id/reprocess', expensiveLimiter, validate({ params: idParam }), async (req, res) => {
  const r = await Receipt.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!r) throw notFound('Receipt not found');
  if (r.status === 'confirmed') throw conflict('This receipt is already saved as an expense.');
  r.status = 'processing';
  await process(r, req.userId);
  ok(res, serialize(r));
});

const confirmBody = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0').max(100000000),
  merchant: z.string().trim().min(1, 'Enter the merchant').max(120),
  description: z.string().trim().max(200).default(''),
  date: z.string().refine(isValidDay, 'Use YYYY-MM-DD'),
  category: objectId,
  paymentMode: objectId,
  acknowledgeDuplicate: z.boolean().default(false),
});

// The ONLY way a receipt becomes an expense: the user reviews/edits the fields and confirms.
router.post('/:id/confirm', validate({ params: idParam, body: confirmBody }), async (req, res) => {
  const b = req.valid.body;
  const r = await Receipt.findOne({ _id: req.valid.params.id, user: req.userId });
  if (!r) throw notFound('Receipt not found');
  if (r.status === 'confirmed') throw conflict('This receipt is already saved as an expense.');
  await assertOwnedRefs(req.userId, b);
  const dup = await findPossibleDuplicate(req.userId, { total: b.amount, date: b.date, merchant: b.merchant });
  if (dup && !b.acknowledgeDuplicate) throw conflict('An expense with the same amount around the same date already exists. Confirm again to save it anyway.', { details: { possibleDuplicate: dup } });
  const e = await Expense.create({ user: req.userId, amount: b.amount, merchant: b.merchant, description: b.description, date: parseDay(b.date), category: b.category, paymentMode: b.paymentMode, currency: req.user.currency, source: 'receipt', receipt: r._id });
  r.status = 'confirmed';
  r.expense = e._id;
  await r.save();
  await e.populate([{ path: 'category', select: 'name color icon' }, { path: 'paymentMode', select: 'name' }]);
  ok(res, { receipt: serialize(r), expense: serializeExpense(e) }, 201);
});

router.delete('/:id', validate({ params: idParam }), async (req, res) => {
  const r = await Receipt.findOneAndDelete({ _id: req.valid.params.id, user: req.userId });
  if (!r) throw notFound('Receipt not found');
  await Expense.updateMany({ user: req.userId, receipt: r._id }, { $set: { receipt: null } });
  await deleteReceiptFile(r.storageKey);
  ok(res, { deleted: true });
});

export default router;