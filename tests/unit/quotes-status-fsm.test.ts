/** PR4c — unit tests for `transitionQuoteStatus`. DB chain mocked;
 * `isExpiredSent` mocked via `vi.mock` to drive the expired-sent guard.
 * Integration tests against the Neon dev branch are scoped to PR4c.intg. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { quoteStatusEvents } from "../../db/schema";

type Tx = { rowsQueue: unknown[][]; [k: string]: ReturnType<typeof vi.fn> | unknown };
const CHAIN = "select from where orderBy limit insert values update set returning for".split(" ");
function createTxMock(rows: unknown[][] = []): Tx {
  const tx: Tx = { rowsQueue: [...rows] } as Tx;
  for (const k of CHAIN) (tx as Record<string, unknown>)[k] = vi.fn().mockReturnValue(tx);
  (tx as Record<string, unknown>).then = function (this: Tx, resolve: (x: unknown) => void) {
    resolve(this.rowsQueue.shift() ?? []);
  };
  return tx;
}

const { txRef, dbMock } = vi.hoisted(() => {
  const txRef: { current: Tx | null } = { current: null };
  return {
    txRef,
    dbMock: {
      transaction: vi.fn(async (cb: (tx: Tx) => unknown) => cb(txRef.current!)),
      select: vi.fn(() => txRef.current!),
      insert: vi.fn(() => txRef.current!),
      update: vi.fn(() => txRef.current!),
    },
  };
});

vi.mock("../../db/client", () => ({ db: dbMock }));

// Override only `isExpiredSent`; keep `QUOTE_DEFAULT_TZ` etc. available.
const { isExpiredSentMock } = vi.hoisted(() => ({ isExpiredSentMock: vi.fn(() => false) }));
vi.mock("../../src/domain/quoteExpired", async () => {
  const actual = await vi.importActual<typeof import("../../src/domain/quoteExpired")>(
    "../../src/domain/quoteExpired",
  );
  return { ...actual, isExpiredSent: isExpiredSentMock };
});

import { transitionQuoteStatus } from "../../src/server/repositories/quotes.status";

const USER = "user-1";
const QUOTE_ID = "q-1";

function makeQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: QUOTE_ID,
    userId: USER,
    customerName: null,
    expirationDate: "2099-12-31",
    status: "draft",
    currentVersion: 0,
    lockVersion: 0,
    duplicatedFromQuoteId: null,
    duplicatedFromVersion: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// 3 awaits in the success path: SELECT FOR UPDATE, UPDATE returning,
// INSERT (no return needed — the function constructs the event itself).
const threeRows = (current: unknown, updated: unknown): unknown[][] => [[current], [updated], []];

beforeEach(() => {
  txRef.current = createTxMock();
  for (const fn of [dbMock.transaction, dbMock.select, dbMock.insert, dbMock.update])
    fn.mockClear();
  isExpiredSentMock.mockReset();
  isExpiredSentMock.mockReturnValue(false);
});

describe("transitionQuoteStatus — success path", () => {
  it("draft → sent succeeds and bumps lockVersion by 1", async () => {
    const current = makeQuote({ status: "draft", lockVersion: 5 });
    const updated = makeQuote({ status: "sent", lockVersion: 6 });
    txRef.current!.rowsQueue = threeRows(current, updated);
    const r = await transitionQuoteStatus(USER, QUOTE_ID, "draft", "sent", 5);
    expect(r.quote.status).toBe("sent");
    expect(r.quote.lockVersion).toBe(6);
    expect(r.event.quoteId).toBe(QUOTE_ID);
    expect(r.event.fromStatus).toBe("draft");
    expect(r.event.toStatus).toBe("sent");
    expect(r.event.id.length).toBeGreaterThan(0);
  });

  it("sent → accepted succeeds when the quote is not expired", async () => {
    const current = makeQuote({ status: "sent", lockVersion: 1 });
    const updated = makeQuote({ status: "accepted", lockVersion: 2 });
    txRef.current!.rowsQueue = threeRows(current, updated);
    const r = await transitionQuoteStatus(USER, QUOTE_ID, "sent", "accepted", 1);
    expect(r.quote.status).toBe("accepted");
    expect(r.quote.lockVersion).toBe(2);
    expect(isExpiredSentMock).toHaveBeenCalledTimes(1);
  });

  it("sent → rejected succeeds", async () => {
    const current = makeQuote({ status: "sent", lockVersion: 2 });
    const updated = makeQuote({ status: "rejected", lockVersion: 3 });
    txRef.current!.rowsQueue = threeRows(current, updated);
    const r = await transitionQuoteStatus(USER, QUOTE_ID, "sent", "rejected", 2);
    expect(r.quote.status).toBe("rejected");
    expect(r.quote.lockVersion).toBe(3);
  });

  it("inserts exactly one quoteStatusEvents row on success", async () => {
    txRef.current!.rowsQueue = threeRows(
      makeQuote({ status: "draft", lockVersion: 0 }),
      makeQuote({ status: "sent", lockVersion: 1 }),
    );
    await transitionQuoteStatus(USER, QUOTE_ID, "draft", "sent", 0);
    // Drizzle's `insert(table).values({...})` is two chained calls;
    // values live on `.values.mock.calls`, not `.insert.mock.calls`.
    const inserts = (txRef.current!.insert as ReturnType<typeof vi.fn>).mock.calls;
    expect(inserts.some(([t]) => t === quoteStatusEvents)).toBe(true);
    const valuesCalls = (txRef.current!.values as ReturnType<typeof vi.fn>).mock.calls;
    const eventRows = valuesCalls[valuesCalls.length - 1]![0] as Record<string, unknown>;
    expect(eventRows.quoteId).toBe(QUOTE_ID);
    expect(eventRows.fromStatus).toBe("draft");
    expect(eventRows.toStatus).toBe("sent");
    expect((eventRows.id as string).length).toBeGreaterThan(0);
    expect(eventRows.occurredAt).toBeInstanceOf(Date);
    expect((txRef.current!.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("transitionQuoteStatus — expired-sent guard", () => {
  it("sent → accepted rejected (EXPIRED_SENT_CANNOT_ACCEPT) when the quote is expired", async () => {
    isExpiredSentMock.mockReturnValue(true);
    txRef.current!.rowsQueue = [[makeQuote({ status: "sent", lockVersion: 1 })]];
    await expect(
      transitionQuoteStatus(USER, QUOTE_ID, "sent", "accepted", 1),
    ).rejects.toMatchObject({ code: "EXPIRED_SENT_CANNOT_ACCEPT" });
    expect(isExpiredSentMock).toHaveBeenCalledTimes(1);
    expect((txRef.current!.update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("sent → rejected is NOT blocked by the expired-sent guard", async () => {
    isExpiredSentMock.mockReturnValue(true);
    txRef.current!.rowsQueue = threeRows(
      makeQuote({ status: "sent", lockVersion: 4 }),
      makeQuote({ status: "rejected", lockVersion: 5 }),
    );
    const r = await transitionQuoteStatus(USER, QUOTE_ID, "sent", "rejected", 4);
    expect(r.quote.status).toBe("rejected");
    // Only the accept path consults isExpiredSent.
    expect(isExpiredSentMock).not.toHaveBeenCalled();
  });
});

describe("transitionQuoteStatus — FSM allowlist", () => {
  it.each([
    ["draft", "accepted"],
    ["draft", "rejected"],
  ] as const)("%s → %s rejected (INVALID_STATUS)", async (from, to) => {
    txRef.current!.rowsQueue = [[makeQuote({ status: "draft", lockVersion: 0 })]];
    await expect(transitionQuoteStatus(USER, QUOTE_ID, from, to, 0)).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });
});

describe("transitionQuoteStatus — terminal-current guard", () => {
  it.each([
    ["accepted", "rejected"],
    ["rejected", "draft"],
  ] as const)("%s → %s rejected (TERMINAL_STATUS)", async (from, to) => {
    txRef.current!.rowsQueue = [[makeQuote({ status: from, lockVersion: 0 })]];
    await expect(transitionQuoteStatus(USER, QUOTE_ID, from, to, 0)).rejects.toMatchObject({
      code: "TERMINAL_STATUS",
    });
  });
});

describe("transitionQuoteStatus — current-status mismatch", () => {
  it("INVALID_STATUS when current.status does not match fromStatus", async () => {
    // Row says `sent`, caller claims `fromStatus: "draft"`.
    txRef.current!.rowsQueue = [[makeQuote({ status: "sent", lockVersion: 0 })]];
    await expect(transitionQuoteStatus(USER, QUOTE_ID, "draft", "sent", 0)).rejects.toMatchObject({
      code: "INVALID_STATUS",
    });
  });
});

describe("transitionQuoteStatus — lockVersion mismatch", () => {
  it("LOCK_VERSION_MISMATCH on a stale expectedLockVersion", async () => {
    txRef.current!.rowsQueue = [[makeQuote({ status: "draft", lockVersion: 5 })]];
    await expect(transitionQuoteStatus(USER, QUOTE_ID, "draft", "sent", 3)).rejects.toMatchObject({
      code: "LOCK_VERSION_MISMATCH",
    });
  });
});

describe("transitionQuoteStatus — NOT_FOUND", () => {
  it.each([
    ["missing id", USER, "missing-id"],
    ["cross-owner query", "other-owner", QUOTE_ID],
  ] as const)("throws NOT_FOUND for %s", async (_label, owner, id) => {
    txRef.current!.rowsQueue = [[]];
    await expect(transitionQuoteStatus(owner, id, "draft", "sent", 0)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
