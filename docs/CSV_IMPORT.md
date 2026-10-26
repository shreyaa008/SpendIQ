# CSV import format

**Where:** Transactions → *Import CSV*. Nothing is saved until the last step.

```csv
Date,Description,Merchant,Category,Payment Mode,Amount
2026-10-05,Lunch with team,Green Leaf Cafe,Food,UPI,450.00
05/10/2026,Metro card recharge,,Travel,Cash,500
```
A template is available from the import dialog (`GET /api/import/csv/template`). A file exported from SpendIQ re-imports as-is.

| Column | Required | Rules |
|---|---|---|
| Date | **yes** | `YYYY-MM-DD`, or `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY` (day first). With *auto*, `10/25/2026` is read as month/day because 25 can't be a month; choose *MM/DD/YYYY* to force US order. Real calendar dates only, 2000 or later, at most one year ahead. |
| Amount | **yes** | Positive number. `₹`, `Rs.`, `$`, commas (`1,23,456.50`) accepted. Negative/zero/non-numeric rows are marked invalid (refunds are not supported). |
| Description, Merchant | no | Trimmed, control characters removed, max 200 / 120 chars. A leading `'` added by SpendIQ's own export to defuse spreadsheet formulas is removed. |
| Category | no | Matched case-insensitively. Unknown names are **created** as new categories (shown as a warning in the preview). Blank → `Other`. |
| Payment Mode | no | Same rules; blank → `Cash`. |

Headers are matched by common names (`Txn Date`, `Narration`, `Debit`, `Payee`, `Mode`, …); if a required column is not detected you choose it from a dropdown and the preview refreshes.

**Validation & safety**
- UTF-8 text only (Excel: *CSV UTF-8*); binary files, wrong types, files over 2 MB, or more than 5,000 rows are rejected with a clear message. Delimiter `,` `;` or tab is auto-detected.
- Each row is `valid`, `invalid` (with the reason) or `duplicate` (same date + amount + text as an existing expense, or repeated in the file). Duplicates are skipped unless you tick *Import duplicates too*.
- The commit step **re-validates every row on the server**; tampered rows are skipped, not saved. Imported rows belong to the signed-in user and have `source: csv`.
- If a database write partly fails, rows already inserted stay and the result reports how many failed.

# Old-app migration format

`POST /api/migration/legacy` takes `{ "keys": { "smartExpenseManager_expenses": "<json string>", … } }` — i.e. the raw `localStorage` values written by the original app (produced by *Download backup (JSON)* in `legacy/`). Handled: expenses (`id, amount, category, description, paymentMode, date`), income (current object form or the oldest single-number form), budgets (per-month form or the oldest flat form), and the warning threshold. Old ids become `legacyId`, so importing the same backup twice updates nothing and duplicates nothing.