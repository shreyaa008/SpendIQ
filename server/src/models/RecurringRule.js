import mongoose from 'mongoose';

const ruleSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    description: { type: String, required: true, trim: true, minlength: 1, maxlength: 200 },
    amount: { type: Number, required: true, min: 0.01, max: 100000000 },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    paymentMode: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentMode', required: true },
    frequency: { type: String, enum: ['weekly', 'monthly', 'yearly'], required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    // true → due occurrences are turned into expenses automatically (idempotently); false → user confirms each one.
    autoPost: { type: Boolean, default: false },
    // First occurrence that has neither been posted nor skipped. Everything before it is "handled".
    nextDueDate: { type: Date, default: null },
  },
  { timestamps: true },
);

export const RecurringRule = mongoose.model('RecurringRule', ruleSchema);