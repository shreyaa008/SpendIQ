// Topic 40: JWT authentication middleware + protected routes.
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { unauthorized } from '../utils/errors.js';

export const COOKIE_NAME = 'spendiq_token';

export function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), tv: user.tokenVersion }, env.jwtSecret, { expiresIn: env.jwtExpiresIn, algorithm: 'HS256' });
}

export function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 };
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[COOKIE_NAME] ?? null;
}

export async function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  if (!mongoose.isValidObjectId(payload.sub)) throw unauthorized();
  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.tv) throw unauthorized('Your session is no longer valid. Please sign in again.');
  req.user = user;
  req.userId = user._id; // every query in route handlers is scoped with this id (user-level data isolation)
  next();
}