/** PR4b.append — unit tests for `appendQuoteVersion`. DB chain mocked;
 * integration tests against Neon dev branch are scoped to PR4b.append.intg. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { quoteVersionMaterials } from "../../db/schema";
import { buildQuoteSnapshot, type QuoteSnapshot } from "../../src/domain/quote";

type Tx = { rowsQueue: unknown[][]; for: ReturnType<typeof vi.fn>; [k: string]: unknown };
const CHAIN = "select from where orderBy limit insert values update set returning for".split(" ");
function createTxMock(rows: unknown[][] = []): Tx {
  const tx: Tx = { rowsQueue: [...rows], for: vi.fn().mockReturnThis() } as Tx;
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

import { appendQuoteVersion } from "../../src/server/repositories/quotes.append";

const OWNER = "owner-1";
const QUOTE_ID = "q-1";

const quote = (overrides: Record<string, unknown> = {}) => ({
  id: QUOTE_ID,
  ownerId: OWNER,
  status: "draft",
  currentVersion: 0,
  lockVersion: 0,
  ...overrides,
});
const recipe = (id: string) => ({ id, ownerId: OWNER, name: id });
const item = (recipeId: string, materialId: string, quantity: string) => ({
  recipeId,
  materialId,
  quantity,
});
const material = (id: string, unitCost: string) => ({
  id,
  ownerId: OWNER,
  name: id,
  unitCost,
});
const snap2 = (): QuoteSnapshot =>
  buildQuoteSnapshot({
    models: [
      { recipeId: "rec-1", quantity: "2", perUnitCostDecimal: "100" },
      { recipeId: "rec-2", quantity: "1", perUnitCostDecimal: "50" },
    ],
    indirectCosts: [
      { name: "labor", amount: "50" },
      { name: "waste", amount: "20" },
    ],
    profit: { mode: "percentage", percent: "30" },
    depositPercent: "50",
    expirationDate: "2026-12-31",
  });

// appendQuoteVersion awaits: 4 SELECTs + 1 INSERT quoteVersions +
// N INSERTs quoteVersionModels + K_M INSERTs quote_version_materials +
// (1 if indirects) + 1 UPDATE returning + 1 SELECT quote_versions.
function q(
  qo: Record<string, unknown>,
  templates: unknown[],
  items: unknown[],
  materials: unknown[],
  modelCount: number,
  matInsertCount: number,
  indirectCount: number,
) {
  const v = ((qo.currentVersion ?? 0) as number) + 1;
  const l = ((qo.lockVersion ?? 0) as number) + 1;
  return [
    [quote(qo)],
    templates,
    items,
    materials,
    [],
    ...Array.from({ length: modelCount }, () => []),
    ...Array.from({ length: matInsertCount }, () => []),
    ...(indirectCount > 0 ? [[]] : []),
    [quote({ ...qo, currentVersion: v, lockVersion: l })],
    [{ quoteId: QUOTE_ID, versionNo: v }],
  ];
}

beforeEach(() => {
  txRef.current = createTxMock();
  for (const fn of [dbMock.transaction, dbMock.select, dbMock.insert, dbMock.update])
    fn.mockClear();
});

describe("appendQuoteVersion — typed errors", () => {
  it.each([
    ["LOCK_VERSION_MISMATCH", quote({ lockVersion: 5 }), 3],
    ["TERMINAL_STATUS", quote({ status: "accepted", lockVersion: 0 }), 0],
    ["TERMINAL_STATUS", quote({ status: "rejected", lockVersion: 0 }), 0],
  ] as const)("throws %s for the right precondition", async (code, quoteRow, expectedLock) => {
    txRef.current!.rowsQueue = [[quoteRow]];
    await expect(appendQuoteVersion(OWNER, QUOTE_ID, snap2(), expectedLock)).rejects.toMatchObject({
      code,
    });
  });

  it.each([
    ["missing id", OWNER, "missing-id"],
    ["cross-owner", "other-owner", QUOTE_ID],
  ] as const)("throws NOT_FOUND for %s", async (_label, owner, id) => {
    txRef.current!.rowsQueue = [[]];
    await expect(appendQuoteVersion(owner, id, snap2(), 0)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("appendQuoteVersion — success path", () => {
  it("increments versionNo and lockVersion atomically (0 → 1)", async () => {
    txRef.current!.rowsQueue = q(
      { currentVersion: 0, lockVersion: 0 },
      [recipe("rec-1")],
      [item("rec-1", "mat-1", "1")],
      [material("mat-1", "1")],
      2,
      1,
      2,
    );
    const r = await appendQuoteVersion(OWNER, QUOTE_ID, snap2(), 0);
    expect(r.quote.currentVersion).toBe(1);
    expect(r.quote.lockVersion).toBe(1);
  });

  it("per-material quantity and lineTotal use Decimal.js (not Number().toFixed())", async () => {
    // Decimal.js HALF_UP of "10.005" yields "10.01"; Number().toFixed
    // yields "10.00" because IEEE 754 stores 10.005 as 10.00499...
    const snap = buildQuoteSnapshot({
      models: [{ recipeId: "rec-1", quantity: "1", perUnitCostDecimal: "1" }],
      indirectCosts: [{ name: "labor", amount: "0" }],
      profit: { mode: "percentage", percent: "0" },
      depositPercent: "0",
      expirationDate: "2026-12-31",
    });
    txRef.current!.rowsQueue = q(
      { currentVersion: 0, lockVersion: 0 },
      [recipe("rec-1")],
      [item("rec-1", "mat-1", "1")],
      [material("mat-1", "10.005000000000000000")],
      1,
      1,
      1,
    );
    await appendQuoteVersion(OWNER, QUOTE_ID, snap, 0);
    const inserts = (txRef.current!.insert as ReturnType<typeof vi.fn>).mock.calls;
    const values = (txRef.current!.values as ReturnType<typeof vi.fn>).mock.calls;
    const rows = values[inserts.findIndex(([t]) => t === quoteVersionMaterials)][0] as Array<
      Record<string, unknown>
    >;
    expect(rows[0].lineTotal).toBe("10.01");
    expect(rows[0].lineTotal).not.toBe("10.00");
    expect(rows[0].quantity).toBe("1.000000");
  });
});
