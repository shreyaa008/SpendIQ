// Turns raw OCR text into structured receipt fields. Heuristic, so every field is optional and the user always reviews the result.
import { isValidDay, round2, todayStr, addDays, parseDay, formatDay } from '../utils/dates.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONEY = /(?<![\d.])(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d])/g;

const toNumber = (s) => Number(String(s).replace(/,/g, ''));
export function moneyTokens(line) {
  const out = [];
  for (const m of line.matchAll(MONEY)) {
    const after = line.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^\s*%/.test(after)) continue; // a percentage such as "18%"
    const n = toNumber(m[1]);
    if (Number.isFinite(n)) out.push({ value: n, hasDecimals: m[1].includes('.'), index: m.index });
  }
  return out;
}

function plausibleDate(y, m, d) {
  const s = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!isValidDay(s) || y < 2000) return null;
  if (s > formatDay(addDays(parseDay(todayStr()), 1))) return null; // receipts are not dated in the future
  return s;
}

export function findDate(text) {
  const candidates = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, li) => {
    const keyword = /date|dt\b|dated|bill\s*date|invoice\s*date/i.test(line);
    for (const m of line.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
      const s = plausibleDate(+m[1], +m[2], +m[3]);
      if (s) candidates.push({ s, keyword, li, ambiguous: false });
    }
    for (const m of line.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g)) {
      let [a, b, y] = [+m[1], +m[2], +m[3]];
      if (y < 100) y += 2000;
      let s = plausibleDate(y, b, a); // D/M/Y first (India)
      let ambiguous = a <= 12 && b <= 12 && a !== b;
      if (!s) { s = plausibleDate(y, a, b); ambiguous = false; }
      if (s) candidates.push({ s, keyword, li, ambiguous });
    }
    for (const m of line.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})[\s,.-]+(\d{2,4})\b/g)) {
      const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
      let y = +m[3]; if (y < 100) y += 2000;
      const s = mo && plausibleDate(y, mo, +m[1]);
      if (s) candidates.push({ s, keyword, li, ambiguous: false });
    }
    for (const m of line.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
      const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
      const s = mo && plausibleDate(+m[3], mo, +m[2]);
      if (s) candidates.push({ s, keyword, li, ambiguous: false });
    }
  });
  if (!candidates.length) return { value: '', ambiguous: false };
  const best = candidates.find((c) => c.keyword) ?? candidates[0];
  return { value: best.s, ambiguous: best.ambiguous };
}

const NOT_MERCHANT = /^(tax\s*invoice|invoice|receipt|cash\s*(memo|bill)|bill|gstin|gst\b|tel|ph(one)?|mob|www|http|email|address|date|time|welcome|thank|customer|order|table|token|bill\s*no|inv)/i;
export function findMerchant(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  for (const line of lines) {
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters < 3 || letters < line.length * 0.5) continue;
    if (NOT_MERCHANT.test(line) || /\d{6,}/.test(line)) continue;
    return line.replace(/[^\w&'’.,\- ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  return '';
}

const TOTAL_KEYS = [/grand\s*total/i, /(total\s*)?amount\s*(payable|due)/i, /net\s*(payable|amount|total)/i, /balance\s*due/i, /total\s*(amount|payable|due|bill)?/i];
const SKIP_TOTAL = /sub\s*-?\s*total|tax|gst|vat|discount|saving|change|tendered|round|items?\s*total|total\s*qty|total\s*items|total\s*units/i;

export function findTotal(text) {
  const lines = text.split(/\r?\n/);
  for (const key of TOTAL_KEYS) {
    const hits = [];
    lines.forEach((line, i) => {
      if (!key.test(line) || SKIP_TOTAL.test(line.replace(key, ''))) return;
      let toks = moneyTokens(line);
      if (!toks.length && lines[i + 1]) toks = moneyTokens(lines[i + 1]); // amount wrapped to the next line
      if (toks.length) hits.push(toks[toks.length - 1].value);
    });
    if (hits.length) return { value: round2(hits[hits.length - 1]), fromKeyword: true };
  }
  const all = lines.flatMap((l) => (/\b(phone|tel|gstin|invoice\s*no|bill\s*no|order)\b/i.test(l) ? [] : moneyTokens(l).filter((t) => t.hasDecimals)));
  if (!all.length) return { value: null, fromKeyword: false };
  return { value: round2(Math.max(...all.map((t) => t.value))), fromKeyword: false };
}

export function findSubtotal(text) {
  for (const line of text.split(/\r?\n/)) {
    if (/sub\s*-?\s*total/i.test(line)) {
      const t = moneyTokens(line);
      if (t.length) return round2(t[t.length - 1].value);
    }
  }
  return null;
}

export function findTax(text) {
  const lines = text.split(/\r?\n/);
  const totalTax = lines.find((l) => /total\s*(gst|tax|vat)|tax\s*total/i.test(l));
  if (totalTax) {
    const t = moneyTokens(totalTax);
    if (t.length) return round2(t[t.length - 1].value);
  }
  let sumTax = 0;
  let found = false;
  for (const line of lines) {
    if (!/\b(cgst|sgst|igst|gst|vat|service\s*tax|tax)\b/i.test(line) || /gstin|invoice|taxable/i.test(line)) continue;
    const t = moneyTokens(line).filter((x) => x.hasDecimals);
    if (t.length) { sumTax += t[t.length - 1].value; found = true; }
  }
  return found ? round2(sumTax) : null;
}

export function findCurrency(text) {
  if (/₹|\brs\.?\s*\d|\binr\b/i.test(text)) return 'INR';
  if (/\$|\busd\b/i.test(text)) return 'USD';
  if (/€|\beur\b/i.test(text)) return 'EUR';
  if (/£|\bgbp\b/i.test(text)) return 'GBP';
  return '';
}

/** Only returns a method when the receipt states it explicitly. */
export function findPaymentMethod(text) {
  const t = text.toLowerCase();
  if (/\b(upi|gpay|google\s*pay|phonepe|paytm|bhim)\b/.test(t)) return 'UPI';
  if (/debit\s*card/.test(t)) return 'Debit Card';
  if (/credit\s*card|\bvisa\b|master\s*card|mastercard|amex/.test(t)) return 'Credit Card';
  if (/net\s*banking|netbanking|\bneft\b|\bimps\b|\brtgs\b/.test(t)) return 'Net Banking';
  if (/(paid|payment|mode|tender(ed)?|method)[^\n]{0,25}\bcash\b|\bcash\s*(paid|tendered|payment)/.test(t)) return 'Cash';
  if (/\bcard\b[^\n]{0,15}(payment|paid|approved|xxxx|\*{2,})/.test(t)) return 'Card';
  return '';
}

export function findLineItems(text) {
  const items = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 4 || /total|tax|gst|vat|change|cash|card|upi|round|discount|balance|amount|invoice|date|phone|gstin/i.test(line)) continue;
    const m = line.match(/^(.*?[A-Za-z].*?)\s+(?:(\d{1,3})\s*[x×@]?\s+)?(\d[\d,]*\.\d{2})$/);
    if (!m) continue;
    const description = m[1].replace(/\s{2,}/g, ' ').replace(/[^\w&'’.,\-/() ]/g, '').trim().slice(0, 100);
    if (description.length < 2) continue;
    items.push({ description, quantity: m[2] ? Number(m[2]) : 1, amount: round2(toNumber(m[3])) });
    if (items.length >= 40) break;
  }
  return items;
}

const CATEGORY_KEYWORDS = {
  Food: ['restaurant', 'cafe', 'café', 'coffee', 'pizza', 'burger', 'swiggy', 'zomato', 'bakery', 'biryani', 'dominos', "domino's", 'kfc', 'mcdonald', 'starbucks', 'dhaba', 'sweets', 'kitchen', 'diner', 'bistro', 'grocery', 'supermarket', 'mart', 'bigbasket', 'blinkit', 'zepto', 'dmart', 'fresh', 'vegetables', 'milk'],
  Shopping: ['mall', 'fashion', 'apparel', 'clothing', 'footwear', 'electronics', 'amazon', 'flipkart', 'myntra', 'lifestyle', 'store', 'retail', 'furniture'],
  Travel: ['uber', 'ola', 'rapido', 'irctc', 'railway', 'airlines', 'airways', 'indigo', 'petrol', 'fuel', 'diesel', 'taxi', 'cab', 'metro', 'bus', 'toll', 'parking', 'hotel', 'resort', 'makemytrip'],
  Bills: ['electricity', 'water bill', 'broadband', 'internet', 'recharge', 'airtel', 'jio', 'vodafone', 'insurance', 'rent', 'gas', 'postpaid', 'dth'],
  Entertainment: ['cinema', 'movie', 'pvr', 'inox', 'netflix', 'spotify', 'bookmyshow', 'gaming', 'theatre', 'amusement', 'concert'],
  Health: ['pharmacy', 'medical', 'chemist', 'hospital', 'clinic', 'apollo', 'medplus', 'diagnostic', 'dental', 'pathology', 'lab', 'optical'],
};

/** Suggests one of the user's own category names, or '' when nothing matches. */
export function suggestCategory(text, userCategoryNames) {
  const t = text.toLowerCase();
  const byLower = new Map(userCategoryNames.map((n) => [n.toLowerCase(), n]));
  for (const name of userCategoryNames) if (name.length >= 4 && name.toLowerCase() !== 'other' && t.includes(name.toLowerCase())) return name;
  let best = { name: '', score: 0 };
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (!byLower.has(cat.toLowerCase())) continue;
    const score = words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
    if (score > best.score) best = { name: byLower.get(cat.toLowerCase()), score };
  }
  return best.name;
}

export function parseReceiptText(text, { categories = [] } = {}) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const warnings = [];
  const merchant = findMerchant(clean);
  const date = findDate(clean);
  const total = findTotal(clean);
  const subtotal = findSubtotal(clean);
  const tax = findTax(clean);
  const lineItems = findLineItems(clean);
  if (!merchant) warnings.push('Could not find the merchant name. Please enter it.');
  if (!date.value) warnings.push('Could not find a valid date. Please enter it.');
  else if (date.ambiguous) warnings.push(`The date could be read two ways; assumed day/month/year (${date.value}). Please check it.`);
  if (total.value == null) warnings.push('Could not find the total amount. Please enter it.');
  else if (!total.fromKeyword) warnings.push('No “Total” line was found; the largest amount on the receipt was used. Please check it.');
  if (subtotal != null && tax != null && total.value != null && Math.abs(subtotal + tax - total.value) > Math.max(1, total.value * 0.03)) warnings.push('Subtotal + tax does not match the total. Some values may have been misread.');
  const found = [merchant, date.value, total.value != null].filter(Boolean).length;
  return {
    merchant,
    date: date.value,
    total: total.value,
    subtotal,
    tax,
    currency: findCurrency(clean),
    paymentMethod: findPaymentMethod(clean),
    suggestedCategory: suggestCategory(clean, categories),
    lineItems,
    confidence: round2(found / 3),
    warnings,
  };
}