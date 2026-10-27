export const mean = (a) => (a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0);
export function variance(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1);
}
export const sd = (a) => Math.sqrt(variance(a));
export function quantile(a, q) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (a) => quantile(a, 0.5);

/** Exponentially weighted moving average; the last value of the smoothed series. */
export function ewma(a, alpha = 0.5) {
  if (!a.length) return 0;
  let level = a[0];
  for (let i = 1; i < a.length; i++) level = alpha * a[i] + (1 - alpha) * level;
  return level;
}

/** Theil–Sen slope: the median of all pairwise slopes. Robust against a single odd month. */
export function theilSen(a) {
  const slopes = [];
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) slopes.push((a[j] - a[i]) / (j - i));
  return slopes.length ? median(slopes) : 0;
}

/** Standard normal CDF (Abramowitz & Stegun 26.2.17, |error| < 7.5e-8). */
export function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}