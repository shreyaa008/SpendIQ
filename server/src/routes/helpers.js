import { Category, PaymentMode } from '../models/index.js';
import { formatDay } from '../utils/dates.js';
import { badRequest } from '../utils/errors.js';

export const ok = (res, data, status = 200, meta) => res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });

export function serializeExpense(e) {
  const cat = e.category && e.category._id ? e.category : null;
  const pay = e.paymentMode && e.paymentMode._id ? e.paymentMode : null;
  return {
    id: String(e._id),
    amount: e.amount,
    description: e.description ?? '',
    merchant: e.merchant ?? '',
    category: cat ? { id: String(cat._id), name: cat.name, color: cat.color, icon: cat.icon } : { id: String(e.category) },
    paymentMode: pay ? { id: String(pay._id), name: pay.name } : { id: String(e.paymentMode) },
    date: formatDay(e.date),
    currency: e.currency,
    originalAmount: e.originalAmount ?? null,
    originalCurrency: e.originalCurrency ?? null,
    source: e.source,
    receiptId: e.receipt ? String(e.receipt) : null,
    recurringRuleId: e.recurringRule ? String(e.recurringRule) : null,
    isRecurring: Boolean(e.recurringRule),
    createdAt: e.createdAt,
  };
}

/** Confirms the referenced category / payment mode belong to THIS user (stops id-guessing across accounts). */
export async function assertOwnedRefs(userId, { category, paymentMode }) {
  if (category) {
    if (!(await Category.exists({ _id: category, user: userId }))) throw badRequest('That category does not exist.', { details: { category: 'Unknown category' } });
  }
  if (paymentMode) {
    if (!(await PaymentMode.exists({ _id: paymentMode, user: userId }))) throw badRequest('That payment mode does not exist.', { details: { paymentMode: 'Unknown payment mode' } });
  }
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');