import { parseStrictDecimal } from "./decimal";
import { InvariantError } from "./quoteDeposit";
import type { QuoteSnapshot } from "./quote";

/**
 * Lifecycle status for a quote snapshot.
 *
 * - `draft` — editable, never expired.
 * - `sent` — editable until the customer responds; expires past `expirationDate`.
 * - `accepted` — terminal, immutable, never expires.
 * - `rejected` — terminal, immutable, never expires.
 * - `expired` — derived for `sent` past `expirationDate`; never stored.
 */
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

/**
 * True when the status has reached a terminal state — `accepted` or `rejected`.
 * Terminal quotes are immutable; further mutation must come through duplication
 * (PR4i). Pure, no I/O.
 */
export function verifyTerminalStatus(status: QuoteStatus): boolean {
  return status === "accepted" || status === "rejected";
}

/** Alias matching the spec language (`accepted or rejected never become expired`). */
export const isAcceptedOrRejected = verifyTerminalStatus;

/**
 * Returns a deeply-frozen copy suitable for persistence. Currently delegates
 * to recursive `Object.freeze` after a `structuredClone`; this is the seam
 * where a custom serializer can land later without churning callers.
 */
export function freezeForStorage<T>(value: T): T {
  const copy = structuredClone(value);
  return deepFreeze(copy);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Defensive sanity check for a quote snapshot — total equals
 * `materials + indirect + profit` and `deposit ≤ total`. Throws
 * `InvariantError` on violation. Should pass for any well-formed snapshot
 * produced by `buildQuoteSnapshot`.
 */
export function assertSnapshotInvariants(snapshot: QuoteSnapshot): void {
  const total = parseStrictDecimal(snapshot.total);
  const materials = parseStrictDecimal(snapshot.materialsTotal);
  const indirect = parseStrictDecimal(snapshot.indirectTotal);
  const profit = parseStrictDecimal(snapshot.profitValue);
  const deposit = parseStrictDecimal(snapshot.depositAmount);

  const reconstructed = materials.add(indirect).add(profit);
  if (!reconstructed.equals(total)) {
    throw new InvariantError(
      `snapshot invariant violation: total ${total.toFixed(2)} != materials + indirect + profit ${reconstructed.toFixed(2)}`,
    );
  }
  if (deposit.gt(total)) {
    throw new InvariantError(
      `snapshot invariant violation: deposit ${deposit.toFixed(2)} > total ${total.toFixed(2)}`,
    );
  }
}
