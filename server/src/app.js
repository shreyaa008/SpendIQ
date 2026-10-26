// Topic 36/38/39: Express application — middleware pipeline, modular routers, consistent errors.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { env } from './config/env.js';
import { dbState } from './config/db.js';
import { requireAuth } from './middleware/auth.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { bus } from './utils/events.js';
import authRouter from './routes/auth.js';
import { categoryRouter, paymentRouter } from './routes/meta.js';
import expenseRouter from './routes/expenses.js';
import { budgetRouter, incomeRouter } from './routes/budgets.js';
import goalRouter from './routes/goals.js';
import recurringRouter from './routes/recurring.js';
import receiptRouter from './routes/receipts.js';
import { importRouter, migrationRouter } from './routes/imports.js';
import { dashboardRouter, reportRouter, forecastRouter, insightRouter, chatRouter } from './routes/analyticsRoutes.js';
import { systemRouter, currencyRouter } from './routes/system.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.isProd ? 1 : false);

  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.clientOrigin.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '2mb' })); // CSV commit (≤5000 rows) and legacy backups fit; files go through multer
  app.use(cookieParser());

  // Request log (method, path, status, ms) — never bodies, cookies or tokens.
  if (!env.isTest) {
    app.use((req, res, next) => {
      const t = process.hrtime.bigint();
      res.on('finish', () => console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Number(process.hrtime.bigint() - t) / 1e6 | 0}ms`));
      next();
    });
  }

  // Any successful write by a signed-in user announces itself on the event bus (cache invalidation listens).
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      res.on('finish', () => { if (res.statusCode < 400 && req.userId) bus.emit('data:changed', { userId: String(req.userId) }); });
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: dbState() === 'connected' ? 'ok' : 'degraded', database: dbState(), time: new Date().toISOString() } }));

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);

  // Everything below requires a valid session; handlers always scope queries by req.userId.
  const api = express.Router();
  api.use(requireAuth);
  api.use('/categories', categoryRouter);
  api.use('/payment-modes', paymentRouter);
  api.use('/expenses', expenseRouter);
  api.use('/budgets', budgetRouter);
  api.use('/income', incomeRouter);
  api.use('/goals', goalRouter);
  api.use('/recurring', recurringRouter);
  api.use('/receipts', receiptRouter);
  api.use('/import', importRouter);
  api.use('/migration', migrationRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/reports', reportRouter);
  api.use('/forecast', forecastRouter);
  api.use('/insights', insightRouter);
  api.use('/chat', chatRouter);
  api.use('/system', systemRouter);
  api.use('/currency', currencyRouter);
  app.use('/api', api);

  app.use('/api', notFoundHandler);

  // Production: serve the built React app from the same origin (cookie auth then needs no CORS).
  const dist = path.resolve(__dirname, '../../client/dist');
  if (env.serveClient && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}