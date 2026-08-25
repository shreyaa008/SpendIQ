/* =========================================================
   EXPENSES.JS — Member A: Expense Engine
   Owns: the shared `expenses` array, CRUD operations,
         LocalStorage persistence, filtering/sorting/totals.

   TABLE OF CONTENTS
     1. Shared constants + shared state
     2. Persistence (expenses + income) — LocalStorage
     3. ID generation — while loop
     4. CRUD operations — push/splice/pop/shift/unshift
     5. Filtering / sorting — filter, sort, slice
     6. Calculations — reduce, function expression
   ========================================================= */

/* ---------- Lecture 15-16: shared constants (objects/arrays) ---------- */
// Every other file (ui.js, budget.js) reads these instead of hardcoding
// category/payment strings, so "Food" never becomes "food" somewhere else.
const CATEGORIES = ["Food", "Shopping", "Travel", "Bills", "Entertainment", "Health", "Other"];
const PAYMENT_MODES = ["UPI", "Cash", "Card", "Net Banking"];

/* ---------- Lecture 23: LocalStorage keys ---------- */
const STORAGE_KEY_EXPENSES = "smartExpenseManager_expenses";
const STORAGE_KEY_INCOME = "smartExpenseManager_income";
const STORAGE_KEY_SELECTED_PERIOD = "smartExpenseManager_selectedPeriod";

/* ---------- Lecture 1-2 / 9-10: the shared array ----------
   `let` because we reassign it wholesale on load; every other
   file just reads/reacts to this same array, never redeclares it. */
let expenses = [];

/* ---------- Lecture 11-12: "recently deleted" stack, powers Undo ----------
   Kept separate from `expenses` on purpose — it's a small, temporary
   holding area, not persisted data. */
const MAX_RECENTLY_DELETED = 5;
let recentlyDeleted = [];

/* Monthly income object keyed by period ("YYYY-MM").
   e.g. { "2026-08": 25000, "2026-09": 30000 } */
let monthlyIncome = {};

/* Single source of truth for the currently selected period ("YYYY-MM") */
let selectedPeriod = "";

/* =========================================================
   PERIOD HELPERS & SELECTED PERIOD STATE
   ========================================================= */

/**
 * Validates whether a string is a valid period key ("YYYY-MM" with MM between 01 and 12).
 * @param {string} periodKey
 * @returns {boolean}
 */
function isValidPeriodKey(periodKey) {
  return typeof periodKey === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey);
}

/**
 * Returns the actual current month key in "YYYY-MM" format.
 * @returns {string} e.g. "2026-08"
 */
function getCurrentPeriodKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Safely extracts the "YYYY-MM" period key from a date string (e.g. "2026-08-05").
 * @param {string} dateStr
 * @returns {string} e.g. "2026-08"
 */
function getPeriodKey(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return getCurrentPeriodKey();
  const match = dateStr.match(/^(\d{4}-(?:0[1-9]|1[0-2]))/);
  return match ? match[1] : getCurrentPeriodKey();
}

/**
 * Formats a "YYYY-MM" period key into a human-readable string.
 * @param {string} periodKey - e.g. "2026-08"
 * @returns {string} e.g. "August 2026"
 */
function formatPeriodLabel(periodKey) {
  if (!isValidPeriodKey(periodKey)) {
    periodKey = getCurrentPeriodKey();
  }
  const [yearStr, monthStr] = periodKey.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Calculates a new period key shifted by offset months (handles year roll-overs).
 * @param {string} periodKey - e.g. "2026-12"
 * @param {number} offset - e.g. 1 or -1
 * @returns {string} e.g. "2027-01"
 */
function getShiftedPeriodKey(periodKey, offset = 0) {
  if (!isValidPeriodKey(periodKey)) {
    periodKey = getCurrentPeriodKey();
  }
  const [yearStr, monthStr] = periodKey.split("-");
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) + offset;

  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Loads stored selectedPeriod or defaults to current month. */
function loadSelectedPeriod() {
  const raw = localStorage.getItem(STORAGE_KEY_SELECTED_PERIOD);
  if (isValidPeriodKey(raw)) {
    selectedPeriod = raw;
  } else {
    selectedPeriod = getCurrentPeriodKey();
  }
}

/** Sets and persists selectedPeriod. */
function setSelectedPeriod(periodKey) {
  if (isValidPeriodKey(periodKey)) {
    selectedPeriod = periodKey;
    localStorage.setItem(STORAGE_KEY_SELECTED_PERIOD, selectedPeriod);
  }
}


/* =========================================================
   PERSISTENCE (Lecture 23, 15-16: JSON.stringify/parse)
   ========================================================= */

/**
 * Loads expenses from LocalStorage into the shared `expenses` array.
 * Call once when the app starts.
 */
function loadExpenses() {
  const raw = localStorage.getItem(STORAGE_KEY_EXPENSES);
  if (!raw) {
    expenses = [];
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    expenses = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to parse stored expense data:", error);
    expenses = [];
  }
}

/**
 * Persists the current `expenses` array to LocalStorage.
 * Call after every add/edit/delete.
 */
function saveExpenses() {
  localStorage.setItem(STORAGE_KEY_EXPENSES, JSON.stringify(expenses));
}

/**
 * Loads the saved monthly income from LocalStorage.
 * Migrates old plain number income to period-keyed object if detected.
 */
function loadIncome() {
  const raw = localStorage.getItem(STORAGE_KEY_INCOME);
  if (!raw) {
    monthlyIncome = {};
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "number" || (typeof parsed === "string" && !isNaN(Number(parsed)))) {
      // Legacy format migration
      monthlyIncome = { [getCurrentPeriodKey()]: Number(parsed) };
      saveIncome();
    } else if (typeof parsed === "object" && parsed !== null) {
      monthlyIncome = parsed;
    } else {
      monthlyIncome = {};
    }
  } catch (e) {
    console.error("Failed to parse stored income data:", e);
    const num = Number(raw);
    if (!isNaN(num)) {
      monthlyIncome = { [getCurrentPeriodKey()]: num };
      saveIncome();
    } else {
      monthlyIncome = {};
    }
  }
}

/** Persists monthlyIncome object to LocalStorage. */
function saveIncome() {
  localStorage.setItem(STORAGE_KEY_INCOME, JSON.stringify(monthlyIncome));
}

/**
 * Returns monthly income for a given period.
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {number}
 */
function getMonthlyIncome(period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;
  const val = Number(monthlyIncome[targetPeriod]);
  return !isNaN(val) && val >= 0 ? val : 0;
}

/**
 * Sets and persists monthly income for a given period.
 * @param {number} amount
 * @param {string} [period] - defaults to selectedPeriod
 */
function setMonthlyIncome(amount, period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;
  if (typeof isValidPeriodKey === "function" && !isValidPeriodKey(targetPeriod)) {
    return false;
  }
  if (amount === null || typeof amount === "boolean" || (typeof amount === "string" && amount.trim() === "")) {
    return false;
  }
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount < 0) {
    return false;
  }
  monthlyIncome[targetPeriod] = numAmount;
  saveIncome();
  return true;
}


/* =========================================================
   ID GENERATION (Lecture 5-6: while loop)
   ========================================================= */

/**
 * Generates an id that isn't already used by another expense.
 * A while loop is the right tool here (rather than for/forEach) because
 * we don't know in advance how many times we'll need to bump the id —
 * we just keep going *while* a collision exists.
 * @returns {number}
 */
function generateUniqueId() {
  let newId = Date.now();

  // Lecture 5-6: while loop — guards against two expenses getting the
  // same id if they're ever added within the same millisecond
  while (expenses.some((expense) => expense.id === newId)) {
    newId += 1;
  }

  return newId;
}


/* =========================================================
   CRUD OPERATIONS (Lecture 7-8: functions, 11-12: array methods)
   ========================================================= */

/**
 * Adds a new expense to the array.
 * @param {Object} expenseData - { amount, category, description, paymentMode, date }
 * @returns {Object|null} the newly created expense (with generated id), or null if invalid
 */
function addExpense(expenseData) {
  if (!expenseData || typeof expenseData !== "object") {
    return null;
  }

  // Lecture 24: default parameter — description defaults to empty string if omitted
  const { amount, category, description = "", paymentMode, date } = expenseData;

  if (amount === null || typeof amount === "boolean" || (typeof amount === "string" && amount.trim() === "")) {
    return null;
  }
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return null;
  }

  if (typeof category !== "string" || !CATEGORIES.includes(category)) {
    return null;
  }

  if (typeof paymentMode !== "string" || !PAYMENT_MODES.includes(paymentMode)) {
    return null;
  }

  if (typeof date !== "string" || !date.trim() || isNaN(new Date(date).getTime())) {
    return null;
  }

  const safeDescription = typeof description === "string" ? description : String(description ?? "");

  const newExpense = {
    id: generateUniqueId(),
    amount: numAmount, // Lecture 3-4: type conversion, form values arrive as strings
    category,
    description: safeDescription,
    paymentMode,
    date
  };

  expenses.push(newExpense); // Lecture 11-12: push()
  saveExpenses();
  return newExpense;
}

/**
 * Removes an expense by id, and stashes it in `recentlyDeleted` so it
 * can be restored with undoLastDelete().
 * @param {number} id
 * @returns {boolean} true if something was removed
 */
function deleteExpense(id) {
  const index = expenses.findIndex((expense) => expense.id === id);
  if (index === -1) return false;

  // Lecture 11-12: splice() removes exactly one item at `index` and
  // RETURNS it as a one-item array — different from filter(), which
  // would build a whole new array instead of mutating this one directly
  const [removedExpense] = expenses.splice(index, 1);

  recentlyDeleted.push(removedExpense); // Lecture 11-12: push() onto the undo stack
  if (recentlyDeleted.length > MAX_RECENTLY_DELETED) {
    recentlyDeleted.shift(); // Lecture 11-12: shift() — drop the oldest undo entry
  }

  saveExpenses();
  return true;
}

/**
 * Restores the most recently deleted expense, if any.
 * @returns {Object|null} the restored expense, or null if nothing to undo
 */
function undoLastDelete() {
  if (recentlyDeleted.length === 0) return null;

  const restored = recentlyDeleted.pop(); // Lecture 11-12: pop() — most recent deletion
  expenses.unshift(restored); // Lecture 11-12: unshift() — put it back at the front
  saveExpenses();
  return restored;
}

/**
 * Updates fields on an existing expense.
 * @param {number} id
 * @param {Object} updatedFields - partial expense object, e.g. { amount: 600 }
 * @returns {Object|null} the updated expense, or null if not found or invalid
 */
function editExpense(id, updatedFields) {
  if (!updatedFields || typeof updatedFields !== "object") return null;

  const index = expenses.findIndex((expense) => expense.id === id);
  if (index === -1) return null;

  // Lecture 24: spread operator — merge old expense with only the changed fields
  const merged = { ...expenses[index], ...updatedFields };

  if (merged.amount === null || typeof merged.amount === "boolean" || (typeof merged.amount === "string" && String(merged.amount).trim() === "")) {
    return null;
  }
  const numAmount = Number(merged.amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return null;
  }

  if (typeof merged.category !== "string" || !CATEGORIES.includes(merged.category)) {
    return null;
  }

  if (typeof merged.paymentMode !== "string" || !PAYMENT_MODES.includes(merged.paymentMode)) {
    return null;
  }

  if (typeof merged.date !== "string" || !merged.date.trim() || isNaN(new Date(merged.date).getTime())) {
    return null;
  }

  merged.amount = numAmount;
  merged.description = typeof merged.description === "string" ? merged.description : String(merged.description ?? "");

  expenses[index] = merged;
  saveExpenses();
  return merged;
}

/**
 * Looks up a single expense by id.
 * @param {number} id
 * @returns {Object|undefined}
 */
function getExpenseById(id) {
  return expenses.find((expense) => expense.id === id);
}


/* =========================================================
   FILTERING / SORTING (Lecture 13-14: higher-order functions)
   ========================================================= */

/**
 * Returns all expenses belonging to a specific period ("YYYY-MM").
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {Array} expenses in that period
 */
function getExpensesForPeriod(period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;
  return expenses.filter((expense) => getPeriodKey(expense.date) === targetPeriod);
}

/**
 * Returns expenses matching a category, search term, and period.
 * @param {string} category - a value from CATEGORIES, or "All"
 * @param {string} searchTerm - matched against description (case-insensitive)
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {Array} the matching expenses
 */
function getFilteredExpenses(category = "All", searchTerm = "", period = selectedPeriod) {
  const term = searchTerm.trim().toLowerCase();
  const periodExpenses = getExpensesForPeriod(period);

  return periodExpenses.filter((expense) => {
    const matchesCategory = category === "All" || expense.category === category;
    if (!term) return matchesCategory;

    // Search across description, category, payment mode, and date —
    // not just description — so "food" or "upi" actually finds things.
    const description = typeof expense.description === "string" ? expense.description : "";
    const haystack = [description, expense.category, expense.paymentMode, expense.date]
      .join(" ")
      .toLowerCase();

    return matchesCategory && haystack.includes(term);
  });
}

/**
 * Returns a NEW sorted array (does not mutate the input).
 * @param {Array} expenseArray
 * @param {string} sortBy - "amountAsc" | "amountDesc" | "dateAsc" | "dateDesc"
 * @returns {Array} a new, sorted array
 */
function getSortedExpenses(expenseArray, sortBy = "dateDesc") {
  // Lecture 11-12: slice() to copy before sort() mutates
  const copy = expenseArray.slice();

  copy.sort((a, b) => {
    if (sortBy === "amountAsc") return a.amount - b.amount;
    if (sortBy === "amountDesc") return b.amount - a.amount;
    if (sortBy === "dateAsc") return new Date(a.date) - new Date(b.date);
    // default: dateDesc
    return new Date(b.date) - new Date(a.date);
  });

  return copy;
}

/**
 * Scans expenses sorted by date (newest first) down to a cutoff date.
 * Stops processing immediately once expenses are older than the cutoff date.
 * @param {string} cutoffDateStr - e.g. "2026-08-01"
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {Array} expenses on or after cutoffDateStr
 */
function getExpensesSinceDate(cutoffDateStr, period = selectedPeriod) {
  const periodExpenses = getExpensesForPeriod(period);
  const sorted = getSortedExpenses(periodExpenses, "dateDesc");
  const result = [];

  // Use a classic for loop because we need to break early once the expenses pass the cutoff date.
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].date < cutoffDateStr) {
      break;
    }
    result.push(sorted[i]);
  }

  return result;
}


/* =========================================================
   CALCULATIONS (Lecture 13-14: reduce, map, sort)
   ========================================================= */

/**
 * Sums the `amount` field across an array of expenses.
 * @param {Array} expenseArray
 * @returns {number}
 */
function calculateTotal(expenseArray) {
  return expenseArray.reduce((total, expense) => total + (Number(expense.amount) || 0), 0);
}

/**
 * Lecture 7-8: this is a function EXPRESSION — a function created and
 * assigned to a const, as opposed to the function DECLARATIONS (like
 * calculateTotal above) used everywhere else in this file. Expressions
 * aren't hoisted, so this must be defined before anything calls it.
 * @param {Array} expenseArray
 * @returns {number}
 */
const calculateAverageExpense = function (expenseArray) {
  if (expenseArray.length === 0) return 0;
  return calculateTotal(expenseArray) / expenseArray.length;
};

/**
 * Groups total spend by category.
 * @param {Array} expenseArray
 * @returns {Object} e.g. { Food: 5500, Travel: 2500 }
 */
function getCategoryTotals(expenseArray) {
  // Lecture 13-14: reduce() building up an object accumulator
  return expenseArray.reduce((totals, expense) => {
    const current = totals[expense.category] || 0;
    totals[expense.category] = current + (Number(expense.amount) || 0);
    return totals;
  }, {});
}

/**
 * Finds the single largest expense.
 * @param {Array} expenseArray
 * @returns {Object|null}
 */
function getHighestExpense(expenseArray) {
  if (expenseArray.length === 0) return null;

  // Lecture 13-14: reduce() to find a max without a manual loop
  return expenseArray.reduce((highest, current) =>
    (Number(current.amount) || 0) > (Number(highest.amount) || 0) ? current : highest
  );
}

/**
 * Escapes a single value according to standard CSV formatting rules and
 * neutralizes spreadsheet formula injection (=, +, -, @, \t, \r) for string values.
 * Handles commas, double quotes, and line breaks.
 * @param {*} val
 * @returns {string}
 */
function escapeCsvValue(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  if (typeof val === "string" && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Exports expenses for the specified period to a downloadable CSV file.
 * Uses existing period filtering function getExpensesForPeriod().
 * @param {string} [period] - defaults to selectedPeriod
 */
function exportExpensesToCsv(period = selectedPeriod) {
  const periodExpenses = getExpensesForPeriod(period);

  if (!periodExpenses || periodExpenses.length === 0) {
    alert(`No expenses recorded for ${formatPeriodLabel(period)} to export.`);
    return;
  }

  const headers = ["Date", "Description", "Category", "Payment Mode", "Amount"];
  const 
