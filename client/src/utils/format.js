const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED'];

export function makeMoney(currency = 'INR') {
  const sym = SYMBOLS[currency] ?? `${currency} `;
  return (n, { compact = false, decimals } = {}) => {
    const v = Number(n) || 0;
    if (compact && Math.abs(v) >= 1000) {
      const u = Math.abs(v) >= 1e7 ? [1e7, 'Cr'] : Math.abs(v) >= 1e5 ? [1e5, 'L'] : [1e3, 'k'];
      return `${v < 0 ? '-' : ''}${sym}${(Math.abs(v) / u[0]).toFixed(1).replace(/\.0$/, '')}${u[1]}`;
    }
    const d = decimals ?? (Number.isInteger(v) ? 0 : 2);
    return `${v < 0 ? '-' : ''}${sym}${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
  };
}

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // local calendar day
};
export const currentPeriod = () => todayStr().slice(0, 7);

export function shiftPeriod(period, offset) {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + offset;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
export function periodLabel(period, short = false) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric', timeZone: 'UTC' });
}
export function formatDay(day, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
}
export const shortDay = (day) => formatDay(day, { day: 'numeric', month: 'short' });
export const pct = (n, digits = 0) => `${Number(n).toFixed(digits)}%`;
export const signed = (n, fmt) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const clsx = (...a) => a.filter(Boolean).join(' ');