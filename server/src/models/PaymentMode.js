import mongoose from 'mongoose';

const paymentModeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    nameKey: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);
paymentModeSchema.index({ user: 1, nameKey: 1 }, { unique: true });
paymentModeSchema.pre('validate', function setKey() {
  if (this.name) this.nameKey = this.name.trim().toLowerCase();
});

export const PaymentMode = mongoose.model('PaymentMode', paymentModeSchema);
export const DEFAULT_PAYMENT_MODES = ['UPI', 'Cash', 'Debit Card', 'Credit Card', 'Net Banking', 'Bank Transfer'];