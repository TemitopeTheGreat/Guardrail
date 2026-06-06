# Guardrail Financial — Supabase Setup Guide

**For:** Non-technical founders  
**Time needed:** ~45 minutes  
**Prerequisite:** You have a Supabase account. If not, sign up at [supabase.com](https://supabase.com) (free tier is fine to start).

---

## Master Checklist

Work through this guide top to bottom. Tick each box as you go.

- [ ] 1. Create Supabase project
- [ ] 2. Run schema.sql
- [ ] 3. Run storage-setup.sql
- [ ] 4. Verify schema and storage
- [ ] 5. Configure email (SMTP)
- [ ] 6. Enable email confirmations
- [ ] 7. Set JWT expiry to 1 hour
- [ ] 8. Set up Google OAuth (optional but recommended)
- [ ] 9. Copy environment variables to Vercel
- [ ] 10. Run seed.sql (development only)

---

## Step 1 — Create Your Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. Click **New Project**.
3. Fill in:
   - **Name:** `guardrail-production` (or `guardrail-dev` for a test project)
   - **Database Password:** Generate a strong password and save it somewhere safe (e.g. 1Password). You will need this later.
   - **Region:** Choose the region closest to Nigeria. Currently the best option is **Europe West (eu-west-2)** — AWS Lagos is not yet available on Supabase free tier.
4. Click **Create new project** and wait 1–2 minutes for provisioning.

---

## Step 2 — Run schema.sql

This creates all 6 database tables, RLS policies, indexes, and the signup trigger.

1. In your Supabase project, go to the left sidebar → **SQL Editor**.
2. Click **New query**.
3. Open the file `supabase/schema.sql` from this project in a text editor (e.g. VS Code or Notepad).
4. Select all (Ctrl+A / Cmd+A) and copy the entire contents.
5. Paste it into the Supabase SQL editor.
6. Click **Run** (the green button, or press Ctrl+Enter).
7. You should see output like: `Success. No rows returned`.

**If you see an error**, read the error message:
- `relation "auth.users" does not exist` → You are running on the wrong project. Double-check the project name in the top-left dropdown.
- `policy already exists` → The schema was already run. This is safe; run the verification queries in the last section of schema.sql to confirm everything is correct.

---

## Step 3 — Run storage-setup.sql

This creates the two private file buckets (`raw-uploads` and `pdf-reports`).

1. In the SQL Editor, click **New query**.
2. Open `supabase/storage-setup.sql`, copy all contents, paste and run.
3. You should see: `Success. No rows returned`.

---

## Step 4 — Verify Everything Was Created

1. In the SQL Editor, run this query:

```sql
-- Tables with RLS enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Storage buckets
SELECT id, name, public FROM storage.buckets;
```

2. You should see all 6 tables with `rowsecurity = true`, and both storage buckets listed.

3. Go to the left sidebar → **Storage**. You should see `raw-uploads` and `pdf-reports` listed.

---

## Step 5 — Configure Email (SMTP)

Supabase's built-in email sender has a low rate limit (3 emails/hour on free tier). For a real product you need to connect your own email provider.

**Recommended free option: Resend (resend.com)**

1. Sign up at [resend.com](https://resend.com) and verify your domain (e.g. `guardrail.ng`).
2. Go to Resend dashboard → **API Keys** → Create a new API key. Copy it.
3. Back in Supabase, go to: **Project Settings → Authentication → SMTP Settings**.
4. Toggle **Enable Custom SMTP** to ON.
5. Fill in these fields:

| Field | Value |
|-------|-------|
| Sender name | Guardrail Financial |
| Sender email | noreply@guardrail.ng (use your verified domain) |
| Host | smtp.resend.com |
| Port | 465 |
| Username | resend |
| Password | *paste your Resend API key here* |

6. Click **Save**.
7. Click **Send test email** and verify it arrives in your inbox.

**Alternative SMTP providers:** Mailgun, SendGrid, Amazon SES — all work the same way. The host/port/credentials will differ; check their SMTP documentation.

---

## Step 6 — Enable Email Confirmations

1. Go to: **Authentication → Email Templates**.
2. Confirm the **Confirm signup** template is enabled (it is by default).
3. Go to: **Authentication → Providers → Email**.
4. Make sure these settings are configured:

| Setting | Value |
|---------|-------|
| Enable email provider | ON |
| Confirm email | ON |
| Secure email change | ON |

5. Click **Save**.

This ensures every new user must verify their email before they can log in. Critical for a financial app.

---

## Step 7 — Set JWT Expiry to 1 Hour

JWT tokens are the session tokens Supabase issues when a user logs in. Shorter expiry = better security.

1. Go to: **Authentication → Configuration → JWT Settings** (scroll down on the Authentication page).
2. Find the field **JWT expiry limit**.
3. Change the value to `3600` (this is 3600 seconds = 1 hour).
4. Click **Save**.

> **Why 1 hour?** If a token is stolen (e.g. from a compromised device), it becomes invalid after 1 hour maximum. Supabase automatically issues a new token via a refresh token when users are actively using the app — so legitimate users won't notice.

---

## Step 8 — Set Up Google OAuth (Recommended)

This lets users sign in with "Continue with Google" instead of creating a password.

### Part A: Create credentials in Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Create a new project called `Guardrail Financial` (or select an existing one).
3. Navigate to: **APIs & Services → OAuth consent screen**.
   - User type: **External**
   - App name: `Guardrail Financial`
   - User support email: your email
   - Developer contact email: your email
   - Click through the scopes step (add nothing extra)
   - Save and continue.
4. Navigate to: **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
   - Application type: **Web application**
   - Name: `Guardrail Supabase`
   - Under **Authorized redirect URIs**, click **Add URI** and paste:
     ```
     https://<your-project-ref>.supabase.co/auth/v1/callback
     ```
     Replace `<your-project-ref>` with your Supabase project reference ID. You can find this in Supabase under **Project Settings → General → Reference ID**.
5. Click **Create**. A popup shows your **Client ID** and **Client Secret**. Copy both — you won't see the secret again.

### Part B: Add credentials to Supabase

1. In Supabase, go to: **Authentication → Providers → Google**.
2. Toggle **Enable Google provider** to ON.
3. Paste your **Client ID** and **Client Secret** from Step A.
4. Copy the **Callback URL** shown in Supabase (it looks like `https://cskgpnmgsrkuexbucrqr.supabase.co/rest/v1/`) — confirm it matches what you added in Google Cloud.
5. Click **Save**.

### Part C: Add site URL

1. In Supabase, go to: **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel production URL (e.g. `https://guardrail.ng`).
3. Under **Redirect URLs**, add:
   - `https://guardrail.ng/**`
   - `http://localhost:3000/**` (for local development)
4. Click **Save**.

---

## Step 9 — Copy Environment Variables to Vercel

Your frontend needs two Supabase values. Never put the service role key in the frontend.

### Finding your keys

In Supabase go to: **Project Settings → API**

| Key | Where to find it | Used in |
|-----|-----------------|---------|
| Project URL | `https://cskgpnmgsrkuexbucrqr.supabase.co/rest/v1/` | Frontend + Backend |
| `anon` public key | Under "Project API keys" | Frontend (safe to expose) |
| `service_role` key | Under "Project API keys" | Backend only — NEVER expose |

### Setting them in Vercel

1. Open your project in [vercel.com](https://vercel.com).
2. Go to: **Settings → Environment Variables**.
3. Add the following:

| Variable name | Value | Environments |
|---------------|-------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://cskgpnmgsrkuexbucrqr.supabase.co/rest/v1/` | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key | Production, Preview, Development |
| `SUPABASE_SERVICE_ROLE_KEY` | your service_role key | Production, Preview only |

> **Security rule:** Any variable starting with `NEXT_PUBLIC_` is visible in the browser. The `SUPABASE_SERVICE_ROLE_KEY` must NEVER start with `NEXT_PUBLIC_` and must NEVER appear in any client-side file.

---

## Step 10 — Run seed.sql (Development Only)

This populates 3 test users and sample data so you can see the dashboard working before real users sign up.

**Only do this in a development/staging project — never production.**

1. First, create the 3 test Auth users manually:
   - Go to: **Authentication → Users → + Add user → Create new user**
   - Create each user with these emails (password can be anything):
     - `adewale.test@guardrailtest.dev`
     - `ngozi.test@guardrailtest.dev`
     - `apex.test@guardrailtest.dev`
   - **Important:** After creating each user, click on it and copy its User UID. You need to confirm these match the UUIDs in seed.sql (`aaa...`, `bbb...`, `ccc...`).
   
   > **Note:** Supabase assigns its own UUIDs. The seed.sql file uses fixed UUIDs. You have two options:
   > - **Option A (easier):** Edit seed.sql to replace `aaa...`, `bbb...`, `ccc...` with the real UUIDs Supabase assigned.
   > - **Option B:** Use the Supabase Admin API to create users with specific UUIDs (requires a short script).

2. Once Auth users exist with matching UUIDs, go to the SQL Editor, run `seed.sql`.
3. Verify data was inserted by running the verification query at the bottom of seed.sql.

---

## Troubleshooting

**"JWT expired" errors in the browser**  
→ Check that JWT expiry is set to `3600` and that your frontend is calling `supabase.auth.getSession()` on each page load to refresh the token.

**Users can see each other's data**  
→ RLS is not enabled, or the policy is wrong. Re-run schema.sql. Check pg_tables for `rowsecurity = true`.

**Google OAuth redirects to the wrong URL**  
→ Confirm the redirect URI in Google Cloud Console exactly matches your Supabase callback URL. Copy-paste, do not type manually.

**Emails not sending**  
→ Check the SMTP credentials in Authentication → SMTP Settings. On the free Supabase tier without custom SMTP, you are limited to 3 emails/hour.

**"new row violates row-level security policy"**  
→ The user's JWT is not being passed in the request, or the `user_id` field in the INSERT doesn't match `auth.uid()`. Make sure you're using the Supabase client (not raw fetch) and the user is logged in.

**File upload fails for storage**  
→ Confirm the file path starts with `{user_id}/`. The storage policy rejects any path whose first folder segment doesn't equal the authenticated user's UUID.
