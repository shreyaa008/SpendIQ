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

/* =========================================================
   Part 2: BUDGET OPERATIONS
   ========================================================= */
/**
 * Returns the budget object for a given period.
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {Object} e.g. { Food: 6000, Travel: 3000 }
 */
function getBudgetsForPeriod(period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;
  const periodBudgets = budgets[targetPeriod];

  // Return an empty object when no budgets exist for this month.
  return periodBudgets &&
    typeof periodBudgets === "object" &&
    !Array.isArray(periodBudgets)
    ? periodBudgets
    : {};
}

/**
 * Sets or updates a monthly budget for one category.
 * @param {string} category
 * @param {number} amount
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {boolean} true when the budget is saved
 */
function setBudget(category, amount, period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;

  // Check that the selected month is valid.
  if (typeof isValidPeriodKey === "function" && !isValidPeriodKey(targetPeriod)) {
    return false;
  }

  // Only categories listed in CATEGORIES can have a budget.
  if (typeof category !== "string" || !CATEGORIES.includes(category)) {
    return false;
  }

  // Do not accept empty values, booleans, or invalid amounts.
  if (
    amount === null ||
    typeof amount === "boolean" ||
    (typeof amount === "string" && amount.trim() === "")
  ) {
    return false;
  }

  const numAmount = Number(amount);

  // Budget amount must be a positive number.
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return false;
  }

  // Create a new object for the month if it does not exist yet.
  if (
    !budgets[targetPeriod] ||
    typeof budgets[targetPeriod] !== "object" ||
    Array.isArray(budgets[targetPeriod])
  ) {
    budgets[targetPeriod] = {};
  }

  budgets[targetPeriod][category] = numAmount;
  saveBudgets();

  return true;
}

/**
 * Deletes a category budget from a selected period.
 * @param {string} category
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {boolean} true when a budget was deleted
 */
function deleteBudget(category, period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;
  const periodBudgets = budgets[targetPeriod];

  if (
    periodBudgets &&
    typeof periodBudgets === "object" &&
    !Array.isArray(periodBudgets) &&
    periodBudgets[category] !== undefined
  ) {
    delete periodBudgets[category];

    // Remove the month too if its last budget was deleted.
    if (Object.keys(periodBudgets).length === 0) {
      delete budgets[targetPeriod];
    }

    saveBudgets();
    return true;
  }

  return false;
}

/**
 * Checks whether spending is okay, near the limit, or over budget.
 * @param {string} category
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {{status: string, spent: number, limit: number, remaining: number}}
 */
function checkBudgetStatus(category, period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;
  const periodBudgets = getBudgetsForPeriod(targetPeriod);
  const limit = periodBudgets[category] || 0;

  // Get total spending only for the selected month.
  const periodExpenses = getExpensesForPeriod(targetPeriod);
  const totals = getCategoryTotals(periodExpenses);
  const spent = totals[category] || 0;
  const remaining = limit - spent;

  let status = "ok";

  // if/else decides the budget status.
  if (limit > 0 && spent > limit) {
    status = "exceeded";
  } else if (limit > 0 && spent >= limit * getWarningThresholdRatio()) {
    status = "warning";
  }

  return { status, spent, limit, remaining };
}

/**
 * Returns the budget status for multiple categories.
 * Uses rest parameters and the spread operator.
 * @param {string} period
 * @param {...string} categories
 * @returns {Array}
 */
function getStatusForCategories(period = selectedPeriod, ...categories) {
  return categories.map((category) => ({
    category,
    ...checkBudgetStatus(category, period),
  }));
}

/**
 * Counts how many category budgets were exceeded in a period.
 * @param {string} [period] - defaults to selectedPeriod
 * @returns {number}
 */
function countExceededBudgets(period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;
  const periodBudgets = getBudgetsForPeriod(targetPeriod);
  let exceededCount = 0;

  // for...in loops through categories stored in the object.
  for (const category in periodBudgets) {
    const { status } = checkBudgetStatus(category, targetPeriod);

    if (status === "exceeded") {
      exceededCount++;
    }
  }

  return exceededCount;
}

/* =========================================================
   Part 3: RENDERING
   ========================================================= */

/**
 * Shows all budgets for the selected month on the page.
 * @param {string} [period] - defaults to selectedPeriod
 */
function renderBudgets(period = selectedPeriod) {
  const targetPeriod = period || selectedPeriod;

  // Clear old budget rows before showing updated data.
  budgetListEl.innerHTML = "";

  const periodBudgets = getBudgetsForPeriod(targetPeriod);
  const categoriesWithBudgets = Object.keys(periodBudgets);

  // Show a message if one or more budgets have been exceeded.
  const exceededCount = countExceededBudgets(targetPeriod);

  if (exceededCount > 0) {
    const plural = exceededCount > 1 ? "budgets" : "budget";
    const periodLabel = formatPeriodLabel(targetPeriod);

    budgetSummaryNoteEl.textContent =
      `You have exceeded ${exceededCount} ${plural} in ${periodLabel}.`;

    budgetSummaryNoteEl.classList.remove("is-hidden");
  } else {
    budgetSummaryNoteEl.classList.add("is-hidden");
  }

  // Show an empty-state message when no budgets exist for this month.
  if (categoriesWithBudgets.length === 0) {
    budgetListEl.innerHTML =
      `<div class="empty-state">No budgets set for ${formatPeriodLabel(targetPeriod)}.</div>`;
    return;
  }

  // Spread (...) sends every category as an individual function argument.
  const statuses = getStatusForCategories(
    targetPeriod,
    ...categoriesWithBudgets
  );

  // forEach creates one budget row for every category.
  statuses.forEach(({ category, status, spent, limit, remaining }) => {
    // Keep the progress bar width between 0% and 100%.
    const percent = limit > 0
      ? Math.min((spent / limit) * 100, 100)
      : 0;

    const row = document.createElement("div");

    // Add warning/exceeded styling based on the budget status.
    row.className =
      `budget-row ${status === "warning" ? "is-warning" : ""} ` +
      `${status === "exceeded" ? "is-exceeded" : ""}`;

    row.dataset.category = category;

    let message = "";

    if (status === "warning") {
      message = `Warning: you are about to exceed your ${category} budget.`;
    } else if (status === "exceeded") {
      message =
        `${category} budget exceeded by ${formatCurrency(Math.abs(remaining))}.`;
    }

    // Show remaining amount when the user is still within the budget.
    const subText = remaining >= 0
      ? `${formatCurrency(remaining)} remaining &middot; ${percent.toFixed(0)}% used`
      : `${percent.toFixed(0)}% used`;

    row.innerHTML = `
      <div class="budget-head">
        <span class="budget-cat">${category}</span>

        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="budget-nums">
            ${formatCurrency(spent)} / ${formatCurrency(limit)}
          </span>

          <button
            type="button"
            class="icon-btn danger budget-delete-btn"
            data-category="${category}"
            title="Delete budget"
            aria-label="Delete budget"
          >
            &#10005;
          </button>
        </div>
      </div>

      <div class="budget-track">
        <div class="budget-fill" style="width:${percent.toFixed(1)}%"></div>
      </div>

      <div class="budget-sub">${subText}</div>
      ${message ? `<div class="budget-msg">${message}</div>` : ""}
    `;

    // Add the completed row to the budget list.
    budgetListEl.appendChild(row);
  });
}

/* =========================================================
   Part 4: EVENTS AND INITIALIZATION
   ========================================================= */

/**
 * Shows a confirmation popup before a delete action.
 * @param {string} message
 * @returns {boolean} true if the user clicks OK
 */
function confirmAction(message) {
  return confirm(message);
}

/**
 * Handles clicks on the budget list.
 * Uses event delegation for all delete buttons.
 * @param {Event} event
 */
function handleBudgetListClick(event) {
  const deleteBtn = event.target.closest(".budget-delete-btn");

  // Stop if the clicked element is not a delete button.
  if (!deleteBtn) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const row = deleteBtn.closest(".budget-row");
  const category = deleteBtn.dataset.category || (row && row.dataset.category);

  if (!category) {
    return;
  }

  const periodLabel = formatPeriodLabel(selectedPeriod);
  const confirmMessage = `Delete the ${category} budget for ${periodLabel}?`;

  // Delete only after the user confirms the action.
  if (confirmAction(confirmMessage)) {
    deleteBudget(category, selectedPeriod);
    renderBudgets(selectedPeriod);
  }
}

/**
 * Handles the Set Budget form submission.
 * Validates input, saves the budget, and refreshes the list.
 * @param {Event} event
 */
function handleBudgetFormSubmit(event) {
  event.preventDefault();

  const category = budgetCategorySelect.value;
  const amount = Number(budgetAmountInput.value);

  // Show an error if the amount is empty or zero.
  if (!amount || amount <= 0) {
    budgetErrorEl.textContent =
      "Please enter a budget amount greater than 0.";
    budgetErrorEl.classList.remove("is-hidden");
    return;
  }

  budgetErrorEl.classList.add("is-hidden");

  const success = setBudget(category, amount, selectedPeriod);

  // Show an error if the budget could not be saved.
  if (!success) {
    budgetErrorEl.textContent =
      "Couldn't save that budget. Please check the category and amount.";
    budgetErrorEl.classList.remove("is-hidden");
    return;
  }

  // Reset the form and display the newly saved budget.
  budgetForm.reset();
  renderBudgets(selectedPeriod);
}

/**
 * Handles warning threshold form submission.
 * @param {Event} event
 */
function handleThresholdFormSubmit(event) {
  event.preventDefault();

  const value = Number(thresholdInput.value);

  // Validate and save the threshold percentage.
  if (!setWarningThreshold(value)) {
    if (thresholdErrorEl) {
      thresholdErrorEl.textContent =
        "Please enter a valid warning threshold percentage between 1 and 100.";
      thresholdErrorEl.classList.remove("is-hidden");
    }
    return;
  }

  // Hide any old error and refresh budget warning states.
  if (thresholdErrorEl) {
    thresholdErrorEl.classList.add("is-hidden");
  }

  renderBudgets(selectedPeriod);
}

/**
 * Loads saved data, attaches event listeners, and renders budgets once.
 */
function initBudget() {
  loadBudgets();
  loadWarningThreshold();

  // Attach form listeners only if the elements exist.
  if (budgetForm) {
    budgetForm.addEventListener("submit", handleBudgetFormSubmit);
  }

  if (thresholdForm) {
    thresholdForm.addEventListener("submit", handleThresholdFormSubmit);
  }

  if (budgetListEl) {
    budgetListEl.addEventListener("click", handleBudgetListClick);
  }

  // Display saved budgets when the page opens.
  renderBudgets(selectedPeriod);
}

// Start the budget module after the HTML page has loaded.
document.addEventListener("DOMContentLoaded", initBudget);