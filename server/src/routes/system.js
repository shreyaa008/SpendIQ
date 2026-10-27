// Topic 32/33: runtime globals (process, V8, memory) and event-loop health, exposed to signed-in users in Settings → System.
import { Router } from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';
import { z } from 'zod';
import { ok } from './helpers.js';
import { validate } from '../middleware/validate.js';
import { aiEnabled, env } from '../config/env.js';
import { dbState } from '../config/db.js';
import { tesseractAvailable } from '../services/ocr.js';
import { chooseProvider } from '../services/ocr.js';
import { unavailable } from '../utils/errors.js';

export const systemRouter = Router();
export const currencyRouter = Router();

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

systemRouter.get('/runtime', async (_req, res) => {
  const mem = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  ok(res, {
    node: process.version,
    v8: process.versions.v8,
    platform: `${process.platform}/${process.arch}`,
    uptimeSeconds: Math.round(process.uptime()),
    memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576), heapLimit: Math.round(heap.heap_size_limit / 1048576) },
    eventLoopDelayMs: { mean: Math.round(loop.mean / 1e4) / 100, p99: Math.round(loop.percentile(99) / 1e4) / 100 },
    database: dbState(),
    services: { ai: aiEnabled() ? 'configured' : 'not configured (rule-based answers)', receiptReader: chooseProvider(), localOcrInstalled: await tesseractAvailable(), env: env.nodeEnv },
  });
});

// ---- exchange rates (ported from the original app's currency feature; fetched server-side and cached) ----
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED'];
const rateCache = new Map(); // base -> { at, rates }
const TTL = 10 * 60 * 1000;

export async function getRates(base) {
  const hit = rateCache.get(base);
  if (hit && Date.now() - hit.at < TTL) return { ...hit, stale: false };
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    if (data.result !== 'success' || !data.rates) throw new Error('bad payload');
    const rates = Object.fromEntries(CURRENCIES.map((c) => [c, data.rates[c]]).filter(([, v]) => typeof v === 'number'));
    const entry = { at: Date.now(), rates };
    rateCache.set(base, entry);
    return { ...entry, stale: false };
  } catch {
    if (hit) return { ...hit, stale: true }; // serve the last known rates rather than failing
    throw unavailable('Exchange rates are unavailable right now. Please try again later.');
  }
}

currencyRouter.get('/rates', validate({ query: z.object({ base: z.enum(CURRENCIES).default('INR') }) }), async (req, res) => {
  const r = await getRates(req.valid.query.base);
  ok(res, { base: req.valid.query.base, rates: r.rates, fetchedAt: new Date(r.at).toISOString(), stale: r.stale, currencies: CURRENCIES });
});