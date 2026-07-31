import { describe, expect, it } from "vitest";
import {
  buildQuoteSnapshot,
  type BuildQuoteSnapshotInput,
  type QuoteSnapshot,
} from "@/domain/quote";
import {
  assertSnapshotInvariants,
  freezeForStorage,
  isAcceptedOrRejected,
  verifyTerminalStatus,
  type QuoteStatus,
} from "@/domain/snapshot";
import { projectQuote } from "@/domain/projection";
import { InvariantError } from "@/domain/quoteDeposit";

// Deterministic clock so snapshot.computedAt is stable across runs.
const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

/** Shared input — each test mutates one slice to isolate one behavior. */
const baseInput: BuildQuoteSnapshotInput = {
  models: [{ recipeId: "r1", quantity: "10", perUnitCostDecimal: "150" }],
  indirectCosts: [{ name: "labor", amount: "200" }],
  profit: { mode: "percentage", percent: "30" },
  depositPercent: "20",
  expirationDate: "2026-12-31",
  currentDate: FIXED_DATE,
};

const buildSnap = (): QuoteSnapshot => buildQuoteSnapshot(baseInput);

describe("projectQuote (PR #4a.proj snapshot projection)", () => {
  it("Hide internal cost: perUnitCost and indirectCosts stripped, total preserved (spec scenario: 'Hide internal cost')", () => {
    const projected = projectQuote(buildSnap(), { internalCost: false, profitMargin: true });
    expect(projected.indirectCosts).toEqual([]);
    for (const m of projected.models) expect(m.perUnitCost).toBeUndefined();
    expect(projected.materialsTotal).toBeUndefined();
    expect(projected.indirectTotal).toBeUndefined();
    // Profit visibility still on — profit fields must remain.
    expect(projected.profitValue).toBeDefined();
    expect(projected.profitMethod).toBeDefined();
  });

  it("Hide profit margin: profitValue and profitMethod stripped, total preserved (spec scenario: 'Hide profit margin')", () => {
    const projected = projectQuote(buildSnap(), { internalCost: true, profitMargin: false });
    expect(projected.profitValue).toBeUndefined();
    expect(projected.profitMethod).toBeUndefined();
    // Internal-cost visibility still on — materials and indirects remain.
    expect(projected.indirectCosts).toHaveLength(1);
    expect(projected.materialsTotal).toBeDefined();
  });

  it("Default visibility: full projection when both toggles true (spec scenario: 'Default visibility')", () => {
    const snap = buildSnap();
    const projected = projectQuote(snap);
    expect(projected.visibility).toEqual({ internalCost: true, profitMargin: true });
    expect(projected.id).toBe(snap.id);
    expect(projected.total).toBe(snap.total);
    expect(projected.materialsTotal).toBe(snap.materialsTotal);
    expect(projected.indirectTotal).toBe(snap.indirectTotal);
    expect(projected.profitValue).toBe(snap.profitValue);
    expect(projected.profitMethod).toBe(snap.profitMethod);
    expect(projected.indirectCosts).toEqual(snap.indirectCosts);
    expect(projected.models[0].perUnitCost).toBe(snap.models[0].perUnitCost);
  });

  it("Snapshot is never mutated by projection (spec scenario: 'Snapshot is never mutated by projection')", () => {
    const snap = buildSnap();
    const before = {
      total: snap.total,
      materialsTotal: snap.materialsTotal,
      indirectTotal: snap.indirectTotal,
      profitValue: snap.profitValue,
      depositAmount: snap.depositAmount,
      firstUnitCost: snap.models[0].perUnitCost,
    };
    const projected = projectQuote(snap, { internalCost: false, profitMargin: false });

    // Projection uses fresh references for every mutable container.
    expect(projected.models).not.toBe(snap.models);
    expect(projected.indirectCosts).not.toBe(snap.indirectCosts);
    expect(projected.computedAt).not.toBe(snap.computedAt);
    // Mutating the projection's models throws because it is frozen.
    expect(() => {
      (projected.models as unknown as { length: number }).length = 0;
    }).toThrow();

    expect(snap.total).toBe(before.total);
    expect(snap.materialsTotal).toBe(before.materialsTotal);
    expect(snap.indirectTotal).toBe(before.indirectTotal);
    expect(snap.profitValue).toBe(before.profitValue);
    expect(snap.depositAmount).toBe(before.depositAmount);
    expect(snap.models[0].perUnitCost).toBe(before.firstUnitCost);
  });

  it("Projected view is deep-frozen: mutating throws (spec scenario: 'Projected view is deep-frozen')", () => {
    const projected = projectQuote(buildSnap());
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.models)).toBe(true);
    expect(Object.isFrozen(projected.models[0])).toBe(true);
    expect(Object.isFrozen(projected.indirectCosts)).toBe(true);
    expect(Object.isFrozen(projected.visibility)).toBe(true);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (projected as any).total = "0.00";
    }).toThrow();
    expect(() => {
      (projected.models as unknown as { length: number }).length = 0;
    }).toThrow();
  });

  it("Visibility toggles operate independently: internalCost=false leaves profit visible (spec scenario: 'Visibility toggles operate independently')", () => {
    const snap = buildSnap();
    const projected = projectQuote(snap, { internalCost: false, profitMargin: true });
    expect(projected.indirectCosts).toEqual([]);
    expect(projected.materialsTotal).toBeUndefined();
    expect(projected.profitValue).toBe(snap.profitValue);
    expect(projected.profitMethod).toBe(snap.profitMethod);
    expect(projected.visibility).toEqual({ internalCost: false, profitMargin: true });
  });

  it("Zero totals project correctly: snapshot with zero values still projects (spec scenario: 'Zero totals project correctly')", () => {
    const snap = buildQuoteSnapshot({
      models: [{ recipeId: "r1", quantity: "1", perUnitCostDecimal: "0" }],
      indirectCosts: [],
      profit: { mode: "percentage", percent: "0" },
      depositPercent: "0",
      expirationDate: "2026-12-31",
      currentDate: FIXED_DATE,
    });
    expect(snap.total).toBe("0.00");
    const projected = projectQuote(snap);
    expect(projected.total).toBe("0.00");
    expect(projected.profitValue).toBe("0.00");
    expect(projected.profitMethod).toBe("percentage");
    // Stripping still works on a zero-valued snapshot.
    const hidden = projectQuote(snap, { internalCost: false, profitMargin: false });
    expect(hidden.total).toBe("0.00");
    expect(hidden.indirectCosts).toEqual([]);
    expect(hidden.profitValue).toBeUndefined();
  });

  it("Deposit and total stay visible regardless of visibility toggles", () => {
    const snap = buildSnap();
    const hidden = projectQuote(snap, { internalCost: false, profitMargin: false });
    expect(hidden.depositAmount).toBe(snap.depositAmount);
    expect(hidden.depositPercent).toBe(snap.depositPercent);
    expect(hidden.total).toBe(snap.total);
    expect(hidden.expirationDate).toBe(snap.expirationDate);
  });
});

describe("snapshot helpers (verifyTerminalStatus, assertSnapshotInvariants, freezeForStorage)", () => {
  it("verifyTerminalStatus / isAcceptedOrRejected: true for accepted|rejected, false otherwise (alias)", () => {
    expect(isAcceptedOrRejected).toBe(verifyTerminalStatus);
    const statuses: QuoteStatus[] = ["draft", "sent", "accepted", "rejected", "expired"];
    for (const s of statuses) {
      expect(verifyTerminalStatus(s)).toBe(s === "accepted" || s === "rejected");
      expect(isAcceptedOrRejected(s)).toBe(verifyTerminalStatus(s));
    }
  });

  it("assertSnapshotInvariants passes for a well-formed snapshot from buildQuoteSnapshot", () => {
    expect(() => assertSnapshotInvariants(buildSnap())).not.toThrow();
  });

  it("assertSnapshotInvariants throws InvariantError when total != materials + indirect + profit", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tampered = { ...buildSnap(), total: "9999.99" } as any;
    expect(() => assertSnapshotInvariants(tampered)).toThrow(InvariantError);
  });

  it("assertSnapshotInvariants throws InvariantError when deposit > total", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tampered = { ...buildSnap(), depositAmount: "99999.99" } as any;
    expect(() => assertSnapshotInvariants(tampered)).toThrow(InvariantError);
  });

  it("freezeForStorage returns a deeply-frozen copy, independent of input, idempotent on frozen input", () => {
    const original = { a: 1, nested: { b: 2, list: [1, 2, 3] } };
    const frozen = freezeForStorage(original);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nested)).toBe(true);
    expect(Object.isFrozen(frozen.nested.list)).toBe(true);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (frozen as any).a = 2;
    }).toThrow();
    expect(original.a).toBe(1);
    // Idempotent path: passing an already-frozen object returns a usable copy.
    const frozenInput = Object.freeze({ a: 1, nested: Object.freeze({ b: 2 }) });
    expect(freezeForStorage(frozenInput).a).toBe(1);
  });
});
