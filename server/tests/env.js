
import 'dotenv/config';

process.env.NODE_ENV = 'test';

if (!process.env.MONGODB_URI_TEST) {
  throw new Error(
    'MONGODB_URI_TEST is required. Add it to server/.env.'
  );
}

const testDbUrl = new URL(process.env.MONGODB_URI_TEST);

if (
  testDbUrl.pathname !== '/spendiq_test' ||
  !['mongodb:', 'mongodb+srv:'].includes(testDbUrl.protocol)
) {
  throw new Error(
    'Unsafe test database. Use a MongoDB URI ending in /spendiq_test.'
  );
}

process.env.MONGODB_URI = process.env.MONGODB_URI_TEST;
process.env.UPLOAD_DIR =
  process.env.UPLOAD_DIR_TEST || './tmp/spendiq-test-uploads';

delete process.env.ANTHROPIC_API_KEY;

// Keep rate limits high during automated tests only.
process.env.RATE_LIMIT_MAX = '100000';
process.env.AUTH_RATE_LIMIT_MAX = '100000';
process.env.EXPENSIVE_RATE_LIMIT_MAX = '100000';
