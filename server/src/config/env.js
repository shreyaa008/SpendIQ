// Topic 37: environment-based configuration. Every secret comes from process.env (never from source code).
import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function str(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function int(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd,
  isTest,
  port: int('PORT', 5000),
  mongoUri: str('MONGODB_URI', isTest ? 'mongodb://127.0.0.1:27017/spendiq_test' : 'mongodb://127.0.0.1:27017/spendiq'),
  jwtSecret: str('JWT_SECRET', isTest ? 'test-secret-not-for-production-use-0123456789' : ''),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '7d'),
  cookieSecure: str('COOKIE_SECURE', isProd ? 'true' : 'false') === 'true',
  clientOrigin: str('CLIENT_ORIGIN', 'http://localhost:5173'),
  serveClient: str('SERVE_CLIENT', isProd ? 'true' : 'false') === 'true',
  uploadDir: str('UPLOAD_DIR', 'uploads'),
  maxReceiptMb: int('MAX_RECEIPT_MB', 8),
  maxCsvMb: int('MAX_CSV_MB', 2),
  csvMaxRows: int('CSV_MAX_ROWS', 5000),
  anthropicApiKey: str('ANTHROPIC_API_KEY', ''),
  anthropicModel: str('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
  anthropicBaseUrl: str('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
  receiptOcrProvider: str('RECEIPT_OCR_PROVIDER', 'auto'), // auto | tesseract | anthropic
  tesseractBin: str('TESSERACT_BIN', 'tesseract'),
  tesseractLang: str('TESSERACT_LANG', 'eng'),
  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  rateLimitMax: int('RATE_LIMIT_MAX', isTest ? 100000 : 600),
  authRateLimitMax: int('AUTH_RATE_LIMIT_MAX', isTest ? 100000 : 20),
  expensiveRateLimitMax: int('EXPENSIVE_RATE_LIMIT_MAX', isTest ? 100000 : 40),
  recurringJobMinutes: int('RECURRING_JOB_MINUTES', 60),
  defaultCurrency: str('DEFAULT_CURRENCY', 'INR'),
};

/** Fails fast with a readable message instead of crashing later with an opaque error. */
export function assertRequiredEnv() {
  const problems = [];
  if (!env.jwtSecret || env.jwtSecret.length < 32) {
    problems.push('JWT_SECRET is missing or shorter than 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  }
  if (env.isProd && !process.env.MONGODB_URI) problems.push('MONGODB_URI must be set in production.');
  if (problems.length) {
    const err = new Error(`Configuration problem(s):\n - ${problems.join('\n - ')}\nSee server/.env.example.`);
    err.code = 'CONFIG';
    throw err;
  }
}

export const aiEnabled = () => Boolean(env.anthropicApiKey);