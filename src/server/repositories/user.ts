import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { appUser, type AppUser } from "../../../db/schema";
import { getBootstrapOwnerEmail } from "../auth/userEnv";

/**
 * PR2.auth-core — user repository. Replaces the singleton `app_owner`
 * CRUD from `src/server/repositories/owner.ts` (kept as a backwards-compat
 * shim for PR2; PR2.2 deletes it). Every write here is keyed by the
 * Neon Auth id so `requireUser()` can centralize the upsert atomically.
 *
 * Promotion rule (SPEC: REQUIREMENT ROLE-MODEL, scenarios
 * "Bootstrap promotion + idempotent re-promotion" and "Unset env + reserved
 * guard test"):
 *   - When `email === BOOTSTRAP_OWNER_EMAIL` AND `emailVerified === true`,
 *     the upsert lands with `role='owner'`.
 *   - Otherwise `role='user'`.
 *   - `requestedRole` is honored ONLY when the email matches the bootstrap
 *     env (defense against caller-supplied privilege escalation).
 *
 * Idempotency:
 *   - `onConflictDoUpdate` keyed on `id`. Re-running the action with the
 *     same Neon Auth id + email preserves `role` (we never downgrade an
 *     owner; we never upgrade a non-owner except via the bootstrap rule).
 */

export async function getUser(id: string): Promise<AppUser | null> {
  const rows = await db.select().from(appUser).where(eq(appUser.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const rows = await db.select().from(appUser).where(eq(appUser.email, email)).limit(1);
  return rows[0] ?? null;
}

function resolveRole(input: {
  email: string;
  emailVerified: boolean;
  requestedRole?: "owner";
}): "owner" | "user" {
  const bootstrap = getBootstrapOwnerEmail();
  if (
    input.emailVerified &&
    bootstrap !== null &&
    input.email.toLowerCase() === bootstrap.toLowerCase() &&
    input.requestedRole === "owner"
  ) {
    return "owner";
  }
  return "user";
}

export type UpsertUserInput = {
  id: string;
  email: string;
  emailVerified: boolean;
  requestedRole?: "owner";
};

export async function upsertUser(input: UpsertUserInput): Promise<AppUser> {
  const role = resolveRole(input);
  const [row] = await db
    .insert(appUser)
    .values({
      id: input.id,
      email: input.email,
      role,
      emailVerified: input.emailVerified,
    })
    .onConflictDoUpdate({
      target: appUser.id,
      set: {
        email: input.email,
        emailVerified: input.emailVerified,
      },
    })
    .returning();
  if (!row) {
    throw new Error(`upsertUser: failed to upsert app_user row for id ${input.id}`);
  }
  return row;
}
