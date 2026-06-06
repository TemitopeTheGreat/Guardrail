# Phase 2 — Auth Layer Test Checklist

Manual verification checklist for the Guardrail Financial authentication layer.
Run these tests after deploying to a server or Vercel (file:// URLs won't support OAuth redirects).

## Authentication Flows

- [ ] Individual signup completes and sends confirmation email
- [ ] Business signup completes and sends confirmation email
- [ ] Confirmed individual user logs in and lands on `/dashboard/individual.html`
- [ ] Confirmed business user logs in and lands on `/dashboard/business.html`
- [ ] Wrong password shows plain-English error ("Email or password is incorrect."), not the raw Supabase error string
- [ ] Unconfirmed email shows the correct "Please check your inbox and confirm your email first." message
- [ ] Forgot password sends a reset email and shows inline "Reset link sent to your inbox." confirmation
- [ ] Logged-in user visiting `index.html` is redirected to their dashboard immediately
- [ ] Logged-out user visiting `dashboard/individual.html` is redirected to `login.html`
- [ ] Logged-out user visiting `dashboard/business.html` is redirected to `login.html`
- [ ] Sign out button on each dashboard returns the user to `login.html`
- [ ] Google sign-in routes correctly based on `account_type` in the profiles table
- [ ] New Google user with no profile row sees the account type selector modal in `auth-callback.html`

## Form Validation — Signup

- [ ] Individual form shows inline field-level errors (red text below each field) for missing required fields
- [ ] Business form shows inline field-level errors for missing required fields
- [ ] Password strength bar updates in real-time as the user types: red (weak), amber (fair), emerald (strong)
- [ ] Submit button is visually disabled (opacity-50, cursor-not-allowed) until the terms checkbox is ticked
- [ ] After ticking the terms checkbox, submit button becomes fully active
- [ ] Double-submit is prevented — button is disabled while the Supabase `signUp()` call is in flight

## Form Validation — Login

- [ ] Empty email field shows client-side validation error
- [ ] Login button is disabled + shows spinner while `signInWithPassword` is in flight
- [ ] Re-enabled (and error shown) after a failed login attempt

## URL Parameter Handling

- [ ] Visiting `login.html?error=auth_failed` shows the "Sign-in failed or link expired." banner

## Auth Callback

- [ ] Email confirmation link (`?token=...&type=signup`) processed by `auth-callback.html` → redirects to correct dashboard
- [ ] Google OAuth redirect lands on `auth-callback.html` and routes to the correct dashboard
- [ ] `auth-callback.html` with no valid session after 3 seconds redirects to `login.html?error=auth_failed`
- [ ] New Google user modal: selecting "Individual" inserts a profile row with `account_type = 'individual'` and redirects
- [ ] New Google user modal: selecting "Business" inserts a profile row with `account_type = 'business'` and redirects

## Edge Cases

- [ ] Attempting to register with an already-registered email shows a translated error
- [ ] Signing up with a password shorter than 8 characters shows strength bar as red (weak)
- [ ] Submitting signup with weak password is blocked by client-side validation

## Test Accounts (from `supabase/seed.sql`)

These accounts have `email_confirmed_at` set and can log in directly.

| Name | Email | Password | Type |
|------|-------|----------|------|
| Adewale Balogun | adewale.test@guardrailtest.dev | TestPass123! | individual |
| Ngozi Okafor | ngozi.test@guardrailtest.dev | TestPass123! | individual |
| Chidi Eze (Apex Ventures) | apex.test@guardrailtest.dev | TestPass123! | business |

## Environment Setup Reminder

Before testing, replace both placeholders in `js/auth.js`:

```
SUPABASE_URL    → your project URL from Supabase dashboard
SUPABASE_ANON_KEY → your anon/public key from Supabase dashboard
```

The anon key is safe to include in frontend files. Never include the `service_role` key.
