/* =========================================================
   UI SETUP, HELPERS AND NAVIGATION
   ========================================================= */

const navButtons = document.querySelectorAll(".nav-btn");
const sections = document.querySelectorAll(".section");

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
const filterCategorySelect = document.getElementById("filter-category");
const sortSelect = document.getElementById("sort-select");
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

function formatCurrency(amount) {
  const value = Number(amount);
  return Number.isFinite(value) ? `₹${value.toFixed(2)}` : "₹0.00";
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? "Invalid date"
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function populateSelectOptions(selectEl, values, includeAllOption = false) {
  if (!selectEl) return;

  selectEl.innerHTML = "";
  if (includeAllOption) {
    const option = document.createElement("option");
    option.value = "All";
    option.textContent = "All categories";
    selectEl.appendChild(option);
  }

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectEl.appendChild(option);
  });
}

function initDropdowns() {
  populateSelectOptions(categorySelect, CATEGORIES);
  populateSelectOptions(paymentSelect, PAYMENT_MODES);
  populateSelectOptions(filterCategorySelect, CATEGORIES, true);
  populateSelectOptions(document.getElementById("input-budget-category"), CATEGORIES);
}

function switchSection(targetSectionId) {
  sections.forEach((section) => {
    section.classList.toggle("is-active", section.id === targetSectionId);
  });
  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === targetSectionId);
  });

  if (targetSectionId === "section-dashboard") renderDashboard();
  if (targetSectionId === "section-settings" && typeof checkCurrencyApiOnce === "function") {
    checkCurrencyApiOnce();
  }
}

function initNav() {
  navButtons.forEach((button) => {
    button.addEventListener("click", () => switchSection(button.dataset.section));
  });
}

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
  if (!amountInput.value || !Number.isFinite(amount) || amount <= 0) {
    return "Please enter an amount greater than 0.";
  }
  if (!categorySelect.value) return "Please choose a category.";
  if (!paymentSelect.value) return "Please choose a payment mode.";
  if (!dateInput.value || Number.isNaN(new Date(`${dateInput.value}T00:00:00`).getTime())) {
    return "Please choose a valid date.";
  }
  return null;
}

/* =========================================================
   2 — EXPENSE LIST, DASHBOARD AND UNDO
   ========================================================= */

function createExpenseRow(expense) {
  const row = document.createElement("div");
  row.className = "ledger-row";
  row.dataset.id = expense.id;
  row.innerHTML = `
    <div class="ledger-spine"></div>
    <div class="ledger-main">
      <span class="ledger-desc"></span>
      <span class="ledger-meta"><span class="ledger-tag"></span><span></span><span></span></span>
    </div>
    <span class="ledger-amount"></span>
    <div class="ledger-actions">
      <button type="button" class="icon-btn edit-btn" aria-label="Edit" title="Edit">&#9998;</button>
      <button type="button" class="icon-btn danger delete-btn" aria-label="Delete" title="Delete">&#10005;</button>
    </div>`;

  row.querySelector(".ledger-desc").textContent = expense.description || "(no description)";
  row.querySelector(".ledger-tag").textContent = expense.category;
  const metaValues = row.querySelectorAll(".ledger-meta > span");
  metaValues[1].textContent = formatDate(expense.date);
  metaValues[2].textContent = expense.paymentMode;
  row.querySelector(".ledger-amount").textContent = formatCurrency(expense.amount);
  return row;
}

function renderExpenseList(expenseArray) {
  expenseListEl.innerHTML = "";
  if (expenseArray.length === 0) {
    expenseListEl.innerHTML = '<div class="empty-state">No expenses yet — add your first one above.</div>';
    return;
  }
  expenseArray.forEach((expense) => expenseListEl.appendChild(createExpenseRow(expense)));
}

function refreshExpenseList() {
  const filtered = getFilteredExpenses(filterCategorySelect.value, searchInput.value);
  renderExpenseList(getSortedExpenses(filtered, sortSelect.value));
}

function renderDashboard() {
  const totalExpenses = calculateTotal(expenses);
  const income = Number(monthlyIncome) || 0;
  const balance = income - totalExpenses;
  const savingsRate = income > 0 ? (balance / income) * 100 : 0;

  dashboardIncomeEl.textContent = formatCurrency(income);
  dashboardExpensesEl.textContent = formatCurrency(totalExpenses);
  dashboardBalanceEl.textContent = formatCurrency(balance);
  dashboardSavingsEl.textContent = income > 0 ? `${savingsRate.toFixed(1)}%` : "N/A";
  dashboardAverageEl.textContent = `Average expense: ${formatCurrency(calculateAverageExpense(expenses))}`;

  renderCategoryBreakdown();
  renderHighestExpense();
  renderRecentTransactions();
}

function renderCategoryBreakdown() {
  const totals = getCategoryTotals(expenses);
  const totalExpenses = calculateTotal(expenses);
  const rows = Object.entries(totals).sort(([, a], [, b]) => b - a);
  dashboardBreakdownEl.innerHTML = "";

  if (rows.length === 0) {
    dashboardBreakdownEl.innerHTML = '<div class="empty-state">No spending recorded yet.</div>';
    return;
  }

  rows.forEach(([category, amount]) => {
    const percent = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `<div class="breakdown-head"><span class="breakdown-cat"></span><span class="breakdown-amt"></span></div><div class="breakdown-track"><div class="breakdown-fill"></div></div>`;
    row.querySelector(".breakdown-cat").textContent = category;
    row.querySelector(".breakdown-amt").textContent = formatCurrency(amount);
    row.querySelector(".breakdown-fill").style.width = `${percent.toFixed(1)}%`;
    dashboardBreakdownEl.appendChild(row);
  });
}

function renderHighestExpense() {
  const highest = getHighestExpense(expenses);
  dashboardHighestEl.innerHTML = "";
  if (!highest) {
    dashboardHighestEl.innerHTML = '<div class="empty-state">Nothing logged yet.</div>';
    return;
  }

  const description = document.createElement("div");
  description.className = "h-desc";
  description.textContent = highest.description || "(no description)";
  const meta = document.createElement("div");
  meta.className = "h-meta";
  meta.textContent = `${highest.category} · ${formatDate(highest.date)}`;
  const amount = document.createElement("div");
  amount.className = "h-amt";
  amount.textContent = formatCurrency(highest.amount);
  dashboardHighestEl.append(description, meta, amount);
}

function renderRecentTransactions() {
  const recent = getSortedExpenses(expenses, "dateDesc").slice(0, 5);
  dashboardRecentEl.innerHTML = "";
  if (recent.length === 0) {
    dashboardRecentEl.innerHTML = '<div class="empty-state">No recent transactions.</div>';
    return;
  }
  recent.forEach((expense) => {
    const row = document.createElement("div");
    row.className = "recent-row";
    const description = document.createElement("span");
    description.textContent = `${expense.description || expense.category} · ${formatDate(expense.date)}`;
    const amount = document.createElement("span");
    amount.className = "recent-amt";
    amount.textContent = formatCurrency(expense.amount);
    row.append(description, amount);
    dashboardRecentEl.appendChild(row);
  });
}

function refreshAll() {
  refreshExpenseList();
  renderDashboard();
}

let undoToastTimer = null;

function showUndoToast() {
  undoToastEl.classList.remove("is-hidden");
  clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(hideUndoToast, 5000);
}

function hideUndoToast() {
  undoToastEl.classList.add("is-hidden");
  clearTimeout(undoToastTimer);
}

function handleUndoClick() {
  if (undoLastDelete()) refreshAll();
  hideUndoToast();
}

/* =========================================================
   3 — FORM EVENTS AND INITIALIZATION
   ========================================================= */

function resetExpenseForm() {
  expenseForm.reset();
  editIdInput.value = "";
  formSubmitBtn.textContent = "Add expense";
  formCancelBtn.classList.add("is-hidden");
  clearFormError();
  dateInput.value = new Date().toISOString().slice(0, 10);
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
}

function handleExpenseFormSubmit(event) {
  event.preventDefault();
  const error = validateExpenseForm();
  if (error) return showFormError(error);
  clearFormError();

  const expenseData = {
    amount: amountInput.value,
    category: categorySelect.value,
    description: descriptionInput.value.trim(),
    paymentMode: paymentSelect.value,
    date: dateInput.value,
  };
  const editId = Number(editIdInput.value);
  if (editIdInput.value) editExpense(editId, expenseData);
  else addExpense(expenseData);

  resetExpenseForm();
  refreshAll();
}

function handleExpenseListClick(event) {
  const row = event.target.closest(".ledger-row");
  if (!row) return;
  const id = Number(row.dataset.id);
  if (event.target.closest(".delete-btn") && deleteExpense(id)) {
    refreshAll();
    showUndoToast();
  }
  if (event.target.closest(".edit-btn")) {
    const expense = getExpenseById(id);
    if (expense) enterEditMode(expense);
  }
}

function handleIncomeFormSubmit(event) {
  event.preventDefault();
  const amount = Number(incomeAmountInput.value);
  if (!incomeAmountInput.value || !Number.isFinite(amount) || amount < 0) {
    incomeErrorEl.textContent = "Please enter an income amount of 0 or more.";
    incomeErrorEl.classList.remove("is-hidden");
    return;
  }
  incomeErrorEl.classList.add("is-hidden");
  setMonthlyIncome(amount);
  renderDashboard();
}

function initUI() {
  initDropdowns();
  initNav();
  resetExpenseForm();
  incomeAmountInput.value = Number(monthlyIncome) || "";

  expenseForm.addEventListener("submit", handleExpenseFormSubmit);
  formCancelBtn.addEventListener("click", resetExpenseForm);
  expenseListEl.addEventListener("click", handleExpenseListClick);
  undoBtn.addEventListener("click", handleUndoClick);
  incomeForm.addEventListener("submit", handleIncomeFormSubmit);
  searchInput.addEventListener("input", refreshExpenseList);
  filterCategorySelect.addEventListener("change", refreshExpenseList);
  sortSelect.addEventListener("change", refreshExpenseList);
  refreshAll();
}

document.addEventListener("DOMContentLoaded", () => {
  loadExpenses();
  loadIncome();
  initUI();
});
