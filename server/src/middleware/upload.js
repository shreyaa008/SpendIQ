// Topic 41: Multer. Files are held in memory as Buffers, verified by their real bytes (magic numbers), then written by us.
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

const RECEIPT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxReceiptMb * 1024 * 1024, files: 1, fields: 5 },
  fileFilter(_req, file, cb) {
    if (!RECEIPT_MIMES.has(file.mimetype)) return cb(badRequest('Unsupported file type. Upload a JPG, PNG, WebP image or a PDF.'));
    cb(null, true);
  },
}).single('receipt');

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxCsvMb * 1024 * 1024, files: 1, fields: 5 },
  fileFilter(_req, file, cb) {
    const okName = /\.(csv|txt)$/i.test(file.originalname || '');
    const okMime = ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/csv'].includes(file.mimetype);
    if (!okName && !okMime) return cb(badRequest('Unsupported file type. Upload a .csv file.'));
    cb(null, true);
  },
}).single('file');

/** Identify a file by its leading bytes, not by the (spoofable) name or Content-Type header. */
export function sniffReceiptType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

/** Returns decoded UTF-8 text (BOM stripped) or throws if the bytes are not plain text. */
export function decodeCsvBuffer(buf) {
  if (buf.includes(0)) throw badRequest('That file is not a text CSV (binary content detected).');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    throw badRequest('The CSV must be saved as UTF-8. In Excel choose "CSV UTF-8" when saving.');
  }
}