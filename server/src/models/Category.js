import mongoose from 'mongoose';

export const CATEGORY_ICONS = ['utensils', 'shopping-bag', 'plane', 'receipt', 'film', 'heart-pulse', 'tag', 'home', 'car', 'book-open', 'gift', 'coffee', 'smartphone', 'graduation-cap', 'dumbbell', 'paw-print', 'wallet', 'briefcase'];

const categorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    nameKey: { type: String, required: true }, // lower-cased name; enforces case-insensitive uniqueness
    icon: { type: String, enum: CATEGORY_ICONS, default: 'tag' },
    color: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: '#64748b' },
    isDefault: { type: Boolean, default: false },
    isFallback: { type: Boolean, default: false }, // "Other": cannot be deleted; receives reassigned records
  },
  { timestamps: true },
);
categorySchema.index({ user: 1, nameKey: 1 }, { unique: true });
categorySchema.pre('validate', function setKey() {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});

export const Category = mongoose.model('Category', categorySchema);

export const DEFAULT_CATEGORIES = [
  { name: 'Food', icon: 'utensils', color: '#c2410c' },
  { name: 'Shopping', icon: 'shopping-bag', color: '#7c3aed' },
  { name: 'Travel', icon: 'plane', color: '#0369a1' },
  { name: 'Bills', icon: 'receipt', color: '#b45309' },
  { name: 'Entertainment', icon: 'film', color: '#be185d' },
  { name: 'Health', icon: 'heart-pulse', color: '#15803d' },
  { name: 'Other', icon: 'tag', color: '#64748b', isFallback: true },
];