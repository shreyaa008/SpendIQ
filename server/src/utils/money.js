const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'AED ' };
export const symbolOf = (c = 'INR') => SYMBOLS[c] ?? `${c} `;
export const makeFmt = (currency = 'INR') => {
  const s = symbolOf(currency);
  return (n) => {
    const v = Number(n) || 0;
    const body = Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: Number.isInteger(v) ? 0 : 2, minimumFractionDigits: Number.isInteger(v) ? 0 : 2 });
    return `${v < 0 ? '-' : ''}${s}${body}`;
  };
};