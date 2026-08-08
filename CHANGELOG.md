# Changelog

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
