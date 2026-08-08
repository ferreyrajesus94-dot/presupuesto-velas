/**
 * PR2.auth-core (Task 2.11) — `ownerEnv.ts` is now a thin re-export shim.
 *
 * `src/server/auth/session.ts` is locked byte-identical (SESSION-PRESERVE
 * invariant — see `tests/integration/session-preserve.test.ts`) and still
 * imports `getNeonAuthBaseUrl` from this file path. The allowlist helpers
 * The allowlist env readers were retired with the legacy single-owner
 * guard (deleted in Task 2.11); the auth-era env readers live in
 * `userEnv.ts`.
 *
 * This shim is deleted by PR5.archive once `session.ts` is no longer
 * byte-identical and can import from `userEnv` directly.
 */
export { getNeonAuthBaseUrl } from "./userEnv";