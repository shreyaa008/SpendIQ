/* =========================================================
   Part 1: Setup and LocalStorage Persistence

   Owns: shared `budgets` object and warning threshold storage.
   Depends on: CATEGORIES, getCurrentPeriodKey(), and isValidPeriodKey() from other project files.
   ========================================================= */

const STORAGE_KEY_BUDGETS = "smartExpenseManager_budgets";
const STORAGE_KEY_THRESHOLD = "smartExpenseManager_warningThreshold";
const DEFAULT_WARNING_THRESHOLD_PERCENT = 80;

// Stores the user's selected warning percentage.
let warningThresholdPercent = DEFAULT_WARNING_THRESHOLD_PERCENT;

/* Stores budgets by month: { "2026-08": { Food: 6000, Travel: 2500 } } */
let budgets = {};

// Get all elements needed by the budget module.
const budgetForm = document.getElementById("budget-form");
const budgetCategorySelect = document.getElementById("input-budget-category");
const budgetAmountInput = document.getElementById("input-budget-amount");
const budgetErrorEl = document.getElementById("budget-error");
const budgetListEl = document.getElementById("budget-list");
const budgetSummaryNoteEl = document.getElementById("budget-summary-note");
const thresholdForm = document.getElementById("threshold-form");
const thresholdInput = document.getElementById("input-warning-threshold");
const thresholdErrorEl = document.getElementById("threshold-error");


/* =========================================================
   PERSISTENCE — LocalStorage
   ========================================================= */

/**
 * Loads saved budgets from LocalStorage.
 * Also changes old flat budget data into month-wise budget data.
 */
function loadBudgets() {
  const raw = localStorage.getItem(STORAGE_KEY_BUDGETS);

  // If nothing was saved before, start with an empty object.
  if (!raw) {
    budgets = {};
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed);

    // Old format example: { Food: 6000, Travel: 2500 }
    const isOldFormat = keys.length > 0 &&
      keys.some((key) => typeof parsed[key] === "number");

    let candidate;

    if (isOldFormat) {
      // Move old budgets into the current month.
      const currentKey = getCurrentPeriodKey();
      candidate = { [currentKey]: parsed };
    } else if (typeof parsed === "object" && parsed !== null) {
      candidate = parsed;
    } else {
      candidate = {};
    }

    // Clean invalid or corrupted data before using it.
    const cleaned = {};

    // for...in checks every saved month.
    for (const period in candidate) {
      if (typeof isValidPeriodKey === "function" && !isValidPeriodKey(period)) {
        console.error(`Dropped budgets for invalid period key "${period}":`, candidate[period]);
        continue;
      }

      const periodBudgets = candidate[period];

      if (!periodBudgets || typeof periodBudgets !== "object" || Array.isArray(periodBudgets)) {
        continue;
      }

      const cleanedPeriod = {};

      // Check every category and budget amount in the month.
      for (const category in periodBudgets) {
        const amount = Number(periodBudgets[category]);

        if (CATEGORIES.includes(category) && Number.isFinite(amount) && amount >= 0) {
          cleanedPeriod[category] = amount;
        } else {
          console.error(`Dropped invalid budget for "${category}" in ${period}:`, periodBudgets[category]);
        }
      }

      // Save only months that contain at least one valid budget.
      if (Object.keys(cleanedPeriod).length > 0) {
        cleaned[period] = cleanedPeriod;
      }
    }

    budgets = cleaned;

    // Save again if old data was converted to the new format.
    if (isOldFormat) {
      saveBudgets();
    }
  } catch (error) {
    console.error("Failed to parse stored budget data:", error);
    budgets = {};
  }
}

/**
 * Converts the warning percentage into a ratio.
 * Example: 80 becomes 0.8
 */
function getWarningThresholdRatio() {
  return warningThresholdPercent / 100;
}

/* Loads the saved warning percentage from LocalStorage. */

function loadWarningThreshold() {
  const saved = localStorage.getItem(STORAGE_KEY_THRESHOLD);
  const num = Number(saved);

  // Use saved value only if it is between 1 and 100.
  if (saved !== null && Number.isFinite(num) && num >= 1 && num <= 100) {
    warningThresholdPercent = num;
  } else {
    warningThresholdPercent = DEFAULT_WARNING_THRESHOLD_PERCENT;
  }

  // Show the saved value in the threshold input field.
  if (thresholdInput) {
    thresholdInput.value = warningThresholdPercent;
  }
}

/**
 * Validates and saves a new warning threshold percentage.
 * @param {number} percent
 * @returns {boolean} true when the value is valid and saved
 */
function setWarningThreshold(percent) {
  const num = Number(percent);

  // Threshold must be between 1% and 100%.
  if (!Number.isFinite(num) || num < 1 || num > 100) {
    return false;
  }

  warningThresholdPercent = num;
  localStorage.setItem(STORAGE_KEY_THRESHOLD, String(num));

  return true;
}

/**
 * Saves the complete budgets object in LocalStorage.
 * Call this after changing any budget.
 */
function saveBudgets() {
  localStorage.setItem(STORAGE_KEY_BUDGETS, JSON.stringify(budgets));
}