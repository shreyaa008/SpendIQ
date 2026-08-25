# Smart Expense Manager

A browser-only personal expense tracker built with HTML, CSS, and vanilla JavaScript — no frameworks, no backend.

## Run it

No build step needed. Either:

- Open `index.html` directly in a browser, **or**
- Serve it locally (recommended, avoids some browsers' fetch/localStorage quirks with `file://`):
  ```
  npx serve .
  ```
  or, with Python:
  ```
  python3 -m http.server 8000
  ```
  then visit `http://localhost:8000`

## Project structure

```
Smart-Expense-Manager/
├── index.html
├── css/
│   └── style.css
└── js/
    ├── expenses.js   ← Member A: data + CRUD + LocalStorage
    ├── ui.js         ← Member B: DOM, forms, dashboard rendering
    ├── budget.js     ← Member C: budgets + warnings
    └── currency.js   ← Member C: Fetch API currency converter
```

Scripts load in this order in `index.html` — `expenses.js` must load first since `ui.js`, `budget.js`, and `currency.js` all depend on the shared `expenses` array and its functions.

## Shared contract (read before editing)

- **Expense object:** `{ id, amount, category, description, paymentMode, date }`
- **Shared constants:** `CATEGORIES`, `PAYMENT_MODES` (defined in `expenses.js`) — always pull from these, never hardcode a category/payment string elsewhere.
- **Shared array:** `expenses` — declared once in `expenses.js`. Other files read it or call functions that mutate it; nothing else redeclares it.
- **LocalStorage keys:** `smartExpenseManager_expenses`, `smartExpenseManager_income`, `smartExpenseManager_selectedPeriod`, `smartExpenseManager_budgets`, `smartExpenseManager_warningThreshold`, `smartExpenseManager_theme`
- **SessionStorage key:** `smartExpenseManager_lastCategory`
- **Refresh pattern:** any function that changes data (add/edit/delete expense, set budget, set income) is followed by a call to `refreshAll()` (defined in `ui.js`), which re-renders the list, dashboard, and budgets together.

See the full function-by-function contract in the project planning docs if you need exact signatures.

## Notes

- **Monthly Income:** Users can set and update their monthly income per period in Settings. The dashboard uses the selected period's income to calculate remaining balance (`income - total expenses`) and savings rate (`(remaining / income) * 100`).
- The currency converter uses the free [open.er-api.com](https://www.exchangerate-api.com/docs/free) endpoint, which needs no API key. If it's ever unreachable, the UI shows an error message rather than breaking.
- All data lives in the browser's LocalStorage — clearing site data/cache will reset expenses, income, budgets, and settings.