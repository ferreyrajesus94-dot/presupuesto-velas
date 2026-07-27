import { beforeEach, describe, expect, it, vi } from "vitest";

// Cycle-safe walker: collects every string reachable from `value`, skipping
// Drizzle's SQL chunk back-references (`table`, `_`). Used to inspect the
// `where(...)` filter shape without coupling tests to internal column aliases.
function collectStrings(value: unknown): string[] {
  const acc: string[] = [];
  const walk = (v: unknown, seen: WeakSet<object>): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "string") return void acc.push(v);
    if (typeof v !== "object" || seen.has(v as object)) return;
    seen.add(v as object);
    if (Array.isArray(v)) return void v.forEach((i) => walk(i, seen));
    for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
      if (k === "table" || k === "_") continue;
      acc.push(k);
      walk(c, seen);
    }
  };
  walk(value, new WeakSet());
  return acc;
}
const whereHasFilter = (value: unknown, column: string, ...values: string[]) => {
  const acc = collectStrings(value);
  return acc.includes(column) && values.every((v) => acc.includes(v));
};

// Per-test tx chain. Each `await` pops the next rows from `rowsQueue`;
// terminal methods return the chain. `rowsQueue` is read off `this` so the
// test's per-test reassignment takes effect (closure capture would not).
type Tx = { rowsQueue: unknown[][]; [k: string]: ReturnType<typeof vi.fn> | unknown };
const CHAIN_METHODS = "select from where orderBy limit insert values update set returning".split(
  " ",
);
function createTxMock(rows: unknown[][] = []): Tx {
  const tx: Tx = { rowsQueue: [...rows] } as Tx;
  for (const k of CHAIN_METHODS) (tx as Record<string, unknown>)[k] = vi.fn().mockReturnValue(tx);
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

import {
  countArchivedQuotes,
  createQuoteDraft,
  getQuote,
  listQuotes,
  QuoteRepositoryError,
} from "../../src/server/repositories/quotes";

const OWNER = "owner-1";

function existingQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-1",
    ownerId: OWNER,
    customerName: null,
    expirationDate: "2026-12-31",
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

beforeEach(() => {
  txRef.current = createTxMock();
  for (const fn of [dbMock.transaction, dbMock.select, dbMock.insert, dbMock.update])
    fn.mockClear();
});

describe("quotes repository — CRUD (PR4b scope)", () => {
  describe("createQuoteDraft", () => {
    it("creates a draft with status='draft', currentVersion=0, lockVersion=0", async () => {
      txRef.current!.rowsQueue = [[existingQuote({ id: "new-q" })]];
      const result = await createQuoteDraft(OWNER, { expirationDate: "2026-12-31" });
      expect(result.quote).toMatchObject({
        status: "draft",
        currentVersion: 0,
        lockVersion: 0,
      });
      expect(txRef.current!.values).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: OWNER,
          status: "draft",
          currentVersion: 0,
          lockVersion: 0,
        }),
      );
    });

    it("rejects invalid expirationDate format with INVALID_INPUT", async () => {
      await expect(createQuoteDraft(OWNER, { expirationDate: "2026/12/31" })).rejects.toMatchObject(
        { code: "INVALID_INPUT" },
      );
      expect(dbMock.transaction).not.toHaveBeenCalled();
    });

    it("rejects missing ownerId with INVALID_INPUT", async () => {
      await expect(createQuoteDraft("", { expirationDate: "2026-12-31" })).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
      expect(dbMock.transaction).not.toHaveBeenCalled();
    });
  });

  describe("listQuotes visibility", () => {
    it("excludes terminal quotes by default (active view: draft|sent)", async () => {
      txRef.current!.rowsQueue = [[{ id: "q-draft", status: "draft" }]];
      await listQuotes(OWNER);
      const whereCalls = (txRef.current!.where as ReturnType<typeof vi.fn>).mock.calls;
      expect(whereCalls.flat().some((arg) => whereHasFilter(arg, "status", "draft", "sent"))).toBe(
        true,
      );
    });

    it("includes terminal quotes when includeTerminal: true (no status filter)", async () => {
      txRef.current!.rowsQueue = [[{ id: "q-accepted" }]];
      await listQuotes(OWNER, { includeTerminal: true });
      const whereCalls = (txRef.current!.where as ReturnType<typeof vi.fn>).mock.calls;
      expect(whereCalls).toHaveLength(1);
      expect(whereHasFilter(whereCalls[0][0], "status")).toBe(false);
    });
  });

  describe("getQuote", () => {
    it.each([
      ["missing id", OWNER, "missing-id"],
      ["cross-owner query", "other-owner", "q-1"],
    ])("returns null for %s", async (_label, owner, id) => {
      txRef.current!.rowsQueue = [[]];
      expect(await getQuote(owner, id)).toBeNull();
    });
  });

  it("countArchivedQuotes matches the SQL count of terminal-status quotes for the owner", async () => {
    txRef.current!.rowsQueue = [
      [{ id: "q-1" }, { id: "q-2" }], // countArchivedQuotes result
    ];
    expect(await countArchivedQuotes(OWNER)).toBe(2);
  });

  it("countArchivedQuotes returns 0 when no terminal quotes match", async () => {
    txRef.current!.rowsQueue = [[]];
    expect(await countArchivedQuotes(OWNER)).toBe(0);
  });
});

// Sanity guard: the error class must carry the codes promised to PR4c (FSM)
// and PR4d (Zod) — but ONLY the two codes that PR4b actually throws.
describe("QuoteRepositoryError (PR4b codes)", () => {
  it("supports NOT_FOUND and INVALID_INPUT codes", () => {
    const nf = new QuoteRepositoryError("NOT_FOUND", "x");
    const ii = new QuoteRepositoryError("INVALID_INPUT", "y");
    expect(nf.code).toBe("NOT_FOUND");
    expect(ii.code).toBe("INVALID_INPUT");
    expect(nf).toBeInstanceOf(Error);
    expect(nf).toBeInstanceOf(QuoteRepositoryError);
  });
});
