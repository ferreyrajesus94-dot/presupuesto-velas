import "server-only";
import { requireUser, type AuthenticatedUser } from "./requireUser";

/**
 * PR2.auth-core — reserved `requireRole` guard. No consumer in v1, but the
 * spec scenario under REQUIREMENT: ROLE-MODEL ("Unset env + reserved guard
 * test") requires a passing test asserting the failed-access path. PR4
 * uses this guard in the route-guard contract test for hypothetical admin
 * routes.
 *
 * Contract:
 *   - authenticated + `role === required` → return the `AuthenticatedUser`.
 *   - authenticated + `role !== required` → throw `UnauthorizedError` (typed).
 *   - unauthenticated                    → redirect to `/sign-in` (delegates
 *     to `requireUser`'s redirect semantics; do not introduce a second path).
 */

export class UnauthorizedError extends Error {
  constructor(
    readonly role: "owner" | "user" | "unknown",
    readonly required: "owner",
    message?: string,
  ) {
    super(
      message ??
        `Forbidden: this action requires role "${required}", but the caller has role "${role}".`,
    );
    this.name = "UnauthorizedError";
  }
}

export type RequiredRole = "owner";

export async function requireRole(required: RequiredRole): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (user.role !== required) {
    throw new UnauthorizedError(user.role, required);
  }
  return user;
}
