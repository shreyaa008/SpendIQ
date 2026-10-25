// Topic 39: centralised error handling → one consistent JSON shape for every failure.
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { formatZod } from './validate.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.path}`, { code: 'NOT_FOUND' }));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Something went wrong on our side. Please try again.';
  let code = 'INTERNAL';
  let details;

  if (err instanceof AppError) {
    ({ status, message, code, details } = err);
  } else if (err instanceof ZodError) {
    status = 400; code = 'VALIDATION'; message = 'Please fix the highlighted fields.'; details = formatZod(err);
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400; code = 'VALIDATION'; message = 'Some values are not valid.';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400; code = 'BAD_REQUEST'; message = `Invalid value for ${err.path}.`;
  } else if (err?.code === 11000) {
    status = 409; code = 'CONFLICT'; message = 'That record already exists.';
  } else if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = 'UPLOAD';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large.' : `Upload problem: ${err.message}`;
  } else if (err?.type === 'entity.parse.failed') {
    status = 400; code = 'BAD_JSON'; message = 'The request body is not valid JSON.';
  } else if (err?.type === 'entity.too.large') {
    status = 413; code = 'TOO_LARGE'; message = 'The request body is too large.';
  }

  if (status >= 500 && (!env.isTest || process.env.DEBUG_ERRORS)) {
    // Log the cause server-side; never return stack traces or internals to the client.
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err?.stack || err);
  }
  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });
}