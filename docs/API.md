
Base URL: `http://localhost:5000/api` (dev) · All bodies are JSON unless noted · Dates are `YYYY-MM-DD`, periods `YYYY-MM`.

**Authentication:** `POST /auth/login` or `/auth/register` sets an httpOnly cookie `spendiq_token` *and* returns `data.token`. Send either the cookie or `Authorization: Bearer <token>` (handy in Postman/curl). Everything except `/health`, `/auth/register`, `/auth/login`, `/auth/logout` requires authentication.

**Response shape**
```jsonc
// success
{ "success": true, "data": { … }, "meta": { … } }          // meta: pagination/totals when relevant
// failure (same shape for every error)
{ "success": false, "error": { "code": "VALIDATION", "message": "Please fix the highlighted fields.", "details": { "amount": "Amount must be greater than 0" } } }
```
Status codes: `200/201` ok · `400` validation/bad request · `401` not signed in · `404` not found *or not yours* · `409` conflict (duplicate, already done, category in use) · `413` too large · `422` unprocessable · `429` rate limited · `503` dependency unavailable.
User-isolation: asking for another user's record returns `404`, exactly like a record that does not exist.

## Auth — `/auth`
| Method & path | Body / query | Notes |
|---|---|---|
| `POST /auth/register` | `name, email, password (≥8, letter+number), currency?` | Creates user + default categories/payment modes. `409 EMAIL_TAKEN`. |
| `POST /auth/login` | `email, password` | Same error for unknown email and wrong password. |
| `POST /auth/logout` | – | Clears cookie. |
| `POST /auth/logout-all` | – | Revokes every issued token. |
| `GET /auth/me` | – | Current user. |
| `PUT /auth/me` | `name?, currency?, warningThreshold?, theme?, browserNotifications?` | |
| `POST /auth/me/password` | `currentPassword, newPassword` | Revokes other sessions. |
| `DELETE /auth/me` | `{ password }` | Deletes account + all data + files. |

## Expenses — `/expenses`
| | |
|---|---|
| `GET /expenses` | Filters: `q` (description/merchant), `category` & `paymentMode` (comma-separated ids), `minAmount`, `maxAmount`, `from`, `to`, `period`, `year`, `recurring=yes\|no`, `receipt=yes\|no`, `source=manual\|csv\|receipt\|recurring\|migration`; `sort=dateDesc\|dateAsc\|amountDesc\|amountAsc`; `page`, `limit≤100`. `meta`: `count, pages, totalAmount, average, highest` (for the **whole filtered set**). |
| `GET /expenses/export.csv` | Same filters (no paging). |
| `POST /expenses` | `amount, description?, merchant?, category (id), paymentMode (id), date, originalAmount?, originalCurrency?` → `201`; `meta.possibleDuplicateOf` if an identical entry exists. |
| `GET/PUT/DELETE /expenses/:id` | `PUT` takes the same body as `POST`. `DELETE` returns the deleted expense (used by "Undo"). |

## Categories & payment modes — `/categories`, `/payment-modes`
`GET` list (with `expenseCount`) · `POST {name, icon?, color?}` · `PUT /:id` · `DELETE /:id?reassignTo=<id>`.
Deleting something in use returns `409` with `details.usage` unless `reassignTo` is given; records (expenses, recurring rules, budgets) are then moved, never orphaned. The `Other` category and the last payment mode cannot be deleted.

## Budgets & income — `/budgets`, `/income`
| | |
|---|---|
| `GET /budgets?period=` | Effective budgets for the month with `spent, remaining, percent, status (ok\|warning\|exceeded)`. |
| `POST /budgets` | `category, period ("default" or YYYY-MM), limit, threshold?` — upsert (one per category per period). |
| `PUT /budgets/:id`, `DELETE /budgets/:id` | |
| `POST /budgets/copy` | `{from, to}` |
| `GET /income?period=`, `PUT /income {period, amount}`, `DELETE /income?period=` | `amount: null` means never entered. |

## Savings goals — `/goals`
`GET` · `POST {title, targetAmount, targetDate?, note?}` · `PUT/DELETE /:id` · `GET /:id/contributions` · `POST /:id/contributions {amount, type: deposit\|withdrawal, date?, note?}` · `DELETE /:id/contributions/:cid`.
Goal fields include `saved, remaining, percent, status (active\|behind\|overdue\|completed), requiredMonthly, onTrack`.

## Recurring — `/recurring`
`GET` → `{ rules, upcoming }` · `POST` / `PUT /:id` `{description, amount, category, paymentMode, frequency: weekly\|monthly\|yearly, startDate, endDate?, autoPost?}` · `DELETE /:id` · `POST /:id/pause|resume` · `POST /:id/post {occurrence?}` · `POST /:id/skip {occurrence?}` · `POST /process`.
`post`/`skip` accept the occurrence date you mean; if it is no longer the next due date the server answers `409` — a repeated click can never pay the following month.

## Receipts — `/receipts` (multipart)
| | |
|---|---|
| `POST /receipts` | form field `receipt` (JPG/PNG/WebP/PDF ≤ 8 MB). Returns extracted fields, `warnings`, `status (extracted\|failed)`, `possibleDuplicateExpense`. `409` if the same file was uploaded before. **Never creates an expense.** |
| `GET /receipts`, `GET /receipts/:id`, `GET /receipts/:id/file` | File is streamed only to its owner. |
| `POST /receipts/:id/reprocess` | Retry reading. |
| `POST /receipts/:id/confirm` | `{amount, merchant, date, category, paymentMode, description?, acknowledgeDuplicate?}` → creates the expense (`source: receipt`) and links it. `409` on a likely duplicate unless acknowledged. |
| `DELETE /receipts/:id` | Deletes receipt + file; a linked expense is kept. |

## Import — `/import`, `/migration`
`GET /import/csv/template` · `POST /import/csv/preview` (form `file`, optional `mapping` JSON, `dateFormat`) · `POST /import/csv/commit {rows, includeDuplicates?, fileName?}` (revalidated server-side) · `GET /migration/status` · `POST /migration/legacy {keys}` — see [CSV_IMPORT.md](CSV_IMPORT.md).

## Analytics
| | |
|---|---|
| `GET /dashboard?period=` | Everything the dashboard shows. |
| `GET /reports/monthly?period=` · `GET /reports/monthly.csv?period=` · `GET /reports/compare?period=` | |
| `GET /forecast` | Current-month projection, next 3 months, budget outlook, backtest, factors, suggestions, `dataQuality`. |
| `GET /insights` · `POST /insights/dismiss {key}` · `DELETE /insights/dismissed` | Smart alerts (max 10 shown). |
| `GET /chat/status` · `GET /chat/history` · `DELETE /chat/history` · `POST /chat {message ≤ 500}` | Response `data.meta.facts[]` each `{type: actual\|estimate\|recommendation, text}`, plus `basis`, `usedAI`, `aiNote`. |

## Misc
`GET /health` (public) · `GET /system/runtime` (Node/V8/memory/event-loop info) · `GET /currency/rates?base=INR` (cached exchange rates).

