// Imported first by tests/helpers.js so the config module sees the test environment.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/spendiq_test';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR_TEST || '/tmp/spendiq-test-uploads';
delete process.env.ANTHROPIC_API_KEY; // tests must never call a real AI service unless a test sets a mock explicitly