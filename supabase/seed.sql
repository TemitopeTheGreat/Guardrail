-- Guardrail Financial
-- File: seed.sql
-- Run in: Supabase SQL Editor (Settings > SQL Editor)
-- WARNING: Review RLS policies before running in production
--
-- !! DEVELOPMENT ONLY — DO NOT RUN IN PRODUCTION !!
-- This file inserts fixed-UUID test data for local development.
-- All UUIDs are deterministic so seed data stays consistent
-- across database resets.
--
-- Just run this file in the SQL Editor — it creates the auth
-- users, profiles, and all seed data in the correct order.
-- Safe to re-run: all inserts use ON CONFLICT DO NOTHING/UPDATE.

-- ============================================================
-- SECTION: TEST USER REFERENCE
-- ============================================================
-- User 1 — Individual (free plan)
--   Email : adewale.test@guardrailtest.dev
--   UUID  : aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
--
-- User 2 — Individual (pro plan)
--   Email : ngozi.test@guardrailtest.dev
--   UUID  : bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
--
-- User 3 — Business (enterprise plan)
--   Email : apex.test@guardrailtest.dev
--   UUID  : cccccccc-cccc-cccc-cccc-cccccccccccc


-- ============================================================
-- SECTION: AUTH USERS
-- Must be inserted BEFORE profiles due to the FK constraint
-- profiles.id → auth.users.id.
-- The handle_new_user trigger fires on each insert and
-- auto-creates the matching profiles row from raw_user_meta_data.
-- Password for all 3 test accounts: TestPass123!
-- ============================================================

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'adewale.test@guardrailtest.dev',
    crypt('TestPass123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Adewale Balogun","account_type":"individual"}',
    now(), now()
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'ngozi.test@guardrailtest.dev',
    crypt('TestPass123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Ngozi Okafor","account_type":"individual"}',
    now(), now()
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'apex.test@guardrailtest.dev',
    crypt('TestPass123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Chidi Eze","account_type":"business","business_name":"Apex Ventures Ltd"}',
    now(), now()
  )
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- SECTION: PROFILES
-- The trigger already created these rows when auth.users were
-- inserted above. These INSERTs are a safe fallback in case
-- the trigger did not fire (ON CONFLICT DO NOTHING = harmless).
-- plan_tier and onboarding_done are updated separately since
-- the trigger only sets the fields from raw_user_meta_data.
-- ============================================================

INSERT INTO public.profiles (id, full_name, account_type, plan_tier, onboarding_done)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Adewale Balogun', 'individual', 'free', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Ngozi Okafor',    'individual', 'pro',  true)
ON CONFLICT (id) DO UPDATE SET
  plan_tier        = EXCLUDED.plan_tier,
  onboarding_done  = EXCLUDED.onboarding_done;

INSERT INTO public.profiles (id, full_name, account_type, business_name, rc_number, industry_sector, plan_tier, onboarding_done)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Chidi Eze', 'business', 'Apex Ventures Ltd', 'RC-1234567', 'Retail & Distribution', 'enterprise', true)
ON CONFLICT (id) DO UPDATE SET
  business_name    = EXCLUDED.business_name,
  rc_number        = EXCLUDED.rc_number,
  industry_sector  = EXCLUDED.industry_sector,
  plan_tier        = EXCLUDED.plan_tier,
  onboarding_done  = EXCLUDED.onboarding_done;


-- ============================================================
-- SECTION: AUDITS
-- ============================================================

INSERT INTO public.audits (
  id, user_id, file_name, file_path,
  file_size_bytes, status, audit_score,
  total_rows, error_count, duplicate_count,
  balance_valid, account_type, created_at, completed_at
)
VALUES
  (
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'jan_statement.csv',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1/jan_statement.csv',
    45312, 'complete', 87.50,
    120, 3, 2, true, 'individual',
    now() - interval '10 days',
    now() - interval '10 days' + interval '2 minutes'
  ),
  (
    'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'feb_expenses.xlsx',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2/feb_expenses.xlsx',
    82100, 'complete', 72.00,
    98, 8, 0, false, 'individual',
    now() - interval '5 days',
    now() - interval '5 days' + interval '3 minutes'
  ),
  (
    'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'q1_ledger.csv',
    'cccccccc-cccc-cccc-cccc-cccccccccccc/c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3/q1_ledger.csv',
    210000, 'complete', 94.25,
    450, 1, 0, true, 'business',
    now() - interval '2 days',
    now() - interval '2 days' + interval '5 minutes'
  )
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- SECTION: TRANSACTIONS (representative sample per audit)
-- ============================================================

INSERT INTO public.transactions (audit_id, user_id, txn_date, description, debit, credit, category, is_flagged, flag_reason, row_number)
VALUES
  -- Adewale — jan_statement.csv (rows include one duplicate)
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-01-05', 'January Salary',            0.00,      250000.00, 'salary',    false, NULL,        1),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-01-08', 'EKEDC Electricity Bill',    18500.00,       0.00, 'utilities', false, NULL,        2),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-01-08', 'EKEDC Electricity Bill',    18500.00,       0.00, 'utilities', true,  'duplicate', 3),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-01-15', 'Fuel — personal vehicle',   12000.00,       0.00, 'fuel',      false, NULL,        4),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2025-01-20', 'Airtime top-up',             3500.00,       0.00, 'utilities', false, NULL,        5),

  -- Ngozi — feb_expenses.xlsx (balance mismatch flagged)
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2025-02-01', 'Freelance Payment — Accenture',  0.00, 180000.00, 'income',    false, NULL,        1),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2025-02-10', 'Internet Subscription',      15000.00,       0.00, 'utilities', false, NULL,        2),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2025-02-14', 'Rent payment',              120000.00,       0.00, 'rent',      false, NULL,        3),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2025-02-22', 'Unknown debit ref #XR9',      8700.00,       0.00, NULL,        true,  'format_error', 4),

  -- Apex Ventures — q1_ledger.csv (business)
  ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2025-01-10', 'Wholesale stock purchase',  500000.00,       0.00, 'cost_of_goods', false, NULL,   1),
  ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2025-01-15', 'Sales revenue — batch 1',        0.00, 820000.00, 'revenue',   false, NULL,        2),
  ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2025-01-20', 'Staff salary — 3 employees', 210000.00,       0.00, 'salary',    false, NULL,        3),
  ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2025-02-05', 'Generator fuel — Ikeja',      45000.00,       0.00, 'fuel',      false, NULL,        4),
  ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3', 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2025-02-18', 'Sales revenue — batch 2',        0.00, 650000.00, 'revenue',   false, NULL,        5)
ON CONFLICT DO NOTHING;


-- ============================================================
-- SECTION: GOALS
-- ============================================================

INSERT INTO public.goals (user_id, label, goal_type, limit_amount, current_spend, period, is_active, is_breached, breach_count)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Monthly Fuel Budget',    'expense_cap',     20000.00,   12000.00, 'monthly',  true,  false, 0),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Emergency Fund Target',  'savings_target', 500000.00,   50000.00, 'annual',   true,  false, 0),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Utility Cap',            'expense_cap',     30000.00,   15000.00, 'monthly',  true,  false, 0),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Rent Savings Buffer',    'savings_target', 200000.00,   60000.00, 'quarterly',true,  false, 0),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Q2 Revenue Target',      'revenue_target', 5000000.00, 820000.00, 'quarterly',true,  false, 0),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Monthly Profit Buffer',  'profit_buffer',  1000000.00, 110000.00, 'monthly',  true,  false, 0)
ON CONFLICT DO NOTHING;


-- ============================================================
-- SECTION: VAT_RECORDS (business user only)
-- ============================================================

INSERT INTO public.vat_records (user_id, period_label, period_start, period_end, output_vat, input_vat, filing_status, filing_deadline)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Q1 2025', '2025-01-01', '2025-03-31', 123000.00, 75000.00, 'ready',  '2025-04-21'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Q2 2025', '2025-04-01', '2025-06-30',  98000.00, 62000.00, 'filed',  '2025-07-21'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Q3 2025', '2025-07-01', '2025-09-30',  41000.00, 29000.00, 'draft',  '2025-10-21')
ON CONFLICT DO NOTHING;


-- ============================================================
-- SECTION: STATIONS (business user only)
-- ============================================================

INSERT INTO public.stations (user_id, station_name, station_code, monthly_budget, actual_spend, is_active)
VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Head Office',   'HQ-00',  1200000.00,  980000.00, true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Ikeja Branch',  'IKJ-01',  800000.00,  650000.00, true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Lekki Outlet',  'LEK-02',  600000.00,  590000.00, true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Abuja Depot',   'ABJ-03',  450000.00,       0.00, false)
ON CONFLICT DO NOTHING;


-- ============================================================
-- SECTION: VERIFICATION — confirm seed counts
-- ============================================================

SELECT 'profiles'    AS tbl, COUNT(*) FROM public.profiles    UNION ALL
SELECT 'audits',              COUNT(*) FROM public.audits      UNION ALL
SELECT 'transactions',        COUNT(*) FROM public.transactions UNION ALL
SELECT 'goals',               COUNT(*) FROM public.goals       UNION ALL
SELECT 'vat_records',         COUNT(*) FROM public.vat_records UNION ALL
SELECT 'stations',            COUNT(*) FROM public.stations
ORDER BY tbl;
