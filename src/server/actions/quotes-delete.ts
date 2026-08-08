"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth/requireUser";
import { deleteQuoteDraft } from "../repositories/quotes";

/**
 * PR2.auth-core (Task 2.8) — `deleteQuoteDraftAction` rewritten for the
 * user era. Uses `requireUser()` so a verified Neon Auth signer (any role)
 * can delete a draft they own. The repository enforces user scope +
 * draft-only status; terminal (`accepted` / `rejected`) and `sent` quotes
 * are rejected as `TERMINAL_STATUS`.
 */
export async function deleteQuoteDraftAction(quoteId: string) {
  const user = await requireUser();
  const result = await deleteQuoteDraft(user.id, quoteId);
  if (result.ok) {
    revalidatePath("/quotes");
    return result;
  }
  return result;
}