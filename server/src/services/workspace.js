import { Category, PaymentMode, DEFAULT_CATEGORIES, DEFAULT_PAYMENT_MODES } from '../models/index.js';

/** Gives a brand-new account its personal workspace: default categories and payment modes. */
export async function seedWorkspace(userId) {
  await Category.insertMany(DEFAULT_CATEGORIES.map((c) => ({ ...c, user: userId, isDefault: true })), { ordered: false });
  await PaymentMode.insertMany(DEFAULT_PAYMENT_MODES.map((name) => ({ name, user: userId, isDefault: true })), { ordered: false });
}

export async function ensureFallbackCategory(userId) {
  let other = await Category.findOne({ user: userId, isFallback: true });
  if (!other) {
    other = await Category.findOneAndUpdate(
      { user: userId, nameKey: 'other' },
      { $setOnInsert: { user: userId, name: 'Other', icon: 'tag', color: '#64748b', isDefault: true, isFallback: true } },
      { upsert: true, returnDocument: 'after' },
    );
  }
  return other;
}