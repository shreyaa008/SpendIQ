import { parse } from 'csv-parse/sync';
import { env } from '../config/env.js';
import { badRequest, unprocessable } from '../utils/errors.js';
import { isValidDay, round2, todayStr, addDays, parseDay, formatDay } from '../utils/dates.js';
import { makeFingerprint } from '../models/Expense.js';

export const FIELDS = ['date', 'amount', 'description', 'merchant', 'category', 'paymentMode'];
const ALIASES = {
  date: ['date', 'transaction date', 'txn date', 'day', 'posted date', 'value date'],
  amount: ['amount', 'amt', 'debit', 'value', 'total', 'price', 'withdrawal', 'expense', 'cost'],
  description: ['description', 'desc', 'details', 'narration', 'note', 'notes', 'memo', 'particulars', 'remarks'],
  merchant: ['merchant', 'payee', 'vendor', 'shop', 'store', 'paid to'],
  category: ['category', 'cat', 'type', 'head'],
  paymentMode: ['payment mode', 'paymentmode', 'payment', 'payment method', 'mode', 'method', 'paid via', 'paid by'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function parseCsvText(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  let rows;
  try {
    rows = parse(text, { delimiter, skip_empty_lines: true, relax_column_count: true, relax_quotes: false, trim: true, bom: true });
  } catch (e) {
    throw badRequest(`The CSV could not be read (${e.message.split('\n')[0]}). Check for unbalanced quotes.`);
  }
  if (rows.length < 2) throw badRequest('The CSV needs a header row and at least one data row.');
  if (rows.length - 1 > env.csvMaxRows) throw unprocessable(`The CSV has ${rows.length - 1} rows; the limit is ${env.csvMaxRows} per import. Split the file and import it in parts.`);
  const headers = rows[0].map((h) => String(h ?? '').trim());
  if (new Set(headers.map(norm)).size !== headers.length && headers.some((h) => !h)) throw badRequest('The header row has empty or repeated column names.');
  return { headers, rows: rows.slice(1) };
}

export function suggestMapping(headers) {
  const mapping = {};
  const used = new Set();
  for (const field of FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && ALIASES[field].includes(norm(h)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

export function parseAmount(raw) {
  if (raw == null) return { error: 'Amount is missing.' };
  let s = String(raw).trim();
  if (!s) return { error: 'Amount is missing.' };
  if (/^\(.*\)$/.test(s) || /^-/.test(s)) return { error: 'Negative amounts (refunds) are not supported. Import expenses only.' };
  s = s.replace(/(?:₹|rs\.?|inr|usd|eur|gbp|\$|€|£)/gi, '').replace(/\s+/g, '');
  // 1,23,456.78 or 1,234.56 or 1234.56
  if (!/^\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/.test(s)) return { error: `“${raw}” is not a valid amount.` };
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return { error: 'Amount must be greater than zero.' };
  if (n > 100000000) return { error: 'Amount is too large.' };
  return { value: round2(n) };
}

/** Accepts ISO (2026-10-05), D/M/Y (05/10/2026, 05-10-2026, 05.10.2026) and, when unambiguous or requested, M/D/Y. */
export function parseDate(raw, dateFormat = 'auto') {
  const s = String(raw ?? '').trim();
  if (!s) return { error: 'Date is missing.' };
  let y; let m; let d;
  let iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (iso) [, y, m, d] = iso.map(Number);
  else {
    const parts = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
    if (!parts) return { error: `“${raw}” is not a recognised date. Use YYYY-MM-DD or DD/MM/YYYY.` };
    let a = Number(parts[1]); let b = Number(parts[2]); y = Number(parts[3]);
    if (y < 100) y += 2000;
    let mdy = dateFormat === 'mdy';
    if (dateFormat === 'auto') mdy = a <= 12 && b > 12 ? true : false;
    if (mdy) [a, b] = [b, a];
    d = a; m = b;
  }
  const out = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!isValidDay(out)) return { error: `“${raw}” is not a real calendar date.` };
  if (y < 2000) return { error: `“${raw}” is before the year 2000.` };
  if (out > formatDay(addDays(parseDay(todayStr()), 366))) return { error: `“${raw}” is more than a year in the future.` };
  return { value: out };
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/^'(?=[=+\-@])/, '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Validates each row against the user's data. Nothing is written here; the result is shown as a preview first.
 * ctx = { categories: Map(lowerName→name), payments: Map(lowerName→name), fingerprints: Set, defaultPayment, fallbackCategory }
 */
export function normalizeRows(rows, mapping, ctx, { dateFormat = 'auto' } = {}) {
  const seen = new Set();
  const get = (row, field) => (mapping[field] == null || mapping[field] < 0 ? '' : row[mapping[field]] ?? '');
  return rows.map((row, i) => {
    const line = i + 2; // 1-based incl. header
    const errors = [];
    const warnings = [];
    const date = parseDate(get(row, 'date'), dateFormat);
    const amount = parseAmount(get(row, 'amount'));
    if (date.error) errors.push(date.error);
    if (amount.error) errors.push(amount.error);
    const description = clean(get(row, 'description'), 200);
    const merchant = clean(get(row, 'merchant'), 120);
    if (!description && !merchant) warnings.push('No description or merchant.');
    const rawCat = clean(get(row, 'category'), 60);
    let category = ctx.fallbackCategory;
    let newCategory = false;
    if (rawCat) {
      const hit = ctx.categories.get(rawCat.toLowerCase());
      if (hit) category = hit;
      else if (rawCat.length > 40) errors.push('Category name is longer than 40 characters.');
      else { category = rawCat; newCategory = true; warnings.push(`New category “${rawCat}” will be created.`); }
    } else warnings.push(`No category; using ${ctx.fallbackCategory}.`);
    const rawPay = clean(get(row, 'paymentMode'), 60);
    let paymentMode = ctx.defaultPayment;
    let newPayment = false;
    if (rawPay) {
      const hit = ctx.payments.get(rawPay.toLowerCase());
      if (hit) paymentMode = hit;
      else if (rawPay.length > 40) errors.push('Payment mode is longer than 40 characters.');
      else { paymentMode = rawPay; newPayment = true; warnings.push(`New payment mode “${rawPay}” will be created.`); }
    } else warnings.push(`No payment mode; using ${ctx.defaultPayment}.`);

    let status = errors.length ? 'invalid' : 'valid';
    let fingerprint = '';
    if (!errors.length) {
      fingerprint = makeFingerprint({ date: parseDay(date.value), amount: amount.value, description, merchant });
      if (ctx.fingerprints.has(fingerprint)) { status = 'duplicate'; warnings.push('Matches an existing transaction (same date, amount and text).'); }
      else if (seen.has(fingerprint)) { status = 'duplicate'; warnings.push('Appears more than once in this file.'); }
      seen.add(fingerprint);
    }
    return { line, status, errors, warnings, data: errors.length ? null : { date: date.value, amount: amount.value, description, merchant, category, paymentMode, newCategory, newPayment }, fingerprint };
  });
}

export function summarizePreview(results) {
  const c = { total: results.length, valid: 0, invalid: 0, duplicate: 0 };
  for (const r of results) c[r.status] += 1;
  return c;
}

// ---------- export ----------

/** Neutralises spreadsheet formula injection (=, +, -, @, tab, CR) in text, then applies RFC-4180 quoting. */
export function csvCell(val) {
  if (val === null || val === undefined) return '';
  let s = String(val);
  if (typeof val === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header, rows) => `\uFEFF${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

export const EXPENSE_CSV_HEADER = ['Date', 'Description', 'Merchant', 'Category', 'Payment Mode', 'Amount', 'Recurring', 'Receipt', 'Source'];
export const expenseCsvRow = (e) => [e.date, e.description, e.merchant, e.category, e.paymentMode, e.amount, e.recurring ? 'Yes' : 'No', e.hasReceipt ? 'Yes' : 'No', e.source];
