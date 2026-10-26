import mongoose from 'mongoose';

const lineItemSchema = new mongoose.Schema(
  { description: { type: String, maxlength: 200 }, quantity: { type: Number, default: 1 }, amount: { type: Number, default: null } },
  { _id: false },
);

const receiptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    originalName: { type: String, maxlength: 200 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    storageKey: { type: String, required: true }, // path relative to the upload dir; never exposed to clients
    status: { type: String, enum: ['processing', 'extracted', 'failed', 'confirmed'], default: 'processing' },
    provider: { type: String, default: '' },
    rawText: { type: String, maxlength: 20000, default: '' },
    extracted: {
      merchant: { type: String, default: '' },
      date: { type: String, default: '' }, // YYYY-MM-DD or ''
      total: { type: Number, default: null },
      subtotal: { type: Number, default: null },
      tax: { type: Number, default: null },
      currency: { type: String, default: '' },
      paymentMethod: { type: String, default: '' },
      suggestedCategory: { type: String, default: '' },
      lineItems: { type: [lineItemSchema], default: [] },
      confidence: { type: Number, default: 0 }, // 0..1, share of key fields found (merchant/date/total)
    },
    warnings: { type: [String], default: [] },
    errorMessage: { type: String, default: '' },
    expense: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense', default: null },
  },
  { timestamps: true },
);
receiptSchema.index({ user: 1, sha256: 1 }, { unique: true });
receiptSchema.index({ user: 1, createdAt: -1 });

export const Receipt = mongoose.model('Receipt', receiptSchema);