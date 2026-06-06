# Phase 4 — Dashboard Test Checklist

## Auth & Routing

- [ ] Visiting `/dashboard/individual.html` without being logged in redirects to `/login.html`
- [ ] Visiting `/dashboard/business.html` without being logged in redirects to `/login.html`
- [ ] Logging in as an individual account redirects to `individual.html`
- [ ] Logging in as a business account redirects to `business.html`
- [ ] "Sign out" button on both dashboards logs out and redirects to `/login.html`
- [ ] Nav shows user's full name and plan tier (individual) or business name (business)

---

## Individual Dashboard — `dashboard/individual.html`

### Overview tab
- [ ] Four metric cards render: Net Worth, Monthly Income, Monthly Expenses, Audit Score
- [ ] Cards show `—` (no value) on first visit before any audit is uploaded
- [ ] Spending breakdown bar chart appears after an audit is run
- [ ] Recent transactions table shows up to 10 most recent transactions

### Audit & Clean tab
- [ ] Upload drop zone renders
- [ ] Uploading `test-data/sample-transactions.csv` shows live progress messages
- [ ] After upload completes, the Overview tab data refreshes automatically (no page reload)
- [ ] Audit history table appears below the uploader with file name, score, rows, status
- [ ] Clicking "↓ PDF" downloads the audit report
- [ ] Score colour is green ≥90, amber 70–89, red <70

### Cash Flow tab
- [ ] Monthly income and expenses chart renders from audit transactions
- [ ] Shows `—` or empty state if no audit data exists

### Balance Sheet tab
- [ ] Total assets and total liabilities sections render
- [ ] Net position (assets − liabilities) displayed
- [ ] Shows empty state if no audit data exists

### Goals tab
- [ ] Empty state appears on first visit
- [ ] Filling out the "Add New Goal" form and submitting saves to Supabase
- [ ] New goal card appears immediately without page reload
- [ ] Progress bar fills proportionally to current_spend / limit_amount
- [ ] Red "Guardrail breached" banner appears when spend exceeds limit
- [ ] Clicking × on a goal deactivates it (removes from list, sets `is_active = false`)
- [ ] Goal type label displays in human-readable format (e.g. "Expense Cap")

---

## Business Dashboard — `dashboard/business.html`

### Overview tab
- [ ] Four metric cards render: Total Revenue, Total Costs, Net Profit, Profit Margin
- [ ] Revenue vs Costs progress bars display correctly after upload
- [ ] Business Expenses breakdown bar chart renders
- [ ] Recent transactions table shows up to 10 rows

### Audit & Clean tab
- [ ] Same uploader behaviour as individual dashboard
- [ ] Audit history table renders with same columns
- [ ] PDF download works

### P&L Statement tab
- [ ] Revenue section groups all credit transactions by category
- [ ] Cost of Sales section shows only purchases/fuel/logistics category debits
- [ ] Operating Expenses section shows all remaining debit categories
- [ ] Gross Profit = Total Revenue − Cost of Sales (displayed with gross margin %)
- [ ] Net Profit = Gross Profit − Total Operating Expenses
- [ ] Net Profit card is green when positive, red when negative
- [ ] "Export P&L" button triggers PDF download
- [ ] Empty state shows if no audit exists

### VAT tab
- [ ] Current period card shows latest VAT record (or "no records" message)
- [ ] VAT calculator: entering Total Sales and Total Purchases auto-calculates at 7.5%
- [ ] Output VAT, Input VAT, and Net Payable update as user types
- [ ] "Save VAT Record" inserts a new row in `vat_records` (NOT inserting `net_vat_payable` — GENERATED column)
- [ ] New record appears in VAT history table immediately
- [ ] Filing status badge renders with correct colour (draft=grey, ready=green, filed=indigo, overdue=red)

### Stations tab
- [ ] Empty state if no stations added
- [ ] "Add Station" form: name and monthly_budget required, code optional
- [ ] Submitting adds a new station card immediately
- [ ] Station card shows: name, code (if present), budget, current spend, variance, progress bar
- [ ] Progress bar is green <80%, amber 80–99%, red ≥100%
- [ ] "Update" button on each card saves new `actual_spend` to Supabase (does NOT write `variance` — GENERATED column)
- [ ] Variance updates immediately after spend update
- [ ] Clicking × deactivates the station (sets `is_active = false`, removes from list)
- [ ] Over-budget station card has red border

### Goals tab
- [ ] Same behaviour as individual goals tab
- [ ] Goal types available include: Expense Cap, Savings Target, Revenue Target, Profit Buffer

---

## Cross-Dashboard

- [ ] `window.supabaseClient` is set before `initUploader()` is called
- [ ] The `window.fetch` wrapper detects successful `/api/audit` calls and auto-refreshes data
- [ ] All currency values display as NGN (e.g. `NGN 150,000.00`)
- [ ] All dates display as `DD/MM/YYYY`
- [ ] Skeleton loader disappears once data is loaded
- [ ] No unhandled JS errors in browser console during normal use
- [ ] No `SUPABASE_SERVICE_ROLE_KEY` visible in any network request
- [ ] RLS prevents users from reading other users' data (test by checking network tab)
