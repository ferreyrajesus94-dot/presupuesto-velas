import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/requireUser";

/**
 * PR2.auth-core (Task 2.8) — `/api/auth/session` route rewritten for the
 * user era. Returns the authenticated user's id + email (no role leak);
 * role is internal-only and surfaces through `requireRole()` guards in
 * admin contexts. Verified Neon Auth signers get an `app_user` row
 * upserted atomically by `requireUser()` on first call.
 */
export async function GET() {
  const user = await requireUser();
  return NextResponse.json({ id: user.id, email: user.email });
}