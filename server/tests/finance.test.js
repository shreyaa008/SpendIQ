import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, newUser, meta, addExpense, day, request, app } from './helpers.js';
import { currentPeriod, todayStr, shiftPeriod } from '../src/utils/dates.js';
import { Expense } from '../src/models/index.js';

before(setup);
after(teardown);

async function seeded() {
  const u = await newUser();
  const m = await meta(u.agent);
  await addExpense(u.agent, m, { amount: 450, category: 'Food', pay: 'UPI', date: '2026-09-05', description: 'Lunch', merchant: 'Green Leaf' });
  await addExpense(u.agent, m, { amount: 1200, category: 'Shopping', pay: 'Debit Card', date: '2026-09-12', description: 'Shoes', merchant: 'Bata' });
  await addExpense(u.agent, m, { amount: 99.5, category: 'Food', pay: 'Cash', date: '2026-10-02', description: 'Tea & snacks' });
  await addExpense(u.agent, m, { amount: 3000, category: 'Bills', pay: 'Net Banking', date: '2026-10-03', description: 'Electricity' });
  return { ...u, m };
}

test('expense CRUD with validation', async () => {
  const { agent, m } = await seeded();
  const bad = await agent.post('/api/expenses').send({ amount: -5, category: 'x', paymentMode: 'y', date: '2026-13-40' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.amount && bad.body.error.details.date);
  const created = await addExpense(agent, m, { amount: 10.555, date: '2026-10-10', description: 'edge' });
  assert.equal(created.date, '2026-10-10');
  const upd = await agent.put(`/api/expenses/${created.id}`).send({ amount: 20, category: m.cat('Travel'), paymentMode: m.pay('Cash'), date: '2026-10-11', description: 'edited' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.data.category.name, 'Travel');
  assert.equal(upd.body.data.date, '2026-10-11');
  const del = await agent.delete(`/api/expenses/${created.id}`);
  assert.equal(del.status, 200);
  assert.equal((await agent.get(`/api/expenses/${created.id}`)).status, 404);
});

test('search + filters + sorting + pagination, and totals/export agree with filters', async () => {
  const { agent, m } = await seeded();
  const q = (params) => agent.get('/api/expenses').query(params);
  assert.equal((await q({ q: 'leaf' })).body.meta.count, 1, 'merchant search');
  assert.equal((await q({ q: 'tea' })).body.meta.count, 1, 'description search');
  assert.equal((await q({ category: m.cat('Food') })).body.meta.count, 2);
  assert.equal((await q({ category: `${m.cat('Food')},${m.cat('Bills')}` })).body.meta.count, 3, 'multiple categories');
  assert.equal((await q({ minAmount: 1000 })).body.meta.count, 2);
  assert.equal((await q({ minAmount: 100, maxAmount: 1500 })).body.meta.count, 2);
  assert.equal((await q({ period: '2026-09' })).body.meta.count, 2);
  assert.equal((await q({ from: '2026-09-10', to: '2026-10-02' })).body.meta.count, 2, 'inclusive date range');
  assert.equal((await q({ year: 2026 })).body.meta.count, 4);
  assert.equal((await q({ paymentMode: m.pay('Cash') })).body.meta.count, 1);
  assert.equal((await q({ recurring: 'yes' })).body.meta.count, 0);
  assert.equal((await q({ receipt: 'no' })).body.meta.count, 4);
  const sorted = await q({ sort: 'amountDesc' });
  assert.deepEqual(sorted.body.data.map((e) => e.amount), [3000, 1200, 450, 99.5]);
  const page = await q({ sort: 'amountDesc', limit: 2, page: 2 });
  assert.deepEqual(page.body.data.map((e) => e.amount), [450, 99.5]);
  assert.equal(page.body.meta.pages, 2);
  // totals respect the filter, not just the page
  const filtered = await q({ category: m.cat('Food'), limit: 1 });
  assert.equal(filtered.body.meta.totalAmount, 549.5);
  // regex metacharacters are treated literally
  assert.equal((await q({ q: '.*' })).body.meta.count, 0);
  // export honours the same filters
  const csv = await agent.get('/api/expenses/export.csv').query({ category: m.cat('Food') });
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  const lines = csv.text.trim().split(/\r?\n/);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('Date,Description,Merchant,Category,Payment Mode,Amount'));
});

test('CSV export neutralises spreadsheet formulas', async () => {
  const { agent, m } = await seeded();
  await addExpense(agent, m, { amount: 5, date: '2026-10-04', description: '=HYPERLINK("http://evil","x")' });
  const csv = await agent.get('/api/expenses/export.csv');
  assert.ok(csv.text.includes(`"'=HYPERLINK(""http://evil"",""x"")"`));
});

test('budgets: upsert, status, thresholds, month override, copy, isolation', async () => {
  const { agent, m } = await seeded();
  const b = await agent.post('/api/budgets').send({ category: m.cat('Food'), period: 'default', limit: 600, threshold: 80 });
  assert.equal(b.status, 201);
  const again = await agent.post('/api/budgets').send({ category: m.cat('Food'), period: 'default', limit: 700 });
  assert.equal(again.body.data.id, b.body.data.id, 'same category+period updates instead of duplicating');
  let s = await agent.get('/api/budgets').query({ period: '2026-09' });
  assert.equal(s.body.data.length, 1);
  assert.equal(s.body.data[0].spent, 450);
  assert.equal(s.body.data[0].status, 'ok');
  await agent.post('/api/budgets').send({ category: m.cat('Food'), period: '2026-09', limit: 500, threshold: 85 }); // override for Sept
  s = await agent.get('/api/budgets').query({ period: '2026-09' });
  assert.equal(s.body.data[0].limit, 500);
  assert.equal(s.body.data[0].status, 'warning', '450/500 = 90% ≥ 85%');
  await agent.post('/api/budgets').send({ category: m.cat('Bills'), period: '2026-10', limit: 2000 });
  s = await agent.get('/api/budgets').query({ period: '2026-10' });
  const bills = s.body.data.find((x) => x.category === 'Bills');
  assert.equal(bills.status, 'exceeded');
  assert.equal(bills.remaining, -1000);
  assert.equal((await agent.post('/api/budgets').send({ category: m.cat('Food'), limit: 0 })).status, 400);
  const other = await newUser();
  assert.equal((await other.agent.delete(`/api/budgets/${b.body.data.id}`)).status, 404);
  assert.equal((await agent.delete(`/api/budgets/${b.body.data.id}`)).status, 200);
});

test('custom categories & payment modes: create, rename, safe delete with reassignment', async () => {
  const { agent, m } = await seeded();
  const c = await agent.post('/api/categories').send({ name: 'Pets', icon: 'paw-print', color: '#336699' });
  assert.equal(c.status, 201);
  assert.equal((await agent.post('/api/categories').send({ name: 'pets' })).status, 409, 'case-insensitive duplicate');
  assert.equal((await agent.put(`/api/categories/${c.body.data.id}`).send({ name: 'Pet care' })).body.data.name, 'Pet care');
  const e = await addExpense(agent, { ...m, cat: (n) => (n === 'Pets' ? c.body.data.id : m.cat(n)) }, { category: 'Pets', amount: 800, date: '2026-10-06' });
  await agent.post('/api/budgets').send({ category: c.body.data.id, limit: 1000 });
  const blocked = await agent.delete(`/api/categories/${c.body.data.id}`);
  assert.equal(blocked.status, 409, 'cannot delete a used category without reassigning');
  assert.equal(blocked.body.error.details.usage.expenses, 1);
  assert.equal((await agent.delete(`/api/categories/${m.cat('Other')}`)).status, 400, '"Other" is protected');
  const moved = await agent.delete(`/api/categories/${c.body.data.id}`).query({ reassignTo: m.cat('Other') });
  assert.equal(moved.status, 200);
  assert.equal((await agent.get(`/api/expenses/${e.id}`)).body.data.category.name, 'Other', 'expense preserved and moved');
  const pay = await agent.post('/api/payment-modes').send({ name: 'Wallet' });
  assert.equal(pay.status, 201);
  await addExpense(agent, { ...m, pay: (n) => (n === 'Wallet' ? pay.body.data.id : m.pay(n)) }, { pay: 'Wallet', date: '2026-10-07' });
  assert.equal((await agent.delete(`/api/payment-modes/${pay.body.data.id}`)).status, 409);
  assert.equal((await agent.delete(`/api/payment-modes/${pay.body.data.id}`).query({ reassignTo: m.pay('Cash') })).status, 200);
});

test('savings goals: progress comes only from recorded contributions; expenses never count', async () => {
  const { agent, m } = await seeded();
  const target = shiftPeriod(currentPeriod(), 4) + '-15';
  const g = await agent.post('/api/goals').send({ title: 'Laptop', targetAmount: 60000, targetDate: target });
  assert.equal(g.status, 201);
  assert.equal(g.body.data.saved, 0);
  assert.equal(g.body.data.percent, 0);
  await addExpense(agent, m, { amount: 9999, date: todayStr(), description: 'Laptop deposit' }); // an expense is NOT savings
  assert.equal((await agent.get('/api/goals')).body.data[0].saved, 0);
  const c1 = await agent.post(`/api/goals/${g.body.data.id}/contributions`).send({ amount: 15000, date: todayStr() });
  assert.equal(c1.body.data.saved, 15000);
  assert.equal(c1.body.data.remaining, 45000);
  assert.equal(c1.body.data.percent, 25);
  assert.ok(c1.body.data.requiredMonthly > 0, 'suggests a monthly contribution');
  const tooMuch = await agent.post(`/api/goals/${g.body.data.id}/contributions`).send({ amount: 99999, type: 'withdrawal' });
  assert.equal(tooMuch.status, 400);
  const done = await agent.post(`/api/goals/${g.body.data.id}/contributions`).send({ amount: 45000 });
  assert.equal(done.body.data.status, 'completed');
  const other = await newUser();
  assert.equal((await other.agent.post(`/api/goals/${g.body.data.id}/contributions`).send({ amount: 5 })).status, 404);
  assert.equal((await agent.delete(`/api/goals/${g.body.data.id}`)).status, 200);
});

test('recurring: schedule, post once, idempotent under concurrency, pause/resume, skip, no duplicates on refresh', async () => {
  const { agent, m, user } = await seeded();
  const start = day(0, 1);
  const r = await agent.post('/api/recurring').send({ description: 'Netflix', amount: 649, category: m.cat('Entertainment'), paymentMode: m.pay('UPI'), frequency: 'monthly', startDate: start });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.nextDueDate, start);
  // viewing/refreshing the page many times must not create expenses
  for (let i = 0; i < 3; i++) await agent.get('/api/recurring');
  assert.equal(await Expense.countDocuments({ user: user.id, recurringRule: r.body.data.id }), 0);
  // two simultaneous "mark as paid" clicks → exactly one expense
  const [a, b] = await Promise.all([agent.post(`/api/recurring/${r.body.data.id}/post`).send({ occurrence: start }), agent.post(`/api/recurring/${r.body.data.id}/post`).send({ occurrence: start })]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  // and a late repeat of the same click (sequential, after the first finished) is refused too, it must not pay next month
  assert.equal((await agent.post(`/api/recurring/${r.body.data.id}/post`).send({ occurrence: start })).status, 409);
  assert.equal(await Expense.countDocuments({ user: user.id, recurringRule: r.body.data.id }), 1);
  const after = (await agent.get('/api/recurring')).body.data.rules[0];
  assert.equal(after.nextDueDate, `${shiftPeriod(currentPeriod(), 1)}-01`);
  // flagged as recurring in expense list/filter
  assert.equal((await agent.get('/api/expenses').query({ recurring: 'yes' })).body.meta.count, 1);
  // skip, pause, resume
  const sk = await agent.post(`/api/recurring/${r.body.data.id}/skip`).send({ occurrence: after.nextDueDate });
  assert.equal(sk.body.data.rule.nextDueDate, `${shiftPeriod(currentPeriod(), 2)}-01`);
  assert.equal((await agent.post(`/api/recurring/${r.body.data.id}/pause`)).body.data.status, 'paused');
  const rs = await agent.post(`/api/recurring/${r.body.data.id}/resume`);
  assert.equal(rs.body.data.status, 'active');
  assert.ok(rs.body.data.nextDueDate >= todayStr(), 'no back-fill for the paused period');
  // validation
  assert.equal((await agent.post('/api/recurring').send({ description: 'x', amount: 5, category: m.cat('Food'), paymentMode: m.pay('UPI'), frequency: 'daily', startDate: start })).status, 400);
  assert.equal((await agent.post('/api/recurring').send({ description: 'x', amount: 5, category: m.cat('Food'), paymentMode: m.pay('UPI'), frequency: 'weekly', startDate: '2026-10-10', endDate: '2026-10-01' })).status, 400);
  // deleting the rule keeps already-posted expenses
  assert.equal((await agent.delete(`/api/recurring/${r.body.data.id}`)).status, 200);
  assert.equal(await Expense.countDocuments({ user: user.id, source: 'recurring' }), 1);
});

test('recurring auto-post is opt-in and idempotent across repeated runs', async () => {
  const { agent, m, user } = await seeded();
  const { processDueRules } = await import('../src/services/recurring.js');
  const start = day(-2, 15);
  const rule = (await agent.post('/api/recurring').send({ description: 'Gym', amount: 1000, category: m.cat('Health'), paymentMode: m.pay('UPI'), frequency: 'monthly', startDate: start, autoPost: true })).body.data;
  const manual = (await agent.post('/api/recurring').send({ description: 'Manual one', amount: 10, category: m.cat('Health'), paymentMode: m.pay('UPI'), frequency: 'monthly', startDate: start, autoPost: false })).body.data;
  const r1 = await processDueRules(user.id);
  const n1 = await Expense.countDocuments({ user: user.id, recurringRule: rule.id });
  const r2 = await processDueRules(user.id);
  const r3 = await Promise.all([processDueRules(user.id), processDueRules(user.id)]);
  const n2 = await Expense.countDocuments({ user: user.id, recurringRule: rule.id });
  assert.ok(r1.posted >= 2, 'catches up the due occurrences');
  assert.equal(n1, n2, 'no new expenses on later runs');
  assert.equal(r2.posted, 0);
  assert.equal(await Expense.countDocuments({ user: user.id, recurringRule: manual.id }), 0, 'manual rules never auto-post');
  void r3;
});

test('CSV import: template, preview with mapping, invalid rows, duplicates, commit, re-import safe, formula text, size/type limits', async () => {
  const { agent, m } = await seeded();
  const csv = [
    'Txn Date,Narration,Debit,Category,Mode',
    '2026-10-08,Coffee,120.50,Food,UPI',
    '09/10/2026,Taxi,"1,250",Travel,Cash',
    '2026-10-10,Bad amount,abc,Food,UPI',
    'not-a-date,Bad date,10,Food,UPI',
    '2026-10-02,Tea & snacks,99.5,Food,Cash',
    '2026-10-11,Gift,500,Gifts,Wallet',
    "2026-10-12,'=SUM(A1),70,Food,UPI",
  ].join('\n');
  const prev = await agent.post('/api/import/csv/preview').attach('file', Buffer.from(csv), 'bank.csv');
  assert.equal(prev.status, 200, JSON.stringify(prev.body));
  assert.deepEqual(prev.body.data.mapping, { date: 0, description: 1, amount: 2, category: 3, paymentMode: 4 });
  const sum = prev.body.data.summary;
  assert.equal(sum.total, 7);
  assert.equal(sum.invalid, 2);
  const byLine = Object.fromEntries(prev.body.data.rows.map((r) => [r.line, r]));
  assert.equal(byLine[3].data.date, '2026-10-09', 'D/M/Y parsed');
  assert.equal(byLine[3].data.amount, 1250);
  assert.equal(byLine[4].status, 'invalid');
  assert.equal(byLine[6].status, 'duplicate', 'matches the existing Tea & snacks expense');
  assert.ok(byLine[7].data.newCategory && byLine[7].data.newPayment);
  assert.equal(byLine[8].data.description, '=SUM(A1)', 'leading apostrophe from a previous export is removed');

  const rows = prev.body.data.allRows.filter((r) => r.status === 'valid').map((r) => r.data);
  const commit = await agent.post('/api/import/csv/commit').send({ fileName: 'bank.csv', rows });
  assert.equal(commit.status, 201);
  assert.equal(commit.body.data.imported, 4);
  const cats = await agent.get('/api/categories');
  assert.ok(cats.body.data.some((c) => c.name === 'Gifts'), 'new category created');
  const total = (await agent.get('/api/expenses').query({ source: 'csv' })).body.meta;
  assert.equal(total.count, 4);
  // importing the same file again: everything is now detected as a duplicate and skipped
  const again = await agent.post('/api/import/csv/commit').send({ rows });
  assert.equal(again.body.data.imported, 0);
  assert.equal(again.body.data.skippedDuplicate, 4);
  // the server revalidates: tampered rows are rejected, not saved
  const tampered = await agent.post('/api/import/csv/commit').send({ rows: [{ date: '2026-99-99', amount: '-5', description: 'x', category: 'Food', paymentMode: 'UPI' }] });
  assert.equal(tampered.body.data.imported, 0);
  assert.equal(tampered.body.data.skippedInvalid, 1);
  // not-a-CSV and oversize
  const bin = await agent.post('/api/import/csv/preview').attach('file', Buffer.from([0, 1, 2, 3, 0, 0]), 'x.csv');
  assert.equal(bin.status, 400);
  const wrongType = await agent.post('/api/import/csv/preview').attach('file', Buffer.from('a,b'), { filename: 'x.exe', contentType: 'application/octet-stream' });
  assert.equal(wrongType.status, 400);
  const big = await agent.post('/api/import/csv/preview').attach('file', Buffer.alloc(3 * 1024 * 1024, 'a'), 'big.csv');
  assert.equal(big.status, 413);
  const noHeader = await agent.post('/api/import/csv/preview').attach('file', Buffer.from('foo,bar\n1,2\n'), 'x.csv');
  assert.equal(noHeader.body.data.missingRequired.length, 2, 'asks the user to map date/amount');
  const mapped = await agent.post('/api/import/csv/preview').field('mapping', JSON.stringify({ date: 0, amount: 1 })).attach('file', Buffer.from('foo,bar\n2026-10-01,5\n'), 'x.csv');
  assert.equal(mapped.body.data.summary.valid, 1);
  const tpl = await agent.get('/api/import/csv/template');
  assert.match(tpl.text, /Date,Description,Merchant,Category,Payment Mode,Amount/);
  assert.equal((await request(app).post('/api/import/csv/preview')).status, 401);
});

test('legacy localStorage migration: validated, idempotent, reports problems, keeps good rows when some are bad', async () => {
  const { agent } = await seeded();
  const keys = {
    smartExpenseManager_expenses: JSON.stringify([
      { id: 1760000000001, amount: 250, category: 'Food', description: 'Tea', paymentMode: 'Card', date: '2026-10-01' },
      { id: 1760000000002, amount: 75, category: 'Travel', description: 'Bus', paymentMode: 'Cash', date: '2026-10-02' },
      { id: 1760000000003, amount: 'bad', category: 'Food', date: '2026-10-02' },
    ]),
    smartExpenseManager_income: JSON.stringify({ '2026-10': 50000 }),
    smartExpenseManager_budgets: JSON.stringify({ '2026-10': { Food: 6000, Travel: 2500 } }),
    smartExpenseManager_warningThreshold: '75',
  };
  const r1 = await agent.post('/api/migration/legacy').send({ keys });
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  assert.equal(r1.body.data.expensesImported, 2);
  assert.equal(r1.body.data.skipped, 1);
  assert.equal(r1.body.data.budgets, 2);
  const r2 = await agent.post('/api/migration/legacy').send({ keys });
  assert.equal(r2.body.data.expensesImported, 0, 're-running creates no duplicates');
  assert.equal(r2.body.data.expensesAlreadyPresent, 2);
  assert.equal((await agent.get('/api/expenses').query({ source: 'migration' })).body.meta.count, 2);
  assert.equal((await agent.get('/api/income').query({ period: '2026-10' })).body.data.amount, 50000);
  assert.equal((await agent.get('/api/auth/me')).body.data.user.warningThreshold, 75);
  const cats = (await agent.get('/api/categories')).body.data.map((c) => c.name);
  assert.ok(cats.includes('Food'), 'existing categories reused, not duplicated');
  assert.equal(cats.filter((c) => c === 'Food').length, 1);
  assert.ok((await agent.get('/api/payment-modes')).body.data.some((p) => p.name === 'Card'), 'legacy "Card" preserved as its own payment mode');
  assert.equal((await agent.post('/api/migration/legacy').send({ keys: { smartExpenseManager_expenses: '[]' } })).status, 400);
  assert.equal((await agent.get('/api/migration/status')).body.data.migrated, true);
});