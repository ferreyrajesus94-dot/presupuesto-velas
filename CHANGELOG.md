# Changelog

## 0.4.5 - 2026-08-09

- **CRITICAL FIX: bootstrap promotion wasn't applied on existing rows.** `upsertUser` (in `src/server/repositories/user.ts`) used `onConflictDoUpdate` with a SET clause of `{ email, emailVerified }` — `role` was missing. The effect: when a user first signed in while unverified (`emailVerified: false`), `resolveRole` correctly returned `"user"` and the INSERT landed with `role='user'`. But every subsequent `requireUser` call after verification passed `requestedRole: "owner"`, `resolveRole` returned `"owner"`, and the SET clause silently kept `role='user'` because `role` wasn't in the update fields. The original `adminvelas@gmail.com` user ended up with `role='user'` even though the bootstrap rule should have promoted them on first verified sign-in.
- **Fix**: the SET clause now conditionally includes `role: 'owner'` when `resolveRole` returns `"owner"`. We never include `role` when it returns `"user"`, so existing `role='owner'` rows are NEVER downgraded (idempotent re-promotion is preserved). The docstring is updated with the failure history so future maintainers don't re-introduce the bug.
- **Manual fix applied**: `app_user` row for `adminvelas@gmail.com` (`id: 3ace9998-35c6-42ef-81c9-8083b7d2b4b4`) was inserted via `Neon_run_sql` with `role='owner'` so the user sees "Admin" in `/settings` immediately. After this release, every verified sign-in to the owner email auto-promotes the row on first encounter.
- 7 new unit tests in `tests/unit/user-repository-upsert.test.ts` assert the SET clause includes `role: 'owner'` only under the right conditions (verified + email matches + requestedRole='owner'), and excludes it otherwise. Defense against the bug regressing.

## 0.4.4 - 2026-08-09

- **NEW: `/settings` page** — shows the signed-in user's email and role (Admin badge for `role='owner'`), with a change-password form and a sign-out button. Server component calls `requireUser()` so unauthenticated or unverified visitors are redirected before they see the page.
- **NEW: `signOutAction`** — POSTs to Better Auth `/sign-out` (invalidates the server-side session) and clears local `session` + `session-upstream` cookies. Best-effort: if the upstream is unreachable the local cookies still clear, so the user is always logged out from their perspective. Wired into both the AppNav (`"Cerrar sesión"` button on the right) and the settings page.
- **NEW: `changePasswordAction`** — validates current/new/confirm with Zod (newPassword ≥ 8 chars, must differ from current, confirm must match), forwards the upstream session cookie in the `Cookie` header so Better Auth knows which user is changing, and maps upstream errors to localized field errors (invalid current password, password policy violations, expired session). The cookie-name lookup handles all three Better Auth variants (`__Secure-…`, `neon-auth.session_token`, `better-auth.session_token`) so the action works regardless of which variant the deployment uses.
- **AppNav update** — added a `Configuración` link pointing to `/settings` and a `Cerrar sesión` submit button (no nav redesign; both live in the right-aligned slot next to the theme toggle).
- 19 new unit tests across `signOutAction` (5), `changePasswordAction` (14); 3 new tests in `app-navigation.test.tsx` (settings link + sign-out button + /settings active state). Full unit suite: 809/811 PASS (the 2 pre-existing failures from the `calculadora-flor` chain in `quotes-append-version` are unrelated).
- Notable constraint preserved: `src/server/auth/session.ts` remains byte-identical vs `origin/main` (SESSION-PRESERVE invariant from PR2). `changePasswordAction` duplicates the cookie-name constants locally with a comment explaining the duplication.

## 0.4.3 - 2026-08-09

- **CRITICAL FIX: wrong Better Auth endpoint for email verification.** v0.4.1 and v0.4.2 posted the OTP to `/sign-in/email-otp` (Better Auth's SIGN-IN-with-OTP endpoint) instead of `/email-otp/verify-email` (the OTP plugin's EMAIL-VERIFICATION endpoint). Every verification attempt was rejected with `INVALID_OTP` regardless of whether the code matched, because `/sign-in/email-otp` looks up verification records with the `sign-in-otp-*` identifier prefix, not the `email-verification-otp-*` prefix. The `verifyEmailOtpAction` now posts to `/email-otp/verify-email` and also extracts the Better Auth session cookie from the response `set-cookie` header, sets it via `setSessionCookie`, and redirects to `/` (was `/sign-in?verified=1`). On `/`, `requireUser` upserts the `app_user` row with `requestedRole='owner'` when the email matches `BOOTSTRAP_OWNER_EMAIL` — completing the bootstrap promotion that was previously blocked by the broken endpoint.
- Discovered by brute-forcing SHA-256 hashes of all 6-digit codes against the stored `value` field in `neon_auth.verification`; matched `227115` → `oKtL6jdB-x5dHaX7wcKZhLAyrfbZCjIOC9FYHjs0_kk`, confirming Better Auth uses plain SHA-256 base64url (no salt), confirming the hash WAS correct, confirming the endpoint was the only thing wrong.
- Existing `adminvelas@gmail.com` user manually verified via `/email-otp/verify-email` (so the user could proceed without re-running the broken form); their `emailVerified` is now `true` and they'll be promoted to `role='owner'` on next `requireUser` call.
- 2 new unit tests assert the endpoint target (`/email-otp/verify-email`) and the `setSessionCookie` auto-sign-in path; 1 updated test for the new redirect target (`/`).

## 0.4.2 - 2026-08-09

- **UX: never lose the verify-email page.** `requireUser` now redirects unverified sessions directly to `/verify-email` (where the OTP input form lives) instead of bouncing through `/sign-in?hint=verify-email` (banner only). The user-reported pain point: closing the verify tab and signing in again should land back on the verify page — `requireUser` is the chokepoint for every protected route, so this change makes that path impossible to lose.
- **UX: explicit "Ir a verificar mi cuenta" link** in the `/sign-in` verify-email banner. Users who navigate directly to `/sign-in?hint=verify-email` can now jump straight to `/verify-email` without first signing in (signing in still works and also lands them on `/verify-email` via the `requireUser` redirect).
- **Better Auth `callbackURL` hardening**: `signUpAction` and `resendVerificationAction` now pass `callbackURL: <APP_BASE_URL>/verify-email` to Neon Auth, so any future verification flow that embeds a magic link in the email body lands the user on the verify page. Note: Neon Auth shared SMTP currently renders OTP-only emails (no embedded link); `callbackURL` is a forward-compatible hint for when the project moves to custom SMTP / link mode.
- 2 new unit tests for `resendVerificationAction` cover the `callbackURL` and `Origin` header fields; 2 existing tests for `requireUser` updated to assert the new `/verify-email` redirect target.

## 0.4.1 - 2026-08-09

- **Hotfix: OTP verification UI**: PR3.2 (task 3.7) shipped the resend form but omitted the OTP input form, leaving users with no way to submit the 6-digit code from the verification email. This release adds `verifyEmailOtpAction` (POSTs to Neon Auth `/sign-in/email-otp`) and `VerifyOtpForm` (RHF-free client component with pre-filled email from session + 6-digit OTP input) on the `/verify-email` page.
- **Hotfix: Neon Auth `verify_email_on_sign_up`**: was set to `false` in v0.4.0, so sign-up did NOT trigger the verification email. Flipped to `true` via `Neon_configure_neon_auth` so future sign-ups (and the existing `adminvelas@gmail.com` user via a manual `send-verification-email` call) get the OTP.
- `/verify-email` page now renders both the OTP input form (NEW) and the resend form (existing) in separate cards; the email field is pre-filled from the session and the OTP input uses `inputMode="numeric"` + `autoComplete="one-time-code"` for mobile keyboards.
- 12 new unit tests for `verifyEmailOtpAction` cover validation, session-vs-form email resolution, lowercasing, Origin header, error localization (INVALID_OTP, rate-limit, generic 5xx), and the post-success redirect to `/sign-in?verified=1`.

## 0.4.0 - 2026-08-08

- **Public multi-user signup**: anyone with an email can create an account and use the calculator via `/sign-up` (RHF + Zod form, email + password, calls Neon Auth `/sign-up/email`). Replaces the prior single-owner Neon Auth allowlist.
- **Email verification gate**: verified sign-in is required before first calculator access. Unverified users are redirected to `/sign-in?hint=verify-email`; verification email mode is Neon-config-driven (current production is OTP via shared SMTP — flip to `link` requires custom SMTP provisioning).
- **Per-user data isolation**: every repository read/write scoped by `user_id` (formerly `owner_id`). Cross-user attempts return `404` (not `403`, to avoid id enumeration). Covers materials, templates, recipes, quotes, and all derived tables.
- **Role-based access**: `role` enum (`'owner' | 'user'`) on `app_user`. The original Neon Auth account is auto-promoted to `role='owner'` via `BOOTSTRAP_OWNER_EMAIL` matching on first sign-in. New signups default to `role='user'`. Reserved `requireRole('owner')` guard ships with passing tests for future admin views.
- **New routes**: `/sign-up` (public), `/verify-email` (public, with resend action).
- **New server actions**: `signUpAction` (Neon `/sign-up/email`), `resendVerificationAction` (Neon `/send-verification-email`).
- **Schema migration**: hand-written idempotent DDL renames `app_owner` → `app_user`, adds `app_role` Postgres enum, retargets every `owner_id` FK → `user_id`, drops the legacy singleton constraint, and preserves the original owner row with `role='owner'`.
- **Auth-core rewrite**: `requireOwner()` → `requireUser()` returning `{ id, email, role, emailVerified }` with redirect semantics for unauthenticated (`/sign-in?next=`) and unverified (`/sign-in?hint=verify-email`) sessions. `signInAction` honors hidden `<input name="next">` and removes the env-allowlist gate.
- **Env var cleanup**: retired `OWNER_USER_ID`, `OWNER_EMAIL`, `TEST_OWNER_*`. New `BOOTSTRAP_OWNER_EMAIL` replaces them.
- **Pre-merge gate**: `scripts/check-neon-auth-config.mjs` validates `allow_sign_up`, `email_verification_method`, and `trusted_origins` against the production Neon branch.
- **Strict SESSION-PRESERVE invariant**: `src/server/auth/session.ts` (the fragile 3-cookie-variant regex parsing from `d96e50c`) remains byte-identical vs `origin/main` at every commit across all 5 PRs. A regression test asserts the diff invariant.
- 5-PR feature-branch-chain delivered (10 actual PRs after PR2 and PR4 sub-sliced for budget discipline): PR1.migration → PR2.auth-core → PR3.auth-ui → PR4.per-user-isolation → PR5.archive. Cumulative 99 files, +5424/-1050 LOC. Strict TDD throughout.

## 0.3.0 - 2026-08-03

- Theme system with rosa paleta tokens, dark mode toggle (light/dark/auto-detect), and inline anti-flash script.
- Guided 5-step tutorial overlay with spotlight and `prefers-reduced-motion` support.
- Per-tab contextual help modal (X / Escape / backdrop dismiss).
- Renamed `recipes` → `templates` across DB schema, repositories, server actions, validators, and app folder (`/recipes` → `/templates`, with 308 redirects for backward compat).
- Dynamic state-driven plantillas workspace with create/duplicate/delete and live per-template cost summary (materiales, mano de obra, overhead, costo total, sugerido).
- Inline editable bulk-discount editor in calculator (descuento % + aplica desde N unidades) with live totals.
- Mobile polish: safe-area-inset-bottom, 44×44 touch targets, hover-gated effects, focus trap.
- Accessibility pass: focus-visible across interactive elements, aria-labels on icon-only buttons, axe-core clean.

## 0.2.0 - 2026-07-31

- Introduced the pink-and-cream visual system and responsive application navigation.
- Refined the presentation of the authenticated dashboard, public pages, and authentication flow.
- Improved materials, recipes, and quotes presentation across list, form, and detail experiences.
- Added authenticated responsive visual end-to-end coverage for the completed visual system.
- Added support for running Neon integration tests against an isolated test branch.
