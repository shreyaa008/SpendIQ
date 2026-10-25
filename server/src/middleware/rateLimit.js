import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const make = (limit, message) =>
  rateLimit({
    windowMs: env.rateLimitWindowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } }),
  });

export const apiLimiter = make(env.rateLimitMax, 'Too many requests. Please slow down and try again shortly.');
export const authLimiter = make(env.authRateLimitMax, 'Too many sign-in attempts. Please wait a few minutes and try again.');
export const expensiveLimiter = make(env.expensiveRateLimitMax, 'You have used this feature a lot recently. Please try again in a few minutes.');