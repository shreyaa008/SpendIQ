// Topic 31/36: the HTTP server. Express is mounted on a plain node:http server so startup, errors and shutdown are explicit.
import http from 'node:http';
import { env, assertRequiredEnv } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { processDueRules } from './services/recurring.js';
import { mkdir } from 'node:fs/promises';
import { uploadRoot } from './services/storage.js';

async function main() {
  assertRequiredEnv();
  await connectDb();
  await mkdir(uploadRoot(), { recursive: true });
  const { User, Expense, Category, PaymentMode, RecurringRule, Receipt, Budget } = await import('./models/index.js');
  await Promise.all([User, Expense, Category, PaymentMode, RecurringRule, Receipt, Budget].map((m) => m.init())); // build indexes (incl. the unique ones that prevent duplicates)

  const server = http.createServer(createApp());
  server.listen(env.port, () => {
    console.log(`SpendIQ API listening on http://localhost:${env.port} (${env.nodeEnv})`);
    if (!env.anthropicApiKey) console.log('AI key not set: the assistant uses rule-based answers and receipts use local OCR. See server/.env.example.');
  });

  // Opt-in auto-posting of due recurring expenses (idempotent, so overlapping runs cannot create duplicates).
  const timer = setInterval(() => processDueRules().catch((e) => console.error('[recurring job]', e.message)), env.recurringJobMinutes * 60 * 1000);
  timer.unref();

  const shutdown = async (signal) => {
    console.log(`${signal} received, shutting down…`);
    clearInterval(timer);
    server.close(async () => { await disconnectDb(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason instanceof Error ? reason.message : reason));

main().catch((err) => {
  console.error(`\nSpendIQ could not start.\n${err.message}\n`);
  process.exit(1);
});