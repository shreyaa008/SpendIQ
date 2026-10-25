import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { setup, teardown, newUser, request, app, meta, addExpense } from './helpers.js';
import { env } from '../src/config/env.js';
import { User } from '../src/models/index.js';

before(setup);
after(teardown);

test('register creates a personal workspace with default categories and payment modes; password is hashed', async () => {
  const { agent, user } = await newUser();
  assert.ok(user.id);
  const m = await meta(agent);
  assert.deepEqual(m.cats.map((c) => c.name).sort(), ['Bills', 'Entertainment', 'Food', 'Health', 'Other', 'Shopping', 'Travel']);
  assert.ok(m.pays.some((p) => p.name === 'UPI') && m.pays.some((p) => p.name === 'Debit Card'));
  const raw = await User.findById(user.id).select('+passwordHash').lean();
  assert.match(raw.passwordHash, /^\$2[aby]\$/);
  assert.notEqual(raw.passwordHash, 'Passw0rd!x');
});

test('registration validation and duplicate email', async () => {
  const bad = await request(app).post('/api/auth/register').send({ name: 'A', email: 'nope', password: 'short' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.email && bad.body.error.details.password && bad.body.error.details.name);
  const { email } = await newUser();
  const dup = await request(app).post('/api/auth/register').send({ name: 'Someone', email: email.toUpperCase(), password: 'Passw0rd!x' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'EMAIL_TAKEN');
});

test('login: wrong password and unknown email give the same message; success sets httpOnly cookie', async () => {
  const { email, password } = await newUser();
  const a = await request(app).post('/api/auth/login').send({ email, password: 'wrongPass1' });
  const b = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'wrongPass1' });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.equal(a.body.error.message, b.body.error.message);
  const ok = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(ok.status, 200);
  const cookie = ok.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.equal(JSON.stringify(ok.body).includes('passwordHash'), false);
});

test('protected routes reject missing, malformed, tampered and expired tokens', async () => {
  const { user } = await newUser();
  assert.equal((await request(app).get('/api/expenses')).status, 401);
  assert.equal((await request(app).get('/api/expenses').set('Authorization', 'Bearer garbage')).status, 401);
  const forged = jwt.sign({ sub: user.id, tv: 0 }, 'a-different-secret-that-is-long-enough-123456');
  assert.equal((await request(app).get('/api/expenses').set('Authorization', `Bearer ${forged}`)).status, 401);
  const none = jwt.sign({ sub: user.id, tv: 0 }, '', { algorithm: 'none' });
  assert.equal((await request(app).get('/api/expenses').set('Authorization', `Bearer ${none}`)).status, 401);
  const expired = jwt.sign({ sub: user.id, tv: 0 }, env.jwtSecret, { expiresIn: -10 });
  assert.equal((await request(app).get('/api/expenses').set('Authorization', `Bearer ${expired}`)).status, 401);
});

test('logout clears the cookie; logout-all and password change revoke older tokens', async () => {
  const u = await newUser();
  const out = await u.agent.post('/api/auth/logout');
  assert.equal(out.status, 200);
  assert.equal((await request(app).get('/api/auth/me')).status, 401);

  const v = await newUser();
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${v.token}`)).status, 200);
  await v.agent.post('/api/auth/logout-all');
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${v.token}`)).status, 401, 'old token must be revoked');

  const w = await newUser();
  const bad = await w.agent.post('/api/auth/me/password').send({ currentPassword: 'wrong', newPassword: 'Another1pass' });
  assert.equal(bad.status, 400);
  const good = await w.agent.post('/api/auth/me/password').send({ currentPassword: w.password, newPassword: 'Another1pass' });
  assert.equal(good.status, 200);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${w.token}`)).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email: w.email, password: 'Another1pass' })).status, 200);
});

test('user-level isolation: another user cannot read, edit, delete or reference my records', async () => {
  const a = await newUser();
  const b = await newUser();
  const ma = await meta(a.agent);
  const mb = await meta(b.agent);
  const exp = await addExpense(a.agent, ma, { amount: 250, date: '2026-10-05', description: 'private' });

  assert.equal((await b.agent.get(`/api/expenses/${exp.id}`)).status, 404);
  assert.equal((await b.agent.put(`/api/expenses/${exp.id}`).send({ amount: 1, category: mb.cat('Food'), paymentMode: mb.pay('UPI'), date: '2026-10-05' })).status, 404);
  assert.equal((await b.agent.delete(`/api/expenses/${exp.id}`)).status, 404);
  assert.equal((await b.agent.get('/api/expenses')).body.data.length, 0);

  // using A's category id when creating B's expense must be refused
  const cross = await b.agent.post('/api/expenses').send({ amount: 5, category: ma.cat('Food'), paymentMode: mb.pay('UPI'), date: '2026-10-05' });
  assert.equal(cross.status, 400);
  const crossPay = await b.agent.post('/api/expenses').send({ amount: 5, category: mb.cat('Food'), paymentMode: ma.pay('UPI'), date: '2026-10-05' });
  assert.equal(crossPay.status, 400);
  // A's category cannot be edited/deleted by B
  assert.equal((await b.agent.delete(`/api/categories/${ma.cat('Food')}`)).status, 404);
  assert.equal((await b.agent.put(`/api/categories/${ma.cat('Food')}`).send({ name: 'Hacked' })).status, 404);
  // A still has everything
  assert.equal((await a.agent.get(`/api/expenses/${exp.id}`)).status, 200);
});

test('NoSQL-injection style input is rejected by validation, not executed', async () => {
  const { agent } = await newUser();
  const r1 = await request(app).post('/api/auth/login').send({ email: { $ne: null }, password: { $ne: null } });
  assert.equal(r1.status, 400);
  const r2 = await agent.get('/api/expenses').query({ category: '{"$ne":null}' });
  assert.equal(r2.status, 400);
  const r3 = await agent.get('/api/expenses/%7B%22%24ne%22%3Anull%7D');
  assert.equal(r3.status, 400);
});

test('malformed JSON and unknown routes return the standard error shape, with no stack traces', async () => {
  const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email": ');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.success, false);
  assert.ok(!JSON.stringify(bad.body).includes('node_modules'));
  const nf = await request(app).get('/api/nope');
  assert.equal(nf.status, 401); // unknown paths still require auth first
});

test('delete account removes the user and all their data', async () => {
  const u = await newUser();
  const m = await meta(u.agent);
  await addExpense(u.agent, m, { date: '2026-10-05' });
  const wrong = await u.agent.delete('/api/auth/me').send({ password: 'nope' });
  assert.equal(wrong.status, 400);
  const del = await u.agent.delete('/api/auth/me').send({ password: u.password });
  assert.equal(del.status, 200);
  assert.equal(await User.countDocuments({ email: u.email }), 0);
  const { Expense } = await import('../src/models/index.js');
  assert.equal(await Expense.countDocuments({ user: u.user.id }), 0);
});