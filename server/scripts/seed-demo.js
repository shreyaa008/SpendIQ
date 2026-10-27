// Creates a demo account with ~6 months of realistic spending so every screen has something to show.
//   npm run seed:demo          → demo@spendiq.test / Demo1234
// Safe to re-run: it recreates the demo user's data. It never touches other accounts.
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { User, Expense, Budget, Income, SavingsGoal, Contribution, RecurringRule, Category, PaymentMode } from '../src/models/index.js';
import { seedWorkspace } from '../src/services/workspace.js';
import { shiftPeriod, currentPeriod, todayStr, parseDay, daysInPeriod } from '../src/utils/dates.js';
import { firstOccurrenceOnOrAfter } from '../src/services/recurring.js';

const EMAIL = 'demo@spendiq.test';
await connectDb();
const old = await User.findOne({ email: EMAIL });
if (old) {
  const f = { user: old._id };
  await Promise.all([Expense, Budget, Income, SavingsGoal, Contribution, RecurringRule, Category, PaymentMode].map((m) => m.deleteMany(f)));
  await User.deleteOne({ _id: old._id });
}
const user = await User.create({ name: 'Demo User', email: EMAIL, passwordHash: await bcrypt.hash('Demo1234', 12) });
await seedWorkspace(user._id);
const cats = Object.fromEntries((await Category.find({ user: user._id })).map((c) => [c.name, c._id]));
const pays = Object.fromEntries((await PaymentMode.find({ user: user._id })).map((p) => [p.name, p._id]));

// deterministic pseudo-random so the demo looks the same every time
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const today = todayStr();
const cur = currentPeriod();
const catalog = {
  Food: [['Groceries', 'BigBasket', 900, 2200, 'UPI'], ['Lunch', 'Green Leaf Cafe', 180, 520, 'UPI'], ['Dinner out', 'Spice Hut', 600, 1600, 'Credit Card'], ['Coffee', 'Blue Tokai', 150, 380, 'UPI']],
  Travel: [['Auto / cab', 'Uber', 120, 450, 'UPI'], ['Fuel', 'Indian Oil', 800, 2000, 'Debit Card'], ['Metro recharge', 'DMRC', 300, 600, 'UPI']],
  Shopping: [['Clothes', 'Myntra', 700, 3500, 'Credit Card'], ['Household', 'Amazon', 250, 1800, 'Credit Card']],
  Entertainment: [['Movie night', 'PVR', 400, 1200, 'Debit Card']],
  Health: [['Pharmacy', 'Apollo Pharmacy', 150, 900, 'Cash']],
};
const docs = [];
for (let off = -5; off <= 0; off++) {
  const p = shiftPeriod(cur, off);
  const last = off === 0 ? Number(today.slice(8)) : daysInPeriod(p);
  const growth = 1 + (off + 5) * 0.05; // Travel creeps up so the trend detector has something real to find
  for (let d = 1; d <= last; d++) {
    const n = rnd() < 0.55 ? 1 : rnd() < 0.5 ? 2 : 0;
    for (let i = 0; i < n; i++) {
      const cat = pick(['Food', 'Food', 'Food', 'Travel', 'Travel', 'Shopping', 'Entertainment', 'Health']);
      const [desc, merchant, lo, hi, pay] = pick(catalog[cat]);
      const amount = Math.round((lo + rnd() * (hi - lo)) * (cat === 'Travel' ? growth : 1));
      docs.push({ user: user._id, amount, description: desc, merchant, category: cats[cat], paymentMode: pays[pay], date: parseDay(`${p}-${String(d).padStart(2, '0')}`), source: 'manual', currency: 'INR' });
    }
  }
  if (off < 0 || last >= 1) {
    docs.push({ user: user._id, amount: 14000, description: 'Rent', merchant: 'Landlord', category: cats.Bills, paymentMode: pays['Bank Transfer'], date: parseDay(`${p}-01`), source: 'manual', currency: 'INR' });
    docs.push({ user: user._id, amount: 1650, description: 'Electricity bill', merchant: 'BESCOM', category: cats.Bills, paymentMode: pays['Net Banking'], date: parseDay(`${p}-${off === 0 ? '02' : '08'}`), source: 'manual', currency: 'INR' });
  }
}
await Expense.insertMany(docs.filter((d) => d.date <= parseDay(today)).map((d) => new Expense(d)));
for (const [c, limit] of [['Food', 9000], ['Travel', 4500], ['Shopping', 5000], ['Entertainment', 2000]]) await Budget.create({ user: user._id, category: cats[c], period: 'default', limit });
for (let off = -5; off <= 0; off++) await Income.create({ user: user._id, period: shiftPeriod(cur, off), amount: 65000 });
const nx = (rule) => { rule.nextDueDate = firstOccurrenceOnOrAfter(rule, rule.startDate); return rule; };
await RecurringRule.create([
  nx(new RecurringRule({ user: user._id, description: 'Netflix', amount: 649, category: cats.Entertainment, paymentMode: pays['Credit Card'], frequency: 'monthly', startDate: parseDay(`${cur}-20`) })),
  nx(new RecurringRule({ user: user._id, description: 'Gym membership', amount: 1500, category: cats.Health, paymentMode: pays.UPI, frequency: 'monthly', startDate: parseDay(`${cur}-25`) })),
  nx(new RecurringRule({ user: user._id, description: 'Cloud storage', amount: 2400, category: cats.Bills, paymentMode: pays['Credit Card'], frequency: 'yearly', startDate: parseDay(`${shiftPeriod(cur, 3)}-10`) })),
]);
const laptop = await SavingsGoal.create({ user: user._id, title: 'New laptop', targetAmount: 80000, targetDate: parseDay(`${shiftPeriod(cur, 6)}-15`) });
const trip = await SavingsGoal.create({ user: user._id, title: 'Goa trip', targetAmount: 30000, targetDate: parseDay(`${shiftPeriod(cur, 2)}-01`) });
for (let off = -3; off <= 0; off++) await Contribution.create({ user: user._id, goal: laptop._id, amount: 6000, date: parseDay(`${shiftPeriod(cur, off)}-05`) });
await Contribution.create({ user: user._id, goal: trip._id, amount: 4000, date: parseDay(`${shiftPeriod(cur, -1)}-12`) });
console.log(`Demo account ready: ${EMAIL} / Demo1234  (${docs.length} expenses)`);
await disconnectDb();
