import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, teardown, newUser, meta, addExpense, request, app } from './helpers.js';
import { env } from '../src/config/env.js';
import { Expense, Receipt } from '../src/models/index.js';
import { parseReceiptText } from '../src/services/receiptParser.js';
import { startMockAi, textReply } from './mockAi.js';
import { tesseractAvailable } from '../src/services/ocr.js';

const fx = (n) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', n));
before(setup);
after(teardown);

const hasOcr = await tesseractAvailable();
const ocrTest = hasOcr ? test : test.skip;

test('receipt parser: merchant, date, totals, tax, payment method, items, category; flags what it could not read', () => {
  const text = `GREEN LEAF CAFE\n12 MG Road\nGSTIN: 29ABCDE1234F1Z5\nDate: 14/10/2026\nMasala Dosa 2 180.00\nFilter Coffee 2 90.00\nSub Total 270.00\nCGST 2.5% 6.75\nSGST 2.5% 6.75\nGrand Total 283.50\nPaid by UPI`;
  const r = parseReceiptText(text, { categories: ['Food', 'Travel', 'Other'] });
  assert.equal(r.merchant, 'GREEN LEAF CAFE');
  assert.equal(r.date, '2026-10-14');
  assert.equal(r.total, 283.5);
  assert.equal(r.subtotal, 270);
  assert.equal(r.tax, 13.5);
  assert.equal(r.paymentMethod, 'UPI');
  assert.equal(r.suggestedCategory, 'Food');
  assert.equal(r.lineItems.length, 2);
  assert.equal(r.confidence, 1);
  const vague = parseReceiptText('smudged text\nxx', { categories: ['Food'] });
  assert.equal(vague.total, null);
  assert.equal(vague.date, '');
  assert.equal(vague.paymentMethod, '', 'payment method only when stated');
  assert.ok(vague.warnings.length >= 2);
  const ambiguous = parseReceiptText('Shop\nDate 03/04/2026\nTotal 100.00', { categories: [] });
  assert.ok(ambiguous.warnings.some((w) => /two ways/.test(w)));
  const future = parseReceiptText('Shop\nDate 03/04/2099\nTotal 100.00', { categories: [] });
  assert.equal(future.date, '', 'future dates are not accepted');
});

ocrTest('upload → real OCR → editable review → confirm saves an expense linked to the receipt', async () => {
  const u = await newUser();
  const m = await meta(u.agent);
  const up = await u.agent.post('/api/receipts').attach('receipt', fx('receipt.png'), 'bill.png');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const r = up.body.data;
  assert.equal(r.status, 'extracted');
  assert.equal(r.provider, 'tesseract');
  assert.match(r.extracted.merchant, /GREEN LEAF/i);
  assert.equal(r.extracted.date, '2026-10-14');
  assert.equal(r.extracted.total, 441);
  assert.equal(r.extracted.paymentMethod, 'UPI');
  assert.equal(r.extracted.suggestedCategory, 'Food');
  assert.ok(r.extracted.lineItems.length >= 2);
  assert.equal(await Expense.countDocuments({ user: u.user.id }), 0, 'nothing is saved before the user confirms');

  // the user corrects a field and confirms
  const conf = await u.agent.post(`/api/receipts/${r.id}/confirm`).send({ amount: 440, merchant: 'Green Leaf Cafe', date: '2026-10-14', category: m.cat('Food'), paymentMode: m.pay('UPI'), description: 'Team dinner' });
  assert.equal(conf.status, 201, JSON.stringify(conf.body));
  assert.equal(conf.body.data.expense.source, 'receipt');
  assert.equal(conf.body.data.expense.receiptId, r.id);
  assert.equal(conf.body.data.expense.amount, 440);
  assert.equal((await u.agent.get(`/api/receipts/${r.id}`)).body.data.status, 'confirmed');
  assert.equal((await u.agent.post(`/api/receipts/${r.id}/confirm`).send({ amount: 440, merchant: 'x', date: '2026-10-14', category: m.cat('Food'), paymentMode: m.pay('UPI') })).status, 409, 'cannot save twice');
  // flows into the rest of the app
  assert.equal((await u.agent.get('/api/expenses').query({ receipt: 'yes' })).body.meta.count, 1);
  const rep = (await u.agent.get('/api/reports/monthly').query({ period: '2026-10' })).body.data;
  assert.equal(rep.summary.total, 440);
  // learning: the next receipt from the same merchant suggests the same category
});

ocrTest('duplicate file, duplicate expense, bad files, other users, delete', async () => {
  const u = await newUser();
  const m = await meta(u.agent);
  const first = await u.agent.post('/api/receipts').attach('receipt', fx('receipt.png'), 'a.png');
  assert.equal(first.status, 201);
  const again = await u.agent.post('/api/receipts').attach('receipt', fx('receipt.png'), 'renamed.png');
  assert.equal(again.status, 409, 'same bytes → flagged as already uploaded');
  assert.equal(again.body.error.details.receiptId, first.body.data.id);

  await addExpense(u.agent, m, { amount: 441, date: '2026-10-14', merchant: 'Green Leaf Cafe', description: 'dinner' });
  const second = await u.agent.get(`/api/receipts/${first.body.data.id}`);
  assert.ok(second.body.data.possibleDuplicateExpense, 'likely duplicate of an existing expense is flagged');
  const body = { amount: 441, merchant: 'Green Leaf Cafe', date: '2026-10-14', category: m.cat('Food'), paymentMode: m.pay('UPI') };
  const blocked = await u.agent.post(`/api/receipts/${first.body.data.id}/confirm`).send(body);
  assert.equal(blocked.status, 409);
  assert.ok(blocked.body.error.details.possibleDuplicate);
  const forced = await u.agent.post(`/api/receipts/${first.body.data.id}/confirm`).send({ ...body, acknowledgeDuplicate: true });
  assert.equal(forced.status, 201);

  // fake image: wrong bytes behind an image content-type
  const fake = await u.agent.post('/api/receipts').attach('receipt', Buffer.from('<?php echo 1; ?> not an image at all'), { filename: 'x.png', contentType: 'image/png' });
  assert.equal(fake.status, 400);
  const exe = await u.agent.post('/api/receipts').attach('receipt', Buffer.from('MZ....'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
  assert.equal(exe.status, 400);
  const huge = await u.agent.post('/api/receipts').attach('receipt', Buffer.concat([fx('receipt.png'), Buffer.alloc(9 * 1024 * 1024)]), 'big.png');
  assert.equal(huge.status, 413);
  assert.equal((await u.agent.post('/api/receipts')).status, 400);
  assert.equal((await request(app).post('/api/receipts').attach('receipt', fx('receipt.png'), 'a.png')).status, 401);

  // privacy: other users cannot view, download, confirm, retry or delete
  const other = await newUser();
  const id = first.body.data.id;
  assert.equal((await other.agent.get(`/api/receipts/${id}`)).status, 404);
  assert.equal((await other.agent.get(`/api/receipts/${id}/file`)).status, 404);
  assert.equal((await other.agent.post(`/api/receipts/${id}/reprocess`)).status, 404);
  assert.equal((await other.agent.delete(`/api/receipts/${id}`)).status, 404);
  const file = await u.agent.get(`/api/receipts/${id}/file`);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'image/png');
  assert.equal(file.headers['x-content-type-options'], 'nosniff');
  // files are stored outside any public path under a random name
  const stored = await Receipt.findById(id).lean();
  assert.match(path.basename(stored.storageKey), /^[0-9a-f]{32}\.png$/, 'random server-chosen name, never the uploaded filename');
  assert.ok(stored.storageKey.startsWith(`${u.user.id}${path.sep}`), 'stored under the owner\'s own folder');
  assert.ok(fs.existsSync(path.join(path.resolve(env.uploadDir), stored.storageKey)));
  assert.equal((await u.agent.delete(`/api/receipts/${id}`)).status, 200);
  assert.ok(!fs.existsSync(path.join(path.resolve(env.uploadDir), stored.storageKey)), 'file removed from disk');
  assert.equal((await Expense.findOne({ user: u.user.id, source: 'receipt' })).receipt, null, 'expense survives, link cleared');
});

ocrTest('unreadable receipt fails clearly, can be retried; scanned PDF is read too', async () => {
  const u = await newUser();
  const blank = await u.agent.post('/api/receipts').attach('receipt', fx('blank.png'), 'blank.png');
  assert.equal(blank.status, 201);
  assert.equal(blank.body.data.status, 'failed');
  assert.match(blank.body.data.errorMessage, /blurry|clear|read/i);
  const retry = await u.agent.post(`/api/receipts/${blank.body.data.id}/reprocess`);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.status, 'failed');
  const mm = await meta(u.agent);
  const confirmFailed = await u.agent.post(`/api/receipts/${blank.body.data.id}/confirm`).send({ amount: 5, merchant: 'Manual', date: '2026-10-01', category: mm.cat('Food'), paymentMode: mm.pay('Cash') });
  assert.equal(confirmFailed.status, 201, 'user can still complete a failed scan by hand');

  const pdf = await u.agent.post('/api/receipts').attach('receipt', fx('receipt.pdf'), 'bill.pdf');
  assert.equal(pdf.status, 201, JSON.stringify(pdf.body));
  assert.equal(pdf.body.data.status, 'extracted');
  assert.equal(pdf.body.data.mimeType, 'application/pdf');
  assert.equal(pdf.body.data.extracted.total, 441);
});

test('AI receipt provider (mock API): structured fields are used, invalid dates dropped, API errors reported', async () => {
  const mock = await startMockAi();
  const prev = { key: env.anthropicApiKey, url: env.anthropicBaseUrl, p: env.receiptOcrProvider };
  env.anthropicApiKey = 'test-key'; env.anthropicBaseUrl = mock.url; env.receiptOcrProvider = 'anthropic';
  try {
    const u = await newUser();
    mock.handler = () => textReply('```json\n' + JSON.stringify({ merchant: 'Apollo Pharmacy', date: '2026-10-09', total: 312.4, subtotal: 300, tax: 12.4, currency: 'inr', payment_method: null, line_items: [{ description: 'Paracetamol', quantity: 2, amount: 60 }], raw_text: 'Apollo Pharmacy total 312.40' }) + '\n```');
    const r = await u.agent.post('/api/receipts').attach('receipt', fx('receipt.png'), 'a.png');
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.provider, 'anthropic');
    assert.equal(r.body.data.extracted.merchant, 'Apollo Pharmacy');
    assert.equal(r.body.data.extracted.total, 312.4);
    assert.equal(r.body.data.extracted.currency, 'INR');
    assert.equal(r.body.data.extracted.suggestedCategory, 'Health');
    assert.equal(r.body.data.extracted.paymentMethod, '', 'null stays empty; never guessed');
    const body = mock.requests.at(-1).body;
    assert.equal(body.messages[0].content[0].type, 'image');
    assert.ok(mock.requests.at(-1).headers['x-api-key']);

    mock.handler = () => textReply(JSON.stringify({ merchant: 'X', date: '2026-02-31', total: 5 }));
    const bad = await u.agent.post(`/api/receipts/${r.body.data.id}/reprocess`);
    assert.equal(bad.body.data.extracted.date, '', 'impossible date is dropped');
    assert.ok(bad.body.data.warnings.some((w) => /date/i.test(w)));

    mock.handler = () => ({ status: 500, body: {} });
    const down = await u.agent.post(`/api/receipts/${r.body.data.id}/reprocess`);
    assert.equal(down.body.data.status, 'failed');
    assert.match(down.body.data.errorMessage, /AI receipt reader/);

    env.anthropicApiKey = '';
    const nokey = await u.agent.post(`/api/receipts/${r.body.data.id}/reprocess`);
    assert.match(nokey.body.data.errorMessage, /ANTHROPIC_API_KEY/);
  } finally {
    env.anthropicApiKey = prev.key; env.anthropicBaseUrl = prev.url; env.receiptOcrProvider = prev.p;
    await mock.close();
  }
});
