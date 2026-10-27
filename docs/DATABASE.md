# Database models (MongoDB / Mongoose)

Every collection except `users` has a `user` field (ObjectId → `User`) and every query filters on it.

| Collection | Key fields | Indexes / constraints |
|---|---|---|
| **users** | name, email, passwordHash (`select:false`), currency, warningThreshold, theme, browserNotifications, tokenVersion | unique `email` |
| **categories** | user, name, nameKey, icon, color, isDefault, isFallback | unique `(user, nameKey)` — case-insensitive names |
| **paymentmodes** | user, name, nameKey, isDefault | unique `(user, nameKey)` |
| **expenses** | user, amount (0.01–1e8), description, merchant, **category →Category, paymentMode →PaymentMode**, date, currency, originalAmount/Currency, source, receipt →Receipt, recurringRule →RecurringRule, occurrenceDate, legacyId, fingerprint | `(user,date)`, `(user,category,date)`, `(user,paymentMode,date)`, `(user,fingerprint)`; **unique partial `(user, recurringRule, occurrenceDate)`** (a recurring occurrence can be recorded once); **unique partial `(user, legacyId)`** (migration is re-runnable) |
| **budgets** | user, category →Category, period (`default` or YYYY-MM), limit, threshold | unique `(user, category, period)` |
| **incomes** | user, period, amount | unique `(user, period)` |
| **savingsgoals** | user, title, targetAmount, targetDate, note | |
| **contributions** | user, goal →SavingsGoal, type (deposit/withdrawal), amount, date, note | `(user, goal, date)` |
| **recurringrules** | user, description, amount, category, paymentMode, frequency, startDate, endDate, status, autoPost, **nextDueDate** (first occurrence neither posted nor skipped) | |
| **receipts** | user, originalName, mimeType, size, sha256, storageKey, status, provider, rawText, extracted{merchant,date,total,subtotal,tax,currency,paymentMethod,suggestedCategory,lineItems,confidence}, warnings, expense →Expense | unique `(user, sha256)` |
| **dismissedalerts** | user, key | unique `(user, key)` |
| **chatmessages** | user, role, content, meta | `(user, createdAt)` (trimmed to 200 per user) |
| **importlogs** | user, kind (csv/legacy), fileName, counts | |

Notes: `timestamps` on every collection. Money is stored as a number rounded to 2 decimals. `date` is a UTC-midnight `Date`. Relationships are resolved with `populate` for list endpoints and with `$lookup`-free in-memory joins for analytics (users' data sets are small; analytics load at most 30,000 rows).