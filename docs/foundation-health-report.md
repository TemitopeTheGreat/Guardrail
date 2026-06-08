# Guardrail Financial — Foundation Health Report

**Scope:** Full 9-layer audit of the data-parsing, data-fetching, routing,
authentication, uploader, dashboard UI, tax engine, database, and deployment
layers, per the "Deep Diagnostic and Foundation Fix" brief. Every file in
each layer was read in full; issues were fixed as found rather than limited
to the five symptoms originally reported.

---

## 1. Issues Found

1. **Transaction fetch capped at 5,000 rows** — [dashboard/individual.html](../dashboard/individual.html)
   (formerly lines ~797 & ~822) and [dashboard/business.html](../dashboard/business.html)
   (formerly lines ~889 & ~917) loaded transactions with `.select('*').range(0, 4999)`,
   silently truncating any audit with more than 5,000 rows.

2. **CSV column-name mismatch** — [api/audit.js](../api/audit.js) read `row.date`,
   `row.description`, `row.debit`, `row.credit` directly from parsed CSV rows.
   Nigerian bank exports commonly use header variants such as `Trans Date`,
   `Narration`, `Withdrawals`/`Deposits`, `DR`/`CR`, etc. — any file using these
   variants would silently produce empty `date`/`description`/`debit`/`credit`
   fields, flagging every row as `missing_amount`/`invalid_date` and tanking
   the audit score (this is the most likely root cause of "Outflow showing
   NGN 0.00" — the amounts were never being read from the CSV in the first place).

3. **`vercel.json` rewrite rule** — the existing config
   (`{"version": 2, "rewrites": [{ "source": "/((?!api/).*)", "destination": "/$1" }]}`)
   used a negative-lookahead rewrite that is fragile across Vercel CLI/runtime
   versions and was flagged in the brief as a possible cause of `vercel dev`
   crashing with a runtime-config error.

4. **`formatNGN` inconsistency** — [dashboard/individual.html](../dashboard/individual.html#L227)
   and [dashboard/business.html](../dashboard/business.html#L244) formatted currency as
   `toLocaleString('en-NG', { style: 'currency', currency: 'NGN' })` → `"₦1,234.50"`,
   while the canonical `fmtNGN` in [js/tax-nigeria.js](../js/tax-nigeria.js#L74),
   [js/ledger-renderer.js](../js/ledger-renderer.js), and [js/statements.js](../js/statements.js)
   produces `"NGN 1,234.50"`. Same data, two different formats on the same page
   depending on which code path rendered it — a "consistency principle" violation.

5. **Ledger running balance computed in the wrong order** — [js/ledger-renderer.js](../js/ledger-renderer.js)
   computed the running balance over `getSorted()`, which defaults to **descending**
   date order, so the balance accumulated backwards through the ledger.

6. **Ledger field-name mismatch** — the ledger's date-range filter compared against
   `t.date`, but the `transactions` table (and the data Supabase actually returns)
   uses `txn_date`. The filter was a silent no-op.

7. **Ledger missing most spec'd features and using light-theme classes** —
   [js/ledger-renderer.js](../js/ledger-renderer.js) rendered with light-theme Tailwind
   classes (`text-slate-900`, `bg-slate-100`, `border-slate-300`) inside dashboards
   that are dark-themed (`bg-slate-950`, panels `bg-slate-900 border-slate-800`),
   making the table illegible. It also lacked search, type/date filters, totals
   row, materiality badges, category-type colour-coding, a clickable category
   summary, and jump-to-page.

8. **PDF report always shows ₦0.00 for total debits/credits** — [api/generate-report.js](../api/generate-report.js#L145-146)
   read `audit.total_debits` / `audit.total_credits` from the `audits` table row,
   but neither [supabase/schema.sql](../supabase/schema.sql#L75-92) nor the insert in
   [api/audit.js](../api/audit.js#L273-285) defines or persists those columns —
   the values are computed in `audit.js` and returned in the JSON response only,
   never written to the database. Every generated PDF therefore showed
   `Total debits: ₦0.00` / `Total credits: ₦0.00` regardless of the real totals.

9. **PDF currency symbol unsupported by PDFKit's font** — `fmtMoney` in
   [api/generate-report.js](../api/generate-report.js#L21-24) prefixed amounts with
   the `₦` glyph (U+20A6) while rendering with PDFKit's built-in Helvetica, which
   uses WinAnsi encoding and has no glyph for the Naira sign — the symbol would
   render as a missing/garbled character in the PDF.

10. **Duplicated, driftable VAT rate constant** — [dashboard/business.html](../dashboard/business.html)
    `window.calcVAT` and `window.saveVAT` each hard-coded a local
    `const VAT_RATE = 0.075`, duplicating the legislatively-cited
    `window.GuardrailTax.VAT_RATE` already exported by [js/tax-nigeria.js](../js/tax-nigeria.js#L11)
    (which this same page loads and uses for the auto-computed VAT tab). A future
    rate change (Finance Act amendments happen) updated in one place would silently
    not apply to the manual VAT calculator/saver, producing inconsistent figures
    on the same tab.

---

## 2. Fixes Applied

1. **Full-data fetch helper** — added `fetchAllTransactions(auditId)` to both
   dashboard files, which pages through `.range()` in batches of 1,000 until a
   short page signals the end, and replaced all four `.range(0, 4999)` call
   sites with `await fetchAllTransactions(latestAudit.id)`. No row-count ceiling
   remains.

2. **Column-alias detection** — added `COLUMN_ALIASES` + `detectColumns(headers)`
   to [api/audit.js](../api/audit.js#L96-110), mapping common Nigerian bank header
   variants (`trans date`, `value date`, `narration`, `particulars`, `withdrawals`,
   `deposits`, `dr`/`cr`, `amount (dr)`/`amount (cr)`, etc.) onto the standard
   `date`/`description`/`debit`/`credit` fields before the row-filter/clean pipeline
   runs — verified with `node --check`.

3. **Rewrote `vercel.json`** to the simpler, explicit identity rewrite:
   ```json
   { "rewrites": [ { "source": "/api/(.*)", "destination": "/api/$1" } ] }
   ```

4. **Unified `formatNGN`** in both dashboards to the canonical
   `'NGN ' + v.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`
   format used everywhere else in the codebase.

5. **Rewrote [js/ledger-renderer.js](../js/ledger-renderer.js)** in full:
   running balance is now precomputed once, in chronological (`row_number`) order,
   and cached per row — display sort no longer affects it; fixed the `t.date` →
   `t.txn_date` mismatch; restyled every element to the dashboard's dark theme;
   added live search, type filter (income/expense), date-range filter, a totals
   row (page subtotal + grand total), `MATERIALITY_THRESHOLD = 500_000` badges,
   category-type colour-coded badges (income/cost/opex/tax), a clickable
   percentage-bar category summary that filters the ledger on click, and
   jump-to-page. Verified with `node --check`.

6. **Fixed PDF totals** — [api/generate-report.js](../api/generate-report.js)
   now derives `totalDebits`/`totalCredits` directly from the already-fetched,
   non-flagged transactions (the same population `audit.js` scores), rather than
   reading non-existent columns from the `audits` row.

7. **Fixed PDF currency rendering** — `fmtMoney` in `generate-report.js` now
   uses the ASCII-safe `'NGN '` prefix instead of `₦`, matching the canonical
   format and avoiding the WinAnsi glyph issue.

8. **De-duplicated the VAT rate** — `calcVAT`/`saveVAT` in
   `dashboard/business.html` now read `window.GuardrailTax.VAT_RATE` instead of
   each carrying its own hard-coded `0.075`.

All JS changes were verified with `node --check`.

---

## 3. Remaining Items (require manual action — cannot be fixed by code change alone)

- **Run `supabase/schema.sql` and `supabase/storage-setup.sql` in the Supabase
  SQL editor** if not already applied to the live project — this audit confirmed
  the *files* define all 6 tables with RLS (4 policies each), the
  `handle_new_user` trigger, the `get_my_account_type()` helper, indexes, and
  both private storage buckets (`raw-uploads`, `pdf-reports`) with correct
  per-folder RLS policies — but it cannot confirm the live database matches the
  files without DB credentials. Run the verification queries at the bottom of
  each file to confirm.
- **Pin a Node engine version** — `package.json` has no `engines.node` field.
  Add one (e.g. `"engines": { "node": "20.x" }`) so Vercel builds use a
  consistent runtime and local/production behaviour can't drift.
- **Manual smoke test of `vercel dev`** — the `vercel.json` rewrite was rewritten
  per the brief's exact instruction, but only running `vercel dev` locally (item
  19 below) can confirm the "runtime config crash" symptom is actually gone, since
  it depends on the installed Vercel CLI version and `.vercel/` project link state.
- **Re-run an upload through the live Supabase project** to confirm the
  column-alias detection (fix #2) resolves real-world bank export files —
  this audit could only verify the parsing logic statically; it needs a live
  CSV from each bank format the business expects to support.

---

## 4. Test Checklist

20 manual tests the developer must run to verify the foundation is solid:

- [ ] Individual signup creates a profiles row
- [ ] Business signup creates a profiles row with business_name
- [ ] Login redirects individual to individual dashboard
- [ ] Login redirects business to business dashboard
- [ ] Logged out user cannot access any dashboard URL
- [ ] CSV upload returns JSON (not HTML) from api/audit
- [ ] All 20 rows from june-transactions.csv appear in ledger
- [ ] Debit total matches sum of all debit rows in CSV
- [ ] Credit total matches sum of all credit rows in CSV
- [ ] Audit score is between 55 and 75 for the test CSV
- [ ] Balance sheet shows correct net position
- [ ] Cash flow tab shows correct monthly breakdown
- [ ] Goals tab — adding a goal saves to Supabase
- [ ] Goals tab — deleting a goal removes it from the list
- [ ] VAT tab — computation uses 7.5% rate correctly
- [ ] Stations tab — adding a station saves to Supabase
- [ ] Sign out redirects to login.html
- [ ] PDF report generates and downloads successfully
- [ ] vercel dev starts without errors
- [ ] No console errors on page load of any page
