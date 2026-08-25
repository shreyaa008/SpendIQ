/* =========================================================
   UI.JS — UI AND DASHBOARD
   ========================================================= */

/* =========================================================
   1 — UI SETUP, HELPERS AND NAVIGATION
   ========================================================= */

/* ---------- DOM Selection ---------- */

const STORAGE_KEY_THEME = "smartExpenseManager_theme";
const SESSION_KEY_LAST_CATEGORY = "smartExpenseManager_lastCategory";

const navButtons = document.querySelectorAll(".nav-btn");
const themeToggle = document.getElementById("themeToggle");

const expenseForm = document.getElementById("expense-form");
const editIdInput = document.getElementById("edit-id");
const amountInput = document.getElementById("input-amount");
const categorySelect = document.getElementById("input-category");
const descriptionInput = document.getElementById("input-description");
const paymentSelect = document.getElementById("input-payment");
const dateInput = document.getElementById("input-date");
const formError = document.getElementById("form-error");
const formSubmitBtn = document.getElementById("form-submit-btn");
const formCancelBtn = document.getElementById("form-cancel-btn");

const incomeForm = document.getElementById("income-form");
const incomeAmountInput = document.getElementById("input-income-amount");
const incomeErrorEl = document.getElementById("income-error");

const searchInput = document.getElementById("search-input");
const searchHintEl = document.getElementById("search-hint");
const filterCategorySelect = document.getElementById("filter-category");
const sortSelect = document.getElementById("sort-select");
const exportCsvBtn = document.getElementById("export-csv-btn");
const expenseListEl = document.getElementById("expense-list");

const dashboardIncomeEl = document.getElementById("dashboard-income");
const dashboardExpensesEl = document.getElementById("dashboard-expenses");
const dashboardBalanceEl = document.getElementById("dashboard-balance");
const dashboardSavingsEl = document.getElementById("dashboard-savings");
const dashboardBreakdownEl = document.getElementById("dashboard-category-breakdown");
const dashboardHighestEl = document.getElementById("dashboard-highest");
const dashboardAverageEl = document.getElementById("dashboard-average");
const dashboardRecentEl = document.getElementById("dashboard-recent");

const undoToastEl = document.getElementById("undo-toast");
const undoBtn = document.getElementById("undo-btn");

const prevPeriodBtn = document.getElementById("prev-period-btn");
const nextPeriodBtn = document.getElementById("next-period-btn");
const todayPeriodBtn = document.getElementById("today-period-btn");
const currentPeriodLabel = document.getElementById("current-period-label");

/* ---------- Formatting Helpers ---------- */

function formatCurrency(amount) {
  const num = Number(amount);

  if (!Number.isFinite(num)) {
    return "₹0.00";
  }

  const isNegative = num < 0;
  const formatted = Math.abs(num).toFixed(2);

  return isNegative ? `-₹${formatted}` : `₹${formatted}`;
}

function formatDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") {
    return "Invalid date";
  }

  const parts = dateStr.split("-").map(Number);

  if (parts.length !== 3 || parts.some(isNaN)) {
    return "Invalid date";
  }

  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);

  if (isNaN(date.getTime())) {
    return "Invalid date";
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

/* ---------- Dropdown Setup ---------- */

function populateSelectOptions(selectEl, values, includeAllOption = false) {
  if (!selectEl) return;

  selectEl.innerHTML = "";

  if (includeAllOption) {
    const allOption = document.createElement("option");
    allOption.value = "All";
    allOption.textContent = "All categories";
    selectEl.appendChild(allOption);
  }

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  }
}

function initDropdowns() {
  populateSelectOptions(categorySelect, CATEGORIES);
  populateSelectOptions(paymentSelect, PAYMENT_MODES);
  populateSelectOptions(filterCategorySelect, CATEGORIES, true);
  populateSelectOptions(
    document.getElementById("input-budget-category"),
    CATEGORIES
  );
}

/* ---------- Navigation ---------- */

function switchSection(targetSectionId) {
  const currentActiveSection = document.querySelector(".section.is-active");

  if (currentActiveSection) {
    currentActiveSection.classList.remove("is-active");
  }

  const targetSection = document.getElementById(targetSectionId);

  if (targetSection) {
    targetSection.classList.add("is-active");
  }

  navButtons.forEach((button) => {
    button.classList.toggle(
      "is-active",
      button.dataset.section === targetSectionId
    );
  });

  if (targetSectionId === "section-dashboard") {
    renderDashboard();
  }

  if (targetSectionId === "section-settings") {
    if (typeof renderBudgets === "function") {
      renderBudgets(selectedPeriod);
    }

    if (typeof checkCurrencyApiOnce === "function") {
      checkCurrencyApiOnce();
    }
  }
}

function initNav() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      switchSection(button.dataset.section);
    });
  });
}

/* ---------- Form Validation ---------- */

function showFormError(message) {
  formError.textContent = message;
  formError.classList.remove("is-hidden");
}

function clearFormError() {
  formError.textContent = "";
  formError.classList.add("is-hidden");
}

function validateExpenseForm() {
  const amount = Number(amountInput.value);

  if (!amountInput.value || isNaN(amount) || amount <= 0) {
    return "Please enter an amount greater than 0.";
  }

  if (!categorySelect.value) {
    return "Please choose a category.";
  }

  if (!paymentSelect.value) {
    return "Please choose a payment mode.";
  }

  if (!dateInput.value || isNaN(new Date(dateInput.value).getTime())) {
    return "Please choose a valid date.";
  }

  return null;
}

/* =========================================================
   2 — EXPENSE LIST, DASHBOARD AND UNDO
   ========================================================= */

/* ---------- Expense List Rendering ---------- */

function createExpenseRow(expense) {
  const row = document.createElement("div");
  row.className = "ledger-row";
  row.dataset.id = expense.id;

  const spine = document.createElement("div");
  spine.className = "ledger-spine";

  const main = document.createElement("div");
  main.className = "ledger-main";

  const description = document.createElement("span");
  description.className = "ledger-desc";
  description.textContent = expense.description || "(no description)";

  const meta = document.createElement("span");
  meta.className = "ledger-meta";

  const tag = document.createElement("span");
  tag.className = "ledger-tag";
  tag.textContent = expense.category;

  const dateSpan = document.createElement("span");
  dateSpan.textContent = formatDate(expense.date);

  const paymentSpan = document.createElement("span");
  paymentSpan.textContent = expense.paymentMode;

  meta.appendChild(tag);
  meta.appendChild(dateSpan);
  meta.appendChild(paymentSpan);

  main.appendChild(description);
  main.appendChild(meta);

  const amountSpan = document.createElement("span");
  amountSpan.className = "ledger-amount";
  amountSpan.textContent = formatCurrency(expense.amount);

  const actions = document.createElement("div");
  actions.className = "ledger-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn edit-btn";
  editBtn.title = "Edit";
  editBtn.setAttribute("aria-label", "Edit");
  editBtn.innerHTML = "&#9998;";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "icon-btn danger delete-btn";
  deleteBtn.title = "Delete";
  deleteBtn.setAttribute("aria-label", "Delete");
  deleteBtn.innerHTML = "&#10005;";

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  row.appendChild(spine);
  row.appendChild(main);
  row.appendChild(amountSpan);
  row.appendChild(actions);

  return row;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function renderExpenseList(
  expenseArray,
  hasActiveFilter = false,
  searchTerm = ""
) {
  expenseListEl.innerHTML = "";

  if (expenseArray.length === 0) {
    expenseListEl.innerHTML = hasActiveFilter
      ? `<div class="empty-state">No expenses found${
          searchTerm ? ` for "${escapeHtml(searchTerm)}"` : ""
        }. Try a different search or filter.</div>`
      : `<div class="empty-state">No expenses yet — add your first one above.</div>`;

    return;
  }

  expenseArray.forEach((expense) => {
    expenseListEl.appendChild(createExpenseRow(expense));
  });
}

function refreshExpenseList() {
  const category = filterCategorySelect.value;
  const searchTerm = searchInput.value;
  const sortBy = sortSelect.value;
  const hasActiveFilter = Boolean(searchTerm.trim()) || category !== "All";

  const filtered = getFilteredExpenses(
    category,
    searchTerm,
    selectedPeriod
  );

  const sorted = getSortedExpenses(filtered, sortBy);

  renderExpenseList(sorted, hasActiveFilter, searchTerm.trim());
}

/* ---------- Period Switcher ---------- */

function updatePeriodSwitcherUI() {
  if (!currentPeriodLabel || !todayPeriodBtn) return;

  currentPeriodLabel.textContent = formatPeriodLabel(selectedPeriod);

  const currentPeriod = getCurrentPeriodKey();

  if (selectedPeriod === currentPeriod) {
    todayPeriodBtn.classList.add("is-hidden");
  } else {
    todayPeriodBtn.classList.remove("is-hidden");
  }
}

function getLocalDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function updateDefaultDateInput() {
  if (editIdInput.value) return;

  const currentPeriod = getCurrentPeriodKey();

  if (selectedPeriod === currentPeriod) {
    dateInput.value = getLocalDateInputValue();
  } else {
    dateInput.value = `${selectedPeriod}-01`;
  }
}

function handlePrevPeriod() {
  setSelectedPeriod(getShiftedPeriodKey(selectedPeriod, -1));
  refreshAll();
}

function handleNextPeriod() {
  setSelectedPeriod(getShiftedPeriodKey(selectedPeriod, 1));
  refreshAll();
}

function handleTodayPeriod() {
  setSelectedPeriod(getCurrentPeriodKey());
  refreshAll();
}

/* ---------- Dashboard Rendering ---------- */

function renderDashboard() {
  const periodExpenses = getExpensesForPeriod(selectedPeriod);
  const periodIncome = getMonthlyIncome(selectedPeriod);
  const totalExpenses = calculateTotal(periodExpenses);
  const remaining = periodIncome - totalExpenses;

  dashboardIncomeEl.textContent = formatCurrency(periodIncome);
  dashboardExpensesEl.textContent = formatCurrency(totalExpenses);
  dashboardBalanceEl.textContent = formatCurrency(remaining);

  if (periodIncome > 0) {
    const savingsRate = (remaining / periodIncome) * 100;
    dashboardSavingsEl.textContent = `${savingsRate.toFixed(1)}%`;
  } else {
    dashboardSavingsEl.textContent = "N/A";
  }

  renderCategoryBreakdown(periodExpenses);
  renderHighestExpense(periodExpenses);
  renderRecentTransactions(periodExpenses);

  const average = calculateAverageExpense(periodExpenses);
  dashboardAverageEl.textContent =
    `Average expense: ${formatCurrency(average)}`;
}

function renderCategoryBreakdown(
  periodExpenses = getExpensesForPeriod(selectedPeriod)
) {
  const totals = getCategoryTotals(periodExpenses);
  const totalExpenses = calculateTotal(periodExpenses);

  dashboardBreakdownEl.innerHTML = "";

  const rows = Object.entries(totals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  if (rows.length === 0) {
    dashboardBreakdownEl.innerHTML =
      `<div class="empty-state">No spending recorded for ${
        formatPeriodLabel(selectedPeriod)
      }.</div>`;

    return;
  }

  rows.forEach(({ category, amount }) => {
    const percent =
      totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;

    const row = document.createElement("div");
    row.className = "breakdown-row";

    const head = document.createElement("div");
    head.className = "breakdown-head";

    const categorySpan = document.createElement("span");
    categorySpan.className = "breakdown-cat";
    categorySpan.textContent = category;

    const amountSpan = document.createElement("span");
    amountSpan.className = "breakdown-amt";
    amountSpan.textContent = formatCurrency(amount);

    head.appendChild(categorySpan);
    head.appendChild(amountSpan);

    const track = document.createElement("div");
    track.className = "breakdown-track";

    const fill = document.createElement("div");
    fill.className = "breakdown-fill";
    fill.style.width = `${percent.toFixed(1)}%`;

    track.appendChild(fill);
    row.appendChild(head);
    row.appendChild(track);

    dashboardBreakdownEl.appendChild(row);
  });
}

function renderHighestExpense(
  periodExpenses = getExpensesForPeriod(selectedPeriod)
) {
  const highest = getHighestExpense(periodExpenses);

  if (!highest) {
    dashboardHighestEl.innerHTML =
      `<div class="empty-state">Nothing logged for ${
        formatPeriodLabel(selectedPeriod)
      }.</div>`;

    return;
  }

  dashboardHighestEl.innerHTML = "";

  const description = document.createElement("div");
  description.className = "h-desc";
  description.textContent = highest.description || "(no description)";

  const meta = document.createElement("div");
  meta.className = "h-meta";
  meta.textContent = `${highest.category} · ${formatDate(highest.date)}`;

  const amount = document.createElement("div");
  amount.className = "h-amt";
  amount.textContent = formatCurrency(highest.amount);

  dashboardHighestEl.appendChild(description);
  dashboardHighestEl.appendChild(meta);
  dashboardHighestEl.appendChild(amount);
}

function renderRecentTransactions(
  periodExpenses = getExpensesForPeriod(selectedPeriod)
) {
  const recent = getSortedExpenses(periodExpenses, "dateDesc").slice(0, 5);

  dashboardRecentEl.innerHTML = "";

  if (recent.length === 0) {
    dashboardRecentEl.innerHTML =
      `<div class="empty-state">No recent transactions for ${
        formatPeriodLabel(selectedPeriod)
      }.</div>`;

    return;
  }

  recent.forEach((expense) => {
    const row = document.createElement("div");
    row.className = "recent-row";

    const description = document.createElement("span");
    description.textContent =
      `${expense.description || expense.category} · ${formatDate(expense.date)}`;

    const amount = document.createElement("span");
    amount.className = "recent-amt";
    amount.textContent = formatCurrency(expense.amount);

    row.appendChild(description);
    row.appendChild(amount);

    dashboardRecentEl.appendChild(row);
  });
}

/* ---------- Shared Refresh ---------- */

function refreshAll() {
  updatePeriodSwitcherUI();
  updateDefaultDateInput();
  refreshExpenseList();
  renderDashboard();

  if (typeof renderBudgets === "function") {
    renderBudgets(selectedPeriod);
  }

  if (incomeAmountInput) {
    incomeAmountInput.value = getMonthlyIncome(selectedPeriod) || "";
  }
}

/* ---------- Undo Toast ---------- */

let undoToastTimer = null;

function showUndoToast() {
  undoToastEl.classList.remove("is-hidden");

  clearTimeout(undoToastTimer);

  undoToastTimer = setTimeout(() => {
    hideUndoToast();
  }, 5000);
}

function hideUndoToast() {
  undoToastEl.classList.add("is-hidden");
  clearTimeout(undoToastTimer);
}

function handleUndoClick(event) {
  const toast = event.target.closest("#undo-toast");
  const restoredExpense = undoLastDelete();

  if (!restoredExpense) {
    if (toast) hideUndoToast();
    return;
  }

  refreshAll();

  if (toast) hideUndoToast();
}

/* =========================================================
   3 — FORM EVENTS AND INITIALIZATION
   ========================================================= */

/* ---------- Expense Form Events ---------- */

function resetExpenseForm() {
  expenseForm.reset();
  editIdInput.value = "";
  formSubmitBtn.textContent = "Add expense";
  formCancelBtn.classList.add("is-hidden");

  clearFormError();
  updateDefaultDateInput();
}

function enterEditMode(expense) {
  editIdInput.value = expense.id;
  amountInput.value = expense.amount;
  categorySelect.value = expense.category;
  descriptionInput.value = expense.description;
  paymentSelect.value = expense.paymentMode;
  dateInput.value = expense.date;

  formSubmitBtn.textContent = "Save changes";
  formCancelBtn.classList.remove("is-hidden");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function handleExpenseFormSubmit(event) {
  event.preventDefault();

  const errorMessage = validateExpenseForm();

  if (errorMessage) {
    showFormError(errorMessage);
    return;
  }

  clearFormError();

  const expenseData = {
    amount: amountInput.value,
    category: categorySelect.value,
    description: descriptionInput.value,
    paymentMode: paymentSelect.value,
    date: dateInput.value
  };

  const targetPeriod = getPeriodKey(expenseData.date);

  if (targetPeriod && targetPeriod !== selectedPeriod) {
    setSelectedPeriod(targetPeriod);
  }

  const editingId = editIdInput.value;

  const savedExpense = editingId
    ? editExpense(Number(editingId), expenseData)
    : addExpense(expenseData);

  if (!savedExpense) {
    showFormError(
      "Something went wrong saving that expense. Please check the values and try again."
    );
    return;
  }

  resetExpenseForm();
  refreshAll();
}

function handleExpenseListClick(event) {
  const row = event.target.closest(".ledger-row");

  if (!row) return;

  const id = Number(row.dataset.id);

  if (event.target.classList.contains("delete-btn")) {
    const wasDeleted = deleteExpense(id);

    if (wasDeleted) {
      refreshAll();
      showUndoToast();
    }

    return;
  }

  if (event.target.classList.contains("edit-btn")) {
    const expense = getExpenseById(id);

    if (expense) {
      enterEditMode(expense);
    }
  }
}

function handleCancelEdit() {
  resetExpenseForm();
}

/* ---------- Income Form ---------- */

function handleIncomeFormSubmit(event) {
  event.preventDefault();

  const amount = Number(incomeAmountInput.value);

  if (!incomeAmountInput.value || isNaN(amount) || amount < 0) {
    incomeErrorEl.textContent =
      "Please enter an income amount of 0 or more.";
    incomeErrorEl.classList.remove("is-hidden");
    return;
  }

  incomeErrorEl.classList.add("is-hidden");
  setMonthlyIncome(amount, selectedPeriod);
  refreshAll();
}

/* ---------- Search and Filter ---------- */

let searchDebounceTimer = null;

function handleSearchInput() {
  clearTimeout(searchDebounceTimer);

  searchDebounceTimer = setTimeout(() => {
    handleFilterOrSortChange();
  }, 200);
}

function handleSearchKeyup() {
  const hasText = searchInput.value.trim() !== "";

  if (searchHintEl) {
    searchHintEl.classList.toggle("is-hidden", !hasText);
  }
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape") return;

  if (editIdInput && editIdInput.value) {
    handleCancelEdit();
  }

  if (
    searchInput &&
    (document.activeElement === searchInput || searchInput.value)
  ) {
    searchInput.value = "";
    handleFilterOrSortChange();

    if (searchHintEl) {
      searchHintEl.classList.add("is-hidden");
    }
  }
}

function handleFilterOrSortChange() {
  sessionStorage.setItem(
    SESSION_KEY_LAST_CATEGORY,
    filterCategorySelect.value
  );

  refreshExpenseList();
}

function restoreLastCategoryFromSession() {
  const savedCategory = sessionStorage.getItem(
    SESSION_KEY_LAST_CATEGORY
  );

  if (
    savedCategory &&
    (savedCategory === "All" || CATEGORIES.includes(savedCategory))
  ) {
    filterCategorySelect.value = savedCategory;
  }
}

/* ---------- Theme Settings ---------- */

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.dataset.theme = "dark";
    document.body.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
    delete document.body.dataset.theme;
  }

  if (themeToggle) {
    themeToggle.innerHTML = theme === "dark"
      ? '<span class="theme-icon">☀️</span> <span class="theme-label">Light Mode</span>'
      : '<span class="theme-icon">🌙</span> <span class="theme-label">Dark Mode</span>';
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEY_THEME);

  applyTheme(savedTheme === "dark" ? "dark" : "light");

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const isDark = document.body.dataset.theme === "dark";
      const newTheme = isDark ? "light" : "dark";

      applyTheme(newTheme);
      localStorage.setItem(STORAGE_KEY_THEME, newTheme);
    });
  }
}

/* ---------- Storage Synchronization ---------- */

function handleStorageEvent(event) {
  const relevantKeys = [
    STORAGE_KEY_EXPENSES,
    STORAGE_KEY_INCOME,
    STORAGE_KEY_SELECTED_PERIOD,
    STORAGE_KEY_BUDGETS,
    STORAGE_KEY_THRESHOLD,
    STORAGE_KEY_THEME
  ];

  if (!event.key || !relevantKeys.includes(event.key)) return;

  loadExpenses();
  loadIncome();

  if (typeof loadSelectedPeriod === "function") {
    loadSelectedPeriod();
  }

  if (typeof loadBudgets === "function") {
    loadBudgets();
  }

  if (typeof loadWarningThreshold === "function") {
    loadWarningThreshold();
  }

  refreshAll();
}

/* ---------- Initialization ---------- */

function initUI() {
  initTheme();
  loadSelectedPeriod();
  initDropdowns();
  initNav();
  restoreLastCategoryFromSession();

  updateDefaultDateInput();

  if (prevPeriodBtn) {
    prevPeriodBtn.addEventListener("click", handlePrevPeriod);
  }

  if (nextPeriodBtn) {
    nextPeriodBtn.addEventListener("click", handleNextPeriod);
  }

  if (todayPeriodBtn) {
    todayPeriodBtn.addEventListener("click", handleTodayPeriod);
  }

  expenseForm.addEventListener("submit", handleExpenseFormSubmit);
  formCancelBtn.addEventListener("click", handleCancelEdit);
  expenseListEl.addEventListener("click", handleExpenseListClick);
  undoBtn.addEventListener("click", handleUndoClick);
  incomeForm.addEventListener("submit", handleIncomeFormSubmit);

  incomeAmountInput.value = getMonthlyIncome(selectedPeriod) || "";

  searchInput.addEventListener("input", handleSearchInput);
  searchInput.addEventListener("keyup", handleSearchKeyup);
  document.addEventListener("keydown", handleGlobalKeydown);
  filterCategorySelect.addEventListener("change", handleFilterOrSortChange);
  sortSelect.addEventListener("change", handleFilterOrSortChange);

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      exportExpensesToCsv(selectedPeriod);
    });
  }

  window.addEventListener("storage", handleStorageEvent);

  refreshAll();
}

document.addEventListener("DOMContentLoaded", () => {
  loadExpenses();
  loadIncome();
  initUI();
});