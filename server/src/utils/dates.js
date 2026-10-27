// Dates are stored as UTC-midnight instants and exchanged as "YYYY-MM-DD" strings, so a calendar day never shifts with time zones.
export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDay(s) {
  if (typeof s !== 'string' || !DAY_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const parseDay = (s) => new Date(`${s}T00:00:00.000Z`);
export const formatDay = (d) => new Date(d).toISOString().slice(0, 10);
export const periodOf = (d) => formatDay(d).slice(0, 7);

export const todayStr = (now = new Date()) => formatDay(now);
export const currentPeriod = (now = new Date()) => periodOf(now);

export function periodRange(period) {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }; // [start, end)
}
export function daysInPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function shiftPeriod(period, offset) {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + offset;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
export function periodsBetween(from, to) {
  const out = [];
  for (let p = from; p <= to; p = shiftPeriod(p, 1)) out.push(p);
  return out;
}
export function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
export function addMonthsClamped(d, n) {
  const src = new Date(d);
  const day = src.getUTCDate();
  const target = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth() + n, 1));
  const dim = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, dim));
  return target;
}
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;