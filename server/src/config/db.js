import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);

export async function connectDb(uri = env.mongoUri) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  } catch (err) {
    const e = new Error(
      `Could not connect to MongoDB at ${redact(uri)}. Is mongod running? (${err.message})\n` +
        'Start MongoDB locally or set MONGODB_URI to a MongoDB Atlas connection string.',
    );
    e.code = 'DB_CONNECT';
    throw e;
  }
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

export const dbState = () => ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown';

function redact(uri) {
  return uri.replace(/\/\/([^@/]+)@/, '//***:***@');
}