# Phase 3 — Audit Engine Test Checklist

## Setup
- [ ] `npm install` runs without errors
- [ ] `.env` file exists with real `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `.env` is listed in `.gitignore` and NOT committed to git

## Local Development
- [ ] `vercel dev` starts the dev server (required for /api/ routes)
- [ ] Static pages load at `http://localhost:3000`

## Audit API — api/audit.js
- [ ] Calling `/api/audit` without a JWT returns `401 Unauthorised`
- [ ] Calling `/api/audit` with a valid JWT but wrong `user_id` path is rejected `403`
- [ ] Uploading `test-data/sample-transactions.csv` returns a valid JSON response
- [ ] `audit_score` is returned and is below 70 (test data contains errors)
- [ ] `duplicate_count` is `1` (row 2 is a duplicate of row 1)
- [ ] `flagged_rows` contains a row with `flag_reason: "invalid_date"` (row 9: "bad date here")
- [ ] `flagged_rows` contains a row with `flag_reason: "missing_amount"` (row 10: "Missing amount")
- [ ] `balance_valid` is `false` (debits and credits do not balance)
- [ ] All clean rows appear in Supabase `transactions` table
- [ ] Audit row appears in Supabase `audits` table with correct score and status `complete`
- [ ] Date `25/06/03` (row 3) is normalised to `2003-06-25` — not flagged
- [ ] Descriptions are trimmed (row 1 "Office supplies " → "Office supplies")
- [ ] Categories are assigned (e.g. row 4 generator → "fuel", row 5 salaries → "salary")

## Report API — api/generate-report.js
- [ ] Calling `/api/generate-report` without a JWT returns `401 Unauthorised`
- [ ] Calling with a valid JWT but a different user's `audit_id` returns `404`
- [ ] Returns `{ success: true, report_url: "..." }` with a signed URL
- [ ] Clicking "Download Report" triggers a PDF download in the browser
- [ ] PDF page 1 shows the audit score and user's name
- [ ] PDF page 2 shows summary (total rows, duplicates, errors, balance)
- [ ] PDF page 3 shows the transaction ledger with all rows
- [ ] PDF page 4 shows flagged rows (only present when errors > 0)
- [ ] `report_url` path is saved to the `audits` row in Supabase

## Frontend Uploader — js/uploader.js
- [ ] Drop zone renders when `initUploader('container-id')` is called
- [ ] Drag and drop highlights the zone on dragover, resets on dragleave
- [ ] Clicking the zone opens the file picker
- [ ] Uploading a `.txt` file shows "Please upload a CSV or Excel file."
- [ ] Uploading a file over 10MB shows the size error
- [ ] Upload progress shows live status messages at each stage
- [ ] Audit results display without page reload after success
- [ ] Score colour is correct (green ≥90, amber 70–89, red <70)
- [ ] Flagged rows table appears when errors exist
- [ ] Error messages are plain English — no raw API errors shown
- [ ] Drop zone re-enables after an error so the user can retry

## Security
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is never sent to the browser
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is not present in any frontend `.js` or `.html` file
- [ ] RLS prevents a user from reading another user's `audits` or `transactions` rows
- [ ] The `file_path` ownership check in `audit.js` blocks cross-user access

## Production Deployment (Vercel)
- [ ] `SUPABASE_URL` is set in Vercel environment variables
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel environment variables
- [ ] `/api/audit` and `/api/generate-report` respond correctly on production URL
