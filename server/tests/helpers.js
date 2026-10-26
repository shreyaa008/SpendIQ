import './env.js';
import request from 'supertest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import * as models from '../src/models/index.js';
import { createApp } from '../src/app.js';
import { clearAll } from '../src/utils/cache.js';
import { shiftPeriod, currentPeriod } from '../src/utils/dates.js';

export const app = createApp();
let counter = 0;

export async function setup() {
  await connectDb(process.env.MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(models).filter((m) => m?.init).map((m) => m.init()));
  clearAll();
}
export async function teardown() { await mongoose.connection.dropDatabase(); await disconnectDb(); }

/** Registers a user and returns a supertest agent that carries the session cookie. */
export async function newUser(overrides = {}) {
  counter += 1;
  const agent = request.agent(app);
  const body = { name: `Test User ${counter}`, email: `user${counter}-${Date.now()}@example.com`, password: 'Passw0rd!x', ...overrides };
  const res = await agent.post('/api/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.data.user, token: res.body.data.token, email: body.email, password: body.password };
}

export async function meta(agent) {
  const [c, p] = await Promise.all([agent.get('/api/categories'), agent.get('/api/payment-modes')]);
  const cat = (n) => c.body.data.find((x) => x.name === n).id;
  const pay = (n) => p.body.data.find((x) => x.name === n).id;
  return { cat, pay, cats: c.body.data, pays: p.body.data };
}

export async function addExpense(agent, m, { amount = 100, category = 'Food', pay = 'UPI', date, description = 'x', merchant = '' } = {}) {
  const res = await agent.post('/api/expenses').send({ amount, category: m.cat(category), paymentMode: m.pay(pay), date, description, merchant });
  if (res.status !== 201) throw new Error(`addExpense failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export const day = (offsetMonths, d) => `${shiftPeriod(currentPeriod(), offsetMonths)}-${String(d).padStart(2, '0')}`;
export { request };