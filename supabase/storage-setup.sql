-- Guardrail Financial
-- File: storage-setup.sql
-- Run in: Supabase SQL Editor (Settings > SQL Editor)
-- WARNING: Review RLS policies before running in production
--
-- NOTE: This file creates two private storage buckets and their
-- RLS policies. Run AFTER schema.sql.
-- The storage.objects table already has RLS enabled by Supabase.


-- ============================================================
-- SECTION: BUCKET 1 — raw-uploads
-- Private. Stores CSV/Excel files uploaded by users.
-- Path convention: {user_id}/{audit_id}/{original_filename}
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'raw-uploads',
  'raw-uploads',
  false,
  10485760,  -- 10 MB
  ARRAY[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ============================================================
-- SECTION: BUCKET 2 — pdf-reports
-- Private. Stores generated audit report PDFs.
-- Path convention: {user_id}/{audit_id}/report.pdf
-- Written server-side via SERVICE_ROLE_KEY. No INSERT policy
-- for authenticated users — Vercel edge functions write these.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pdf-reports',
  'pdf-reports',
  false,
  10485760,  -- 10 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ============================================================
-- SECTION: RLS POLICIES — raw-uploads
-- Users can upload, read, and delete only under their own
-- user_id folder. split_part(name, '/', 1) extracts the first
-- segment of the storage path, which must equal auth.uid().
-- ============================================================

CREATE POLICY "raw-uploads: authenticated upload to own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'raw-uploads'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "raw-uploads: authenticated read own files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'raw-uploads'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "raw-uploads: authenticated update own files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'raw-uploads'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "raw-uploads: authenticated delete own files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'raw-uploads'
    AND split_part(name, '/', 1) = auth.uid()::text
  );


-- ============================================================
-- SECTION: RLS POLICIES — pdf-reports
-- Users can only READ (download) reports under their own folder.
-- No INSERT policy — reports are written server-side via the
-- SERVICE_ROLE_KEY which bypasses RLS entirely.
-- ============================================================

CREATE POLICY "pdf-reports: authenticated read own reports"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pdf-reports'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

-- No INSERT/UPDATE policy for authenticated role on pdf-reports.
-- Vercel edge functions write PDFs using the service_role key.


-- ============================================================
-- SECTION: VERIFICATION QUERIES
-- ============================================================

-- 1. Confirm both buckets exist
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('raw-uploads', 'pdf-reports');

-- 2. Count storage RLS policies per bucket
SELECT
  policyname,
  cmd,
  roles
FROM pg_policies
WHERE tablename = 'objects'
  AND schemaname = 'storage'
ORDER BY policyname;
