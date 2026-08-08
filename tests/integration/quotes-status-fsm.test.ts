/**
 * PR4c.intg — integration tests for `transitionQuoteStatus` against the
 * `dev-pr2-auth-schema` Neon branch. 11 pinned scenarios:
 * 3 success paths + 1 atomic rollback (EXPIRED_SENT) + 6 rejection paths
 * (INVALID_STATUS, TERMINAL_STATUS, LOCK_VERSION_MISMATCH,
 *  current-status mismatch, NOT_FOUND ×2) + 1 concurrent accept/reject.
 * Constraints: dev-branch safety guard; numeric strings; FK enforcement;
 * owner scope; cleanup order (quote_status_events BEFORE quotes — FK);
 * concurrent test uses `Promise.all` (not `allSettled`); stale test reads
 * `quote.lockVersion` first then passes a wrong expectedLockVersion.
 */

import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

const [
  { db },
  { appUser, quoteStatusEvents, quotes },
  { createQuoteDraft, transitionQuoteStatus, QuoteRepositoryError },
] = await Promise.all([
  import("../../db/client"),
  import("../../db/schema"),
  import("../../src/server/repositories/quotes"),
]);

/**
 * PR1.migration dropped the `app_owner.singleton` column. Replicate the
 * singleton lookup against `app_user.role='owner'` so this test stays
 * compatible with the post-PR1 schema. PR2 rewrites these fixtures under
 * the new user repository (see `tasks.md` task 2.10).
 */
async function getOwnerSingleton(): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.role, "owner"))
    .limit(1);
  return rows[0] ?? null;
}

describe("transitionQuoteStatus (integration vs dev branch)", () => {
  let ownerId = "";
  let createdOwner = false;
  const quoteIds = new Set<string>();

  beforeAll(async () => {
    const owner = await getOwnerSingleton();
    if (owner) {
      ownerId = owner.id;
      return;
    }
    ownerId = crypto.randomUUID();
    await db.insert(appUser).values({
      id: ownerId,
      email: `${ownerId}@calculadora-flor-test.invalid`,
      role: "owner",
      emailVerified: true,
    });
    createdOwner = true;
  });

  async function sweep(): Promise<void> {
    const qIds = [...quoteIds];
    if (qIds.length > 0) {
      // quote_status_events has no FK cascade → quotes. Cleanup order matters.
      await db.delete(quoteStatusEvents).where(inArray(quoteStatusEvents.quoteId, qIds));
      await db.delete(quotes).where(inArray(quotes.id, qIds));
    }
  }

  afterEach(async () => {
    await sweep();
    quoteIds.clear();
  });

  afterAll(async () => {
    await sweep();
    if (createdOwner) await db.delete(appUser).where(eq(appUser.id, ownerId));
  });

  async function createDraft(expirationDate: string): Promise<string> {
    const { quote } = await createQuoteDraft(ownerId, { expirationDate });
    quoteIds.add(quote.id);
    return quote.id;
  }

  async function readQuote(id: string) {
    const rows = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    return rows[0]!;
  }

  async function forceStatus(
    id: string,
    status: "draft" | "sent" | "accepted" | "rejected",
  ): Promise<void> {
    await db
      .update(quotes)
      .set({ status })
      .where(and(eq(quotes.id, id), eq(quotes.ownerId, ownerId)));
  }

  // 1. draft → sent --------------------------------------------------------
  it("draft → sent succeeds: status flips, lockVersion bumps by 1, one event row inserted", async () => {
    const quoteId = await createDraft("2099-12-31");
    const before = await readQuote(quoteId);
    expect(before.status).toBe("draft");
    expect(before.lockVersion).toBe(0);

    const r = await transitionQuoteStatus(ownerId, quoteId, "draft", "sent", 0);

    expect(r.quote.id).toBe(quoteId);
    expect(r.quote.status).toBe("sent");
    expect(r.quote.lockVersion).toBe(1);
    expect(r.event.quoteId).toBe(quoteId);
    expect(r.event.fromStatus).toBe("draft");
    expect(r.event.toStatus).toBe("sent");
    expect(r.event.id.length).toBeGreaterThan(0);

    const persisted = await readQuote(quoteId);
    expect(persisted.status).toBe("sent");
    expect(persisted.lockVersion).toBe(1);

    const events = await db
      .select()
      .from(quoteStatusEvents)
      .where(eq(quoteStatusEvents.quoteId, quoteId));
    expect(events).toHaveLength(1);
    expect(events[0]!.fromStatus).toBe("draft");
    expect(events[0]!.toStatus).toBe("sent");
  });

  // 2. sent → accepted (not expired) --------------------------------------
  it("sent → accepted succeeds when the quote is not expired", async () => {
    const quoteId = await createDraft("2099-12-31");
    await transitionQuoteStatus(ownerId, quoteId, "draft", "sent", 0);
    const r = await transitionQuoteStatus(ownerId, quoteId, "sent", "accepted", 1);
    expect(r.quote.status).toBe("accepted");
    expect(r.quote.lockVersion).toBe(2);
    expect(r.event.fromStatus).toBe("sent");
    expect(r.event.toStatus).toBe("accepted");
  });

  // 3. sent → rejected -----------------------------------------------------
  it("sent → rejected succeeds: status flips, lockVersion bumps, one event row inserted", async () => {
    const quoteId = await createDraft("2099-12-31");
    await transitionQuoteStatus(ownerId, quoteId, "draft", "sent", 0);
    const r = await transitionQuoteStatus(ownerId, quoteId, "sent", "rejected", 1);
    expect(r.quote.status).toBe("rejected");
    expect(r.quote.lockVersion).toBe(2);
    expect(r.event.fromStatus).toBe("sent");
    expect(r.event.toStatus).toBe("rejected");
  });

  // 4. EXPIRED_SENT_CANNOT_ACCEPT (real isExpiredSent against dev branch) -
  it("sent → accepted rejects EXPIRED_SENT_CANNOT_ACCEPT when past expiration (today is 2026)", async () => {
    // 2024-01-01 is well before today (2026-07-27). The function's real
    // isExpiredSent derivation (BA tz) must fire on the real clock.
    const quoteId = await createDraft("2024-01-01");
    await forceStatus(quoteId, "sent");
    const before = await readQuote(quoteId);
    expect(before.status).toBe("sent");

    await expect(
      transitionQuoteStatus(ownerId, quoteId, "sent", "accepted", before.lockVersion),
    ).rejects.toBeInstanceOf(QuoteRepositoryError);
    await expect(
      transitionQuoteStatus(ownerId, quoteId, "sent", "accepted", before.lockVersion),
    ).rejects.toMatchObject({ code: "EXPIRED_SENT_CANNOT_ACCEPT" });

    // Atomic rollback: status stays "sent", lockVersion unchanged, no event row.
    const after = await readQuote(quoteId);
    expect(after.status).toBe("sent");
    expect(after.lockVersion).toBe(before.lockVersion);
    const events = await db
      .select()
      .from(quoteStatusEvents)
      .where(eq(quoteStatusEvents.quoteId, quoteId));
    expect(events).toHaveLength(0);
  });

  // 5. INVALID_STATUS: draft → accepted -----------------------------------
  it("draft → accepted rejects INVALID_STATUS (FSM allowlist)", async () => {
    const quoteId = await createDraft("2099-12-31");
    await expect(
      transitionQuoteStatus(ownerId, quoteId, "draft", "accepted", 0),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    const events = await db
      .select()
      .from(quoteStatusEvents)
      .where(eq(quoteStatusEvents.quoteId, quoteId));
    expect(events).toHaveLength(0);
  });

  // 6. TERMINAL_STATUS: accepted → rejected -------------------------------
  it("accepted → rejected rejects TERMINAL_STATUS (terminal-before-FSM ordering)", async () => {
    const quoteId = await createDraft("2099-12-31");
    await forceStatus(quoteId, "accepted");
    const before = await readQuote(quoteId);
    await expect(
      transitionQuoteStatus(ownerId, quoteId, "accepted", "rejected", before.lockVersion),
    ).rejects.toBeInstanceOf(QuoteRepositoryError);
    await expect(
      transitionQuoteStatus(ownerId, quoteId, "accepted", "rejected", before.lockVersion),
    ).rejects.toMatchObject({ code: "TERMINAL_STATUS" });
  });

  // 7. LOCK_VERSION_MISMATCH (stale read) ----------------------------------
  it("rejects LOCK_VERSION_MISMATCH for a stale expectedLockVersion (read-then-bump-then-stale-call)", async () => {
    const quoteId = await createDraft("2099-12-31");
    const before = await readQuote(quoteId);
    expect(before.lockVersion).toBe(0);
    await transitionQuoteStatus(ownerId, quoteId, "draft", "sent", 0);
    const after1 = await readQuote(quoteId);
    expect(after1.lockVersion).toBe(1);

    // Stale expectedLockVersion=0; current=1 → LOCK_VERSION_MISMATCH fires
    // before the status-match / FSM checks.
    await expect(
      transitionQuoteStatus(ownerId, quoteId, "sent", "accepted", 0),
    ).rejects.toBeInstanceOf(QuoteRepositoryError);
    await expect(
      transitionQuoteStatus(ownerId, quoteId, "sent", "accepted", 0),
    ).rejects.toMatchObject({ code: "LOCK_VERSION_MISMATCH" });
  });

  // 8. INVALID_STATUS: current status ≠ fromStatus ------------------------
  it("rejects INVALID_STATUS when current.status does not match fromStatus", async () => {
    const quoteId = await createDraft("2099-12-31");
    // Move to "sent" so current.status="sent", lockVersion=1.
    await transitionQuoteStatus(ownerId, quoteId, "draft", "sent", 0);
    const after1 = await readQuote(quoteId);
    expect(after1.lockVersion).toBe(1);
    expect(after1.status).toBe("sent");

    // Caller claims fromStatus="draft" but the row is "sent". lockVersion
    // matches, status is non-terminal → status-mismatch check fires before
    // the FSM allowlist → INVALID_STATUS.
    await expect(transitionQuoteStatus(ownerId, quoteId, "draft", "sent", 1)).rejects.toMatchObject(
      { code: "INVALID_STATUS" },
    );
  });

  // 9. NOT_FOUND: missing id ----------------------------------------------
  it("rejects NOT_FOUND for a missing quote id", async () => {
    const missingId = crypto.randomUUID();
    await expect(
      transitionQuoteStatus(ownerId, missingId, "draft", "sent", 0),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 10. NOT_FOUND: cross-owner query ---------------------------------------
  it("rejects NOT_FOUND for a cross-owner query (the WHERE filters by ownerId)", async () => {
    const quoteId = await createDraft("2099-12-31");
    const otherOwnerId = crypto.randomUUID();
    await expect(
      transitionQuoteStatus(otherOwnerId, quoteId, "draft", "sent", 0),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 11. Concurrent accept/reject (Promise.all — one wins, one typed conflict)
  it("concurrent accept/reject: one wins, the other throws LOCK_VERSION_MISMATCH (only the winner inserts an event)", async () => {
    const quoteId = await createDraft("2099-12-31");
    await transitionQuoteStatus(ownerId, quoteId, "draft", "sent", 0);
    const before = await readQuote(quoteId);
    expect(before.status).toBe("sent");
    expect(before.lockVersion).toBe(1);

    // `.then(r, e)` captures either outcome without re-throwing, so both
    // inner promises resolve to undefined and Promise.all never rejects.
    // We use Promise.all (per PR4c.intg constraint) so any setup-time
    // synchronous throw surfaces loudly. The captures let us assert that
    // exactly one call won and exactly one lost with the right code.
    const captures: {
      result?: Awaited<ReturnType<typeof transitionQuoteStatus>>;
      error?: unknown;
    }[] = [{}, {}];
    const p1 = transitionQuoteStatus(ownerId, quoteId, "sent", "accepted", 1).then(
      (r) => {
        captures[0]!.result = r;
      },
      (e) => {
        captures[0]!.error = e;
      },
    );
    const p2 = transitionQuoteStatus(ownerId, quoteId, "sent", "rejected", 1).then(
      (r) => {
        captures[1]!.result = r;
      },
      (e) => {
        captures[1]!.error = e;
      },
    );
    await Promise.all([p1, p2]);

    const winners = captures.filter((c) => c.result);
    const losers = captures.filter((c) => c.error);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.error).toBeInstanceOf(QuoteRepositoryError);
    expect(losers[0]!.error).toMatchObject({ code: "LOCK_VERSION_MISMATCH" });
    const winnerTo = winners[0]!.result!.quote.status;
    expect(["accepted", "rejected"]).toContain(winnerTo);

    // Atomicity: of the TWO events the loser would have inserted, only the
    // winner's row is present. Total events = 1 (precondition draft→sent)
    // + 1 (winner) = 2.
    const events = await db
      .select()
      .from(quoteStatusEvents)
      .where(eq(quoteStatusEvents.quoteId, quoteId))
      .orderBy(quoteStatusEvents.occurredAt);
    expect(events).toHaveLength(2);
    expect(events[0]!.fromStatus).toBe("draft");
    expect(events[0]!.toStatus).toBe("sent");
    expect(events[1]!.fromStatus).toBe("sent");
    expect(events[1]!.toStatus).toBe(winnerTo);

    // Final quote state matches the winner.
    const final = await readQuote(quoteId);
    expect(final.status).toBe(winnerTo);
    expect(final.lockVersion).toBe(2);
  });
});
