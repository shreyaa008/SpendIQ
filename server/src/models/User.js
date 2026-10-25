import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
    passwordHash: { type: String, required: true, select: false },
    currency: { type: String, default: 'INR', uppercase: true, match: /^[A-Z]{3}$/ },
    warningThreshold: { type: Number, default: 80, min: 1, max: 100 },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    browserNotifications: { type: Boolean, default: false },
    // Bumping this invalidates every JWT issued earlier (password change / "sign out everywhere").
    tokenVersion: { type: Number, default: 0 },
    legacyMigratedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.methods.toSafe = function toSafe() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    currency: this.currency,
    warningThreshold: this.warningThreshold,
    theme: this.theme,
    browserNotifications: this.browserNotifications,
    legacyMigratedAt: this.legacyMigratedAt,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);