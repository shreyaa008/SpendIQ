import mongoose from 'mongoose';

const goalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    targetAmount: { type: Number, required: true, min: 1, max: 1000000000 },
    targetDate: { type: Date, default: null },
    note: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { timestamps: true },
);

// Money actually set aside. Deliberately a separate collection: ordinary expenses never count as savings.
const contributionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    goal: { type: mongoose.Schema.Types.ObjectId, ref: 'SavingsGoal', required: true },
    type: { type: String, enum: ['deposit', 'withdrawal'], default: 'deposit' },
    amount: { type: Number, required: true, min: 0.01, max: 1000000000 },
    date: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 200, default: '' },
  },
  { timestamps: true },
);
contributionSchema.index({ user: 1, goal: 1, date: -1 });

export const SavingsGoal = mongoose.model('SavingsGoal', goalSchema);
export const Contribution = mongoose.model('Contribution', contributionSchema);