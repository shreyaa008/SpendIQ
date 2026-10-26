import mongoose from 'mongoose';

const incomeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    amount: { type: Number, required: true, min: 0, max: 1000000000 },
  },
  { timestamps: true },
);
incomeSchema.index({ user: 1, period: 1 }, { unique: true });

export const Income = mongoose.model('Income', incomeSchema);