# SpendIQ AI — Smart Personal Finance Manager

A full-stack personal finance app: **React (Vite) + Node.js/Express + MongoDB**, with forecasting, a data-grounded AI assistant, receipt scanning, budgets with alerts, savings goals, recurring payments, reports, CSV import/export, and a safe migration path from the original browser-only SpendIQ.

> The original static app is preserved in [`legacy/`](legacy/) (it now has a "Download backup (JSON)" button used by the migration importer).

---

## Contents
1. [Quick start](#quick-start) · 2. [Configuration](#configuration) · 3. [Features](#features) · 4. [Architecture](#architecture) · 5. [Testing](#testing) · 6. [Production build](#production-build) · 7. [Migrating old data](#migrating-your-old-spendiq-data) · 8. [AI & OCR setup](#ai--ocr-setup) · 9. [Security](#security-notes) · 10. [What is verified](#what-has-been-verified) · 11. [Troubleshooting](#troubleshooting)

Further docs: [API reference](docs/API.md) · [Database models](docs/DATABASE.md) · [CSV import format](docs/CSV_IMPORT.md) · [Syllabus coverage (Topics 31–48)](docs/SYLLABUS_COVERAGE.md) · [Postman collection](docs/postman/SpendIQ.postman_collection.json)

---

## Quick start

**Prerequisites**
- Node.js **20+** (developed on 22) and npm
- MongoDB 6+ running locally (`mongodb://127.0.0.1:27017`) **or** a free MongoDB Atlas cluster
- *Optional:* [Tesseract OCR](https://tesseract-ocr.github.io/tessdoc/Installation.html) for receipt scanning without an AI key (`sudo apt install tesseract-ocr poppler-utils` / `brew install tesseract poppler`)

```bash
git clone https://github.com/shreyaa008/SpendIQ.git && cd SpendIQ
git checkout spendiq-ai-upgrade          # the upgraded app lives on this branch

npm run install:all                      # root + server + client dependencies

cp server/.env.example server/.env       # then edit server/.env
#   → set JWT_SECRET (32+ random chars):
#     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
#   → set MONGODB_URI if you are not using local MongoDB

npm run dev                              # API on :5000, web app on http://localhost:5173
```

Open **http://localhost:5173**, create an account, and you get a personal workspace with default categories and payment modes.
Want sample data first? `npm run seed:demo` creates `demo@spendiq.test` / `Demo1234` with ~6 months of spending.

If the API cannot start you get a plain message (missing `JWT_SECRET`, MongoDB unreachable) instead of a stack trace.

## Configuration

All settings are environment variables in `server/.env` (template: [`server/.env.example`](server/.env.example)). **Never commit `.env`.**

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | **yes** | Signs session tokens. ≥ 32 characters. |
| `MONGODB_URI` | yes in production | MongoDB connection string. Default `mongodb://127.0.0.1:27017/spendiq`. |
| `PORT` | no | API port (default 5000). |
| `CLIENT_ORIGIN` | dev | Allowed browser origin(s) for CORS (default `http://localhost:5173`). |
| `COOKIE_SECURE`, `SERVE_CLIENT` | prod | Default to `true` when `NODE_ENV=production`. |
| `ANTHROPIC_API_KEY` | **no** | Enables AI wording for the assistant and the AI receipt reader. See below. |
| `ANTHROPIC_MODEL` | no | Default `claude-sonnet-5-5`. |
| `RECEIPT_OCR_PROVIDER` | no | `auto` (default) · `tesseract` · `anthropic`. |
| `MAX_RECEIPT_MB`, `MAX_CSV_MB`, `CSV_MAX_ROWS` | no | Upload limits (8 MB / 2 MB / 5000 rows). |
| `RATE_LIMIT_*` | no | API rate limits. |

**External services you may need credentials for:** only an Anthropic API key, and only if you want AI features beyond the built-in rule-based assistant and local OCR. Everything else works with MongoDB alone.

## Features

| Area | What it does |
|---|---|
| **Accounts** | Register/login, bcrypt-hashed passwords, JWT in an httpOnly cookie, logout, "sign out everywhere", password change, account deletion. Every record belongs to one user; every query is scoped by the authenticated user id. |
| **Transactions** | Add/edit/delete (with undo), search by description/merchant, filter by category, payment mode, amount range, date range, month/year, recurring, has-receipt, source; sort; paginate; totals and CSV export follow the same filters. Foreign-currency entry with live conversion (kept from the original app). |
| **Budgets & alerts** | Per-category monthly or "every month" budgets, custom warning thresholds, progress bars, in-app alerts (dismissible), optional browser notifications. |
| **Forecasting** | Month-end projection with an 80% range, next-3-month forecast per category, trend detection, budget-breach likelihood, expected-vs-actual (walk-forward backtest), plain-language factors. Always labelled as an estimate; flagged **preliminary** with thin history. |
| **AI assistant** | Natural-language questions answered from *your* data. Figures are computed by the server; each statement is tagged Actual / Estimate / Suggestion; the basis is shown. |
| **Receipt scanner** | Upload JPG/PNG/WebP/PDF → OCR → editable review form → explicit confirm. Duplicate file and likely-duplicate-expense detection, retry on failure. |
| **Savings goals** | Target, optional date, contributions/withdrawals, progress, required monthly amount. Regular expenses never count as savings. |
| **Recurring** | Weekly/monthly/yearly rules are schedules, not transactions. Mark paid / skip / pause / resume; optional auto-record; idempotent (no duplicates on refresh, double-click or concurrent runs). |
| **Reports** | Monthly report: totals, category & payment-mode breakdown, daily/weekly trend, budgets, goals, recurring, largest & unusual transactions, month-over-month, forecast vs actual. CSV download and Print/PDF. |
| **Categories & payment modes** | Custom names, icons, colours. Deleting something in use requires choosing where its records move. |
| **CSV import/export** | Column mapping, per-row validation, duplicate detection, preview before import; formula-injection-safe export. |
| **Migration** | Imports the old app's browser data (file or same-browser), idempotent, validated, never deletes the source. |

## Architecture

```
SpendIQ/
├── client/                 React 19 + Vite SPA
│   └── src/ api/ context/ hooks/ components/ (ui, charts) pages/ utils/ test/
├── server/                 Node.js (ES modules) + Express 5 + Mongoose
│   ├── src/ config/ models/ middleware/ routes/ services/ utils/
│   ├── scripts/            repl.js, seed-demo.js
│   └── tests/              node:test + supertest against a real MongoDB
├── docs/                   API, database, CSV, syllabus map, Postman collection
└── legacy/                 the original localStorage app (+ backup export button)
```

- **Request flow:** `helmet → cors → json → cookies → rate limit → /api/auth` (public) or `requireAuth → resource router → zod validation → handler → errorHandler`.
- **Analytics are shared:** dashboard, reports, forecast, alerts and the assistant all call the same service functions, so every screen shows the same numbers.
- **Dates** are stored as UTC-midnight and exchanged as `YYYY-MM-DD`, so a calendar day never shifts with time zones.

## Testing

```bash
npm test                  # server + client
npm --prefix server test  # 45 API tests; needs MongoDB (uses database "spendiq_test", which it drops!)
npm --prefix client test  # 18 component/unit tests (Vitest + Testing Library)
```
Set `MONGODB_URI_TEST` to point the API tests at another database. The server tests include real OCR (needs Tesseract; skipped with a notice if absent). API testing with Postman: import [`docs/postman/SpendIQ.postman_collection.json`](docs/postman/SpendIQ.postman_collection.json), set `baseUrl`, and run the collection (or `npx newman run … --working-dir docs/postman --env-var baseUrl=http://localhost:5000`).

## Production build

```bash
npm run build                                  # → client/dist
NODE_ENV=production \
MONGODB_URI="mongodb+srv://…" JWT_SECRET="…" \
npm start                                      # Express serves the API *and* the built app on PORT
```
In production the cookie is `Secure` (serve over HTTPS, e.g. behind a reverse proxy; `trust proxy` is enabled) and the same origin serves both app and API, so no CORS setup is needed.

## Migrating your old SpendIQ data

1. Open the old app from `legacy/index.html` in the **same browser** that holds your data.
2. Click **Move to SpendIQ AI → Download backup (JSON)**.
3. In the new app: **Settings → Import old data → Choose backup file**.

(If you served the old app on the same address as the new one, the new app also detects the data directly.) Import is validated row by row, bad rows are reported and skipped, good rows are saved, and re-running never duplicates anything. Your old browser data is never deleted.

## AI & OCR setup

**Without any key** the app is fully functional: the assistant writes deterministic answers from your data, and receipts are read with local Tesseract OCR.

**With `ANTHROPIC_API_KEY`:**
- The assistant sends the *server-computed facts for the signed-in user only* to the model, which phrases the answer. Any number in the reply that is not in the facts causes the reply to be discarded in favour of the verified rule-based answer. If the AI service is down, the same fallback applies.
- Receipts are read by the model's vision input (better on photos than Tesseract). Fields it cannot read are left empty, never guessed.

## Security notes

Passwords: bcrypt (cost 12). Sessions: JWT in an httpOnly, SameSite=Lax cookie (also accepted as `Bearer` for API tools); a `tokenVersion` lets password change / "sign out everywhere" revoke old tokens. All input is validated with zod; ids are validated before queries; the API never uses raw request objects in queries. Uploads are verified by magic bytes, size-limited, stored outside any public path under random names, and only streamed back to their owner. Helmet CSP, CORS allow-list, rate limiting (stricter on auth/AI/uploads), formula-injection-safe CSV export, generic error messages (no stack traces). Secrets only come from the environment.

Known trade-offs: logout clears the cookie but an already-copied token stays valid until it expires (default 7 days) unless you use "sign out everywhere"; there is no email verification or password-reset flow.

## What has been verified

Run in the development environment for this upgrade (MongoDB 7, Node 22, Tesseract 5, Chromium):

- **45 API tests pass** against a real MongoDB — auth/JWT forgery, cross-user isolation, CRUD, filters, budgets, goals, recurring idempotency (incl. concurrency), categories, CSV import/export, migration, forecast maths, alerts, reports, chatbot (rule-based and mocked-AI paths), receipts with **real OCR** on an image and a scanned PDF.
- **18 frontend tests pass**; production build succeeds.
- A real browser (Chromium) drove the built app and all **26 checks passed**: login and validation errors, add/search/filter/delete/undo, the full receipt-scan flow on a sample image, the assistant (including history after reload), budget form validation, Escape-to-close dialogs, dark mode persistence, route protection after logout, and the mobile drawer. (One of my own assertions was too strict on the first run and was corrected; it was a test bug, not an app bug. The same exercise also caught a real CSP bug that is now fixed.) All 11 pages were also loaded at desktop and mobile widths with no JavaScript errors and no horizontal overflow.
- A **fresh `git clone`** installs with `npm run install:all`, builds, and passes both test suites; `npm audit` reports 0 vulnerabilities.
- The **Postman collection** ran under Newman: 39 requests, 48 assertions, 0 failures.

**Not verified (needs credentials/hardware I did not have):** the live Anthropic API (the request/response handling and safeguards are tested against a mock server, not the real service); OCR quality on real phone photos (tested on a clean rendered receipt; blurry/skewed photos will be less accurate, which is why review-before-save is mandatory); browser notifications (permission flow implemented, not exercised in a headless browser); MongoDB Atlas; HTTPS deployment; Safari/Firefox.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `JWT_SECRET is missing…` | Set it in `server/.env` (32+ chars). |
| `Could not connect to MongoDB` | Start `mongod`, or set `MONGODB_URI` (Atlas string). |
| Receipt says "Local OCR is not installed" | Install Tesseract (see Quick start) or set `ANTHROPIC_API_KEY`. |
| Scanned PDF fails | Install `poppler-utils` (provides `pdftoppm`). |
| Login works but pages show "session expired" behind a proxy | Serve over HTTPS and keep `COOKIE_SECURE=true`; for plain HTTP testing set `COOKIE_SECURE=false`. |
| 429 Too many requests | Raise `RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_MAX` in `.env`. |

*Estimates and suggestions in this app are based on your own recorded data and are not financial advice.*
