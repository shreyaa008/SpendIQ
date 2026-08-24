/* =========================================================
   EXPENSES.JS  —  Member A: Expense Engine
   Owns: the shared `expenses` array, CRUD operations,
         LocalStorage persistence, filtering/sorting/totals.

   TABLE OF CONTENTS
     1. Shared constants + shared state
     2. Persistence (expenses + income)      — LocalStorage
     3. ID generation                        — while loop
     4. CRUD operations                      — push/splice/pop/shift/unshift
     5. Filtering / sorting                  — filter, sort, slice
     6. Calculations                         — reduce, function expression
   ========================================================= */

/* ---------- Lecture 15-16: shared constants (objects/arrays) ---------- */
// Every other file (ui.js, budget.js) reads these instead of hardcoding
// category/payment strings, so "Food" never becomes "food" somewhere else.
const CATEGORIES = ["Food", "Shopping", "Travel", "Bills", "Entertainment", "Health", "Other"];
const PAYMENT_MODES = ["UPI", "Cash", "Card", "Net Banking"];

/* ---------- Lecture 23: LocalStorage keys ---------- */
const STORAGE_KEY_EXPENSES = "smartExpenseManager_expenses";
const STORAGE_KEY_INCOME = "smartExpenseManager_income";

/* ---------- Lecture 1-2 / 9-10: the shared array ----------
   `let` because we reassign it wholesale on load; every other
   file just reads/reacts to this same array, never redeclares it. */
let expenses = [];

/* ---------- Lecture 11-12: "recently deleted" stack, powers Undo ----------
   Kept separate from `expenses` on purpose — it's a small, temporary
   holding area, not persisted data. */
const MAX_RECENTLY_DELETED = 5;
let recentlyDeleted = [];

/* Monthly income used for the dashboard's "remaining balance" and
   "savings %" calculations. Starts at 0 and is set by the user in
   Settings — see loadIncome()/setMonthlyIncome() below. */
let monthlyIncome = 0;

/* ---------- Lecture 9-10: scope ----------
   Variables declared with let/const *inside* a function — like `newId`
   in generateUniqueId() below, or `index` in editExpense() — only exist
   inside that function call (block/function scope). They vanish once the
   function returns. `expenses`, `recentlyDeleted`, and `monthlyIncome`
   above are declared at the top level of this file, so they're accessible
   from every function in every file loaded after this one — that's what
   lets ui.js/budget.js/currency.js read and mutate them directly. */


/* =========================================================
   PERSISTENCE  (Lecture 23, 15-16: JSON.stringify/parse)
   ========================================================= */

/**
 * Loads expenses from LocalStorage into the shared `expenses` array.
 * Call once when the app starts.
 */
function loadExpenses() {
  const raw = localStorage.getItem(STORAGE_KEY_EXPENSES);
  // Lecture 3-4: ternary/condition — fall back to an empty array if nothing saved yet
  expenses = raw ? JSON.parse(raw) : [];
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
 * Call once when the app starts. Defaults to 0 if never set.
 */
function loadIncome() {
  const raw = localStorage.getItem(STORAGE_KEY_INCOME);
  monthlyIncome = raw ? Number(raw) : 0;
}

/**
 * Sets and persists the monthly income.
 * @param {number} amount
 */
function setMonthlyIncome(amount) {
  monthlyIncome = Number(amount);
  localStorage.setItem(STORAGE_KEY_INCOME, String(monthlyIncome));
}


/* =========================================================
   ID GENERATION  (Lecture 5-6: while loop)
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
   CRUD OPERATIONS  (Lecture 7-8: functions, 11-12: array methods)
   ========================================================= */

/**
 * Adds a new expense to the array.
 * @param {Object} expenseData - { amount, category, description, paymentMode, date }
 * @returns {Object} the newly created expense (with generated id)
 */
function addExpense(expenseData) {
  // Lecture 24: default parameter — description defaults to empty string if omitted
  const { amount, category, description = "", paymentMode, date } = expenseData;

  const newExpense = {
    id: generateUniqueId(),
    amount: Number(amount),  // Lecture 3-4: type conversion, form values arrive as strings
    category,
    description,
    paymentMode,
    date
  };

  expenses.push(newExpense);   // Lecture 11-12: push()
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

  const restored = recentlyDeleted.pop();  // Lecture 11-12: pop() — most recent deletion
  expenses.unshift(restored);              // Lecture 11-12: unshift() — put it back at the front
  saveExpenses();
  return restored;
}

/**
 * Updates fields on an existing expense.
 * @param {number} id
 * @param {Object} updatedFields - partial expense object, e.g. { amount: 600 }
 * @returns {Object|null} the updated expense, or null if not found
 */
function editExpense(id, updatedFields) {
  const index = expenses.findIndex((expense) => expense.id === id);
  if (index === -1) return null;

  // Lecture 24: spread operator — merge old expense with only the changed fields
  const merged = { ...expenses[index], ...updatedFields };

  // Re-apply type conversion in case amount was edited as a string
  merged.amount = Number(merged.amount);

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
   FILTERING / SORTING  (Lecture 13-14: higher-order functions)
   ========================================================= */

/**
 * Returns expenses matching a category and/or search term.
 * @param {string} category - a value from CATEGORIES, or "All"
 * @param {string} searchTerm - matched against description (case-insensitive)
 * @returns {Array} the matching expenses
 */
function getFilteredExpenses(category = "All", searchTerm = "") {
  const term = searchTerm.trim().toLowerCase();

  return expenses.filter((expense) => {
    const matchesCategory = category === "All" || expense.category === category;
    const matchesSearch = expense.description.toLowerCase().includes(term);
    return matchesCategory && matchesSearch;
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


/* =========================================================
   CALCULATIONS  (Lecture 13-14: reduce, map, sort)
   ========================================================= */

/**
 * Sums the `amount` field across an array of expenses.
 * @param {Array} expenseArray
 * @returns {number}
 */
function calculateTotal(expenseArray) {
  return expenseArray.reduce((total, expense) => total + expense.amount, 0);
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
    totals[expense.category] = current + expense.amount;
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
    current.amount > highest.amount ? current : highest
  );
}
