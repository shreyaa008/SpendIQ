import mongoose from 'mongoose';

const dismissedSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true, maxlength: 200 },
  },
  { timestamps: true },
);
dismissedSchema.index({ user: 1, key: 1 }, { unique: true });
export const DismissedAlert = mongoose.model('DismissedAlert', dismissedSchema);

const chatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 8000 },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);
chatSchema.index({ user: 1, createdAt: -1 });
export const ChatMessage = mongoose.model('ChatMessage', chatSchema);

const importLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['csv', 'legacy'], required: true },
    fileName: { type: String, default: '' },
    counts: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);
importLogSchema.index({ user: 1, createdAt: -1 });
export const ImportLog = mongoose.model('ImportLog', importLogSchema);