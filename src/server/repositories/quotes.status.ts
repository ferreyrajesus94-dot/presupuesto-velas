/**
 * PR4c — `transitionQuoteStatus` transaction. Owner-scoped, conditional
 * status FSM with `FOR UPDATE` row lock, optimistic `expectedLockVersion`
 * check, terminal-current guard, FSM allowlist, and the expired-sent
 * guard. The function is the ONLY export — the file is dedicated so
 * PR4e (server actions) wires a single import path.
 *
 * Allowed transitions (FSM): `draft→sent`, `sent→accepted`,
 * `sent→rejected`. Anything else (including `draft→accepted`,
 * `accepted→rejected`, `rejected→anything`, self-loops) is rejected
 * with `INVALID_STATUS`. Guard order inside the tx (matches
 * `quotes.append.ts`): lockVersion → terminal-current → status match →
 * FSM allowlist → expired-sent. `terminalStatus` is reused from
 * `./quotes` (PR4b.append owns the factory); this slice adds
 * `invalidStatus` and `expiredSentCannotAccept`.
 */

import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { quoteStatusEvents, quotes } from "../../../db/schema";
import { isExpiredSent } from "../../domain/quoteExpired";
import { verifyTerminalStatus, type QuoteStatus } from "../../domain/snapshot";

import {
  expiredSentCannotAccept,
  invalidStatus,
  lockVersionMismatch,
  notFound,
  terminalStatus,
  type Quote,
} from "./quotes";

export { QuoteRepositoryError, type Quote } from "./quotes";

// `quote_status_events.from_status` is nullable (the first event for a
// freshly-created draft would be `null → draft`); this transition fn is
// only called for explicit user-initiated transitions, so fromStatus is
// always non-null here. The schema mirror makes the type available to
// server actions (PR4e).
export type QuoteStatusEvent = typeof quoteStatusEvents.$inferSelect;

// Stored subset of `QuoteStatus` — the DB enum is `draft|sent|accepted|
// rejected`; `expired` is derived, never stored. Callers of this function
// pass a stored status; the cast at the DB boundary is safe.
type StoredQuoteStatus = "draft" | "sent" | "accepted" | "rejected";
const STORED_STATUSES: ReadonlySet<StoredQuoteStatus> = new Set([
  "draft",
  "sent",
  "accepted",
  "rejected",
]);

const ALLOWED: ReadonlyArray<readonly [StoredQuoteStatus, StoredQuoteStatus]> = [
  ["draft", "sent"],
  ["sent", "accepted"],
  ["sent", "rejected"],
];

function isAllowedTransition(from: StoredQuoteStatus, to: StoredQuoteStatus): boolean {
  return ALLOWED.some(([f, t]) => f === from && t === to);
}

export async function transitionQuoteStatus(
  userId: string,
  id: string,
  fromStatus: QuoteStatus,
  toStatus: QuoteStatus,
  expectedLockVersion: number,
): Promise<{ quote: Quote; event: QuoteStatusEvent }> {
  // Reject `expired` upfront — it's a derived status, never stored; the
  // FSM operates on stored statuses only. Throwing here is safer than
  // letting the enum mismatch surface at the DB boundary.
  if (!STORED_STATUSES.has(fromStatus as StoredQuoteStatus)) {
    throw invalidStatus(`fromStatus "${fromStatus}" is not a stored status`);
  }
  if (!STORED_STATUSES.has(toStatus as StoredQuoteStatus)) {
    throw invalidStatus(`toStatus "${toStatus}" is not a stored status`);
  }
  const from = fromStatus as StoredQuoteStatus;
  const to = toStatus as StoredQuoteStatus;

  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.userId, userId), eq(quotes.id, id)))
      .for("update");
    if (!quote) throw notFound(id);

    if (quote.lockVersion !== expectedLockVersion) {
      throw lockVersionMismatch(expectedLockVersion, quote.lockVersion);
    }
    if (verifyTerminalStatus(quote.status as QuoteStatus)) {
      throw terminalStatus(quote.status);
    }
    if (quote.status !== from) {
      throw invalidStatus(`expected current status "${from}" but found "${quote.status}"`);
    }
    if (!isAllowedTransition(from, to)) {
      throw invalidStatus(`transition "${from}" → "${to}" is not allowed`);
    }
    if (
      from === "sent" &&
      to === "accepted" &&
      isExpiredSent(
        { status: quote.status as QuoteStatus, expirationDate: quote.expirationDate },
        new Date(),
      )
    ) {
      throw expiredSentCannotAccept();
    }

    const [updatedQuote] = await tx
      .update(quotes)
      .set({
        status: to,
        lockVersion: quote.lockVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(quotes.id, id))
      .returning();
    if (!updatedQuote) throw notFound(id);

    const eventId = crypto.randomUUID();
    const occurredAt = new Date();
    await tx.insert(quoteStatusEvents).values({
      id: eventId,
      quoteId: id,
      fromStatus: from,
      toStatus: to,
      occurredAt,
    });

    return {
      quote: updatedQuote,
      event: { id: eventId, quoteId: id, fromStatus: from, toStatus: to, occurredAt },
    };
  });
}
