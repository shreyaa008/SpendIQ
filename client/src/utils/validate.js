// Small client-side validators. The server re-validates everything; these only give instant feedback.
export const isDay = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // rejects 2026-02-30 and 2026-13-01 alike
};
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

export function validateExpense(v) {
  const e = {};
  const amt = Number(v.amount);
  if (v.amount === '' || Number.isNaN(amt)) e.amount = 'Enter an amount';
  else if (amt <= 0) e.amount = 'Amount must be greater than 0';
  else if (amt > 100000000) e.amount = 'Amount is too large';
  if (!v.date || !isDay(v.date)) e.date = 'Choose a valid date';
  if (!v.category) e.category = 'Choose a category';
  if (!v.paymentMode) e.paymentMode = 'Choose a payment mode';
  if ((v.description || '').length > 200) e.description = 'Keep it under 200 characters';
  return e;
}
export function validatePassword(p) {
  if (p.length < 8) return 'Use at least 8 characters';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Include at least one letter and one number';
  return '';
}
