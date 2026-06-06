-- Guardrail Financial
-- File: schema.sql
-- Run in: Supabase SQL Editor (Settings > SQL Editor)
-- WARNING: Review RLS policies before running in production

-- ============================================================
-- SECTION: Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- SECTION: TABLE 1 — profiles
-- One row per user. Auto-created by the handle_new_user trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id               uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name        text        NOT NULL,
  account_type     text        NOT NULL CHECK (account_type IN ('individual', 'business')),
  business_name    text,
  rc_number        text,
  industry_sector  text,
  plan_tier        text        NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro', 'enterprise')),
  onboarding_done  boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: select own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles: insert own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: update own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: delete own"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);


-- ============================================================
-- SECTION: Helper Function — get_my_account_type()
-- Defined here (after profiles table) because LANGUAGE sql
-- functions validate table references at creation time.
-- SECURITY DEFINER runs as the function owner, bypassing RLS
-- on the profiles read so business-table policies work cleanly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_account_type()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_type FROM public.profiles WHERE id = auth.uid();
$$;


-- ============================================================
-- SECTION: TABLE 2 — audits
-- One row per file upload / audit run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audits (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  file_name        text        NOT NULL,
  file_path        text        NOT NULL,
  file_size_bytes  bigint,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  audit_score      numeric(5,2),
  total_rows       integer,
  error_count      integer     DEFAULT 0,
  duplicate_count  integer     DEFAULT 0,
  balance_valid    boolean,
  report_url       text,
  account_type     text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audits: select own"
  ON public.audits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "audits: insert own"
  ON public.audits FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "audits: update own"
  ON public.audits FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "audits: delete own"
  ON public.audits FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- SECTION: TABLE 3 — transactions
-- Individual rows extracted from an uploaded file post-cleaning.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.transactions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id         uuid        NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  txn_date         date,
  description      text,
  debit            numeric(15,2) DEFAULT 0,
  credit           numeric(15,2) DEFAULT 0,
  category         text,
  is_flagged       boolean     DEFAULT false,
  flag_reason      text,
  row_number       integer,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions: select own"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "transactions: insert own"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transactions: update own"
  ON public.transactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "transactions: delete own"
  ON public.transactions FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- SECTION: TABLE 4 — goals
-- Financial guardrails for both individual and business users.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.goals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label            text        NOT NULL,
  goal_type        text        NOT NULL
                               CHECK (goal_type IN ('expense_cap', 'savings_target',
                                                    'revenue_target', 'profit_buffer')),
  limit_amount     numeric(15,2) NOT NULL,
  current_spend    numeric(15,2) NOT NULL DEFAULT 0,
  currency         text        NOT NULL DEFAULT 'NGN',
  period           text        NOT NULL DEFAULT 'monthly'
                               CHECK (period IN ('weekly', 'monthly', 'quarterly', 'annual')),
  is_active        boolean     NOT NULL DEFAULT true,
  is_breached      boolean     NOT NULL DEFAULT false,
  breach_count     integer     NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "goals: select own"
  ON public.goals FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "goals: insert own"
  ON public.goals FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "goals: update own"
  ON public.goals FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "goals: delete own"
  ON public.goals FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- SECTION: TABLE 5 — vat_records  [BUSINESS ACCOUNTS ONLY]
-- VAT filing periods and computed net payable.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vat_records (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_label     text        NOT NULL,
  period_start     date        NOT NULL,
  period_end       date        NOT NULL,
  output_vat       numeric(15,2) NOT NULL DEFAULT 0,
  input_vat        numeric(15,2) NOT NULL DEFAULT 0,
  net_vat_payable  numeric(15,2) GENERATED ALWAYS AS (output_vat - input_vat) STORED,
  filing_status    text        NOT NULL DEFAULT 'draft'
                               CHECK (filing_status IN ('draft', 'ready', 'filed', 'overdue')),
  filing_deadline  date,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vat_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vat_records: select own business"
  ON public.vat_records FOR SELECT
  USING (auth.uid() = user_id AND get_my_account_type() = 'business');

CREATE POLICY "vat_records: insert own business"
  ON public.vat_records FOR INSERT
  WITH CHECK (auth.uid() = user_id AND get_my_account_type() = 'business');

CREATE POLICY "vat_records: update own business"
  ON public.vat_records FOR UPDATE
  USING  (auth.uid() = user_id AND get_my_account_type() = 'business')
  WITH CHECK (auth.uid() = user_id AND get_my_account_type() = 'business');

CREATE POLICY "vat_records: delete own business"
  ON public.vat_records FOR DELETE
  USING (auth.uid() = user_id AND get_my_account_type() = 'business');


-- ============================================================
-- SECTION: TABLE 6 — stations  [BUSINESS ACCOUNTS ONLY]
-- Multi-branch / department expense tracking.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.stations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  station_name     text        NOT NULL,
  station_code     text,
  monthly_budget   numeric(15,2) NOT NULL DEFAULT 0,
  actual_spend     numeric(15,2) NOT NULL DEFAULT 0,
  variance         numeric(15,2) GENERATED ALWAYS AS (monthly_budget - actual_spend) STORED,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stations: select own business"
  ON public.stations FOR SELECT
  USING (auth.uid() = user_id AND get_my_account_type() = 'business');

CREATE POLICY "stations: insert own business"
  ON public.stations FOR INSERT
  WITH CHECK (auth.uid() = user_id AND get_my_account_type() = 'business');

CREATE POLICY "stations: update own business"
  ON public.stations FOR UPDATE
  USING  (auth.uid() = user_id AND get_my_account_type() = 'business')
  WITH CHECK (auth.uid() = user_id AND get_my_account_type() = 'business');

CREATE POLICY "stations: delete own business"
  ON public.stations FOR DELETE
  USING (auth.uid() = user_id AND get_my_account_type() = 'business');


-- ============================================================
-- SECTION: TRIGGER — handle_new_user()
-- Fires AFTER INSERT on auth.users. Reads signup metadata
-- (full_name, account_type, business_name) and creates a
-- matching row in public.profiles automatically.
-- Frontend never needs a separate "create profile" call.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, account_type, business_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'account_type', 'individual'),
    NEW.raw_user_meta_data->>'business_name'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- SECTION: INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_audits_user_id        ON public.audits(user_id);
CREATE INDEX IF NOT EXISTS idx_audits_status         ON public.audits(status);
CREATE INDEX IF NOT EXISTS idx_transactions_audit_id ON public.transactions(audit_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id  ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_flagged  ON public.transactions(is_flagged) WHERE is_flagged = true;
CREATE INDEX IF NOT EXISTS idx_goals_user_active     ON public.goals(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_vat_records_user_id   ON public.vat_records(user_id);
CREATE INDEX IF NOT EXISTS idx_stations_user_id      ON public.stations(user_id);


-- ============================================================
-- SECTION: VERIFICATION QUERIES
-- Run these after executing the schema to confirm everything
-- was created correctly. No changes made — read-only checks.
-- ============================================================

-- 1. Confirm all 6 tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('profiles','audits','transactions','goals','vat_records','stations')
ORDER BY table_name;

-- 2. Confirm RLS is enabled on every table (rowsecurity = true)
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('profiles','audits','transactions','goals','vat_records','stations')
ORDER BY tablename;

-- 3. Count RLS policies per table (each table should have 4)
SELECT tablename, COUNT(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- 4. Confirm helper function and trigger function exist
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_my_account_type', 'handle_new_user')
ORDER BY routine_name;

-- 5. Confirm trigger is attached to auth.users
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- 6. Confirm indexes exist
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
