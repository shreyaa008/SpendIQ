import mongoose from 'mongoose';
import { formatDay } from '../utils/dates.js';

export const EXPENSE_SOURCES = ['manual', 'csv', 'receipt', 'recurring', 'migration'];

const expenseSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0.01, max: 100000000 },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    merchant: { type: String, trim: true, maxlength: 120, default: '' },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    paymentMode: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMode', required: true },
    date: { type: Date, required: true },
    currency: { type: String, uppercase: true, match: /^[A-Z]{3}$/, default: 'INR' },
    originalAmount: { type: Number, min: 0, default: null },
    originalCurrency: { type: String, uppercase: true, match: /^[A-Z]{3}$/, default: null },
    source: { type: String, enum: EXPENSE_SOURCES, default: 'manual' },
    receipt: { type: mongoose.Schema.Types.ObjectId, ref: 'Receipt', default: null },
    recurringRule: { type: mongoose.Schema.Types.ObjectId, ref: 'RecurringRule', default: null },
    occurrenceDate: { type: Date, default: null },
    legacyId: { type: Number, default: null },
    fingerprint: { type: String, default: '' }, // date|amount|normalised text, used for duplicate detection
  },
  { timestamps: true },
);

expenseSchema.index({ user: 1, date: -1 });
expenseSchema.index({ user: 1, category: 1, date: -1 });
expenseSchema.index({ user: 1, paymentMode: 1, date: -1 });
expenseSchema.index({ user: 1, fingerprint: 1 });
// A recurring occurrence can be posted at most once; this is what makes posting idempotent.
expenseSchema.index(
  { user: 1, recurringRule: 1, occurrenceDate: 1 },
  { unique: true, partialFilterExpression: { recurringRule: { $type: 'objectId' } } },
);
// Migration is safe to re-run: one document per (user, legacy id).
expenseSchema.index({ user: 1, legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: 'number' } } });

export function makeFingerprint({ date, amount, description = '', merchant = '' }) {
  const text = `${merchant} ${description}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${formatDay(date)}|${Number(amount).toFixed(2)}|${text}`;
}

expenseSchema.pre('validate', function setFingerprint() {
  if (this.date && this.amount != null) this.fingerprint = makeFingerprint(this);
});

export const Expense = mongoose.model('Expense', expenseSchema);
