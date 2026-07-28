"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { requireOwner } from "../auth/requireOwner";
import { deleteQuoteDraft } from "../repositories/quotes";

/**
 * PR4h — Delete a draft quote and revalidate the list. The repository
 * enforces owner scope + draft-only status; terminal (`accepted` /
 * `rejected`) and `sent` quotes are rejected as `TERMINAL_STATUS`.
 */
export async function deleteQuoteDraftAction(quoteId: string) {
  const owner = await requireOwner();
  const result = await deleteQuoteDraft(owner.id, quoteId);
  if (result.ok) {
    revalidatePath("/quotes");
    return result;
  }
  return result;
}
