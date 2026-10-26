import mongoose from 'mongoose';

const budgetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    // "default" applies to every month without a month-specific override; otherwise "YYYY-MM".
    period: { type: String, required: true, match: /^(default|\d{4}-(0[1-9]|1[0-2]))$/, default: 'default' },
    limit: { type: Number, required: true, min: 0.01, max: 100000000 },
    threshold: { type: Number, min: 1, max: 100, default: null }, // null → user's warning threshold
  },
  { timestamps: true },
);
budgetSchema.index({ user: 1, category: 1, period: 1 }, { unique: true });

export const Budget = mongoose.model('Budget', budgetSchema);