import { describe, expect, it } from "vitest";
import { buildQuoteSnapshot, type BuildQuoteSnapshotInput } from "@/domain/quote";
import { DEFAULT_INDIRECT_COST_NAMES, DEFAULT_VISIBILITY } from "@/domain/quoteDefaults";

// Deterministic clock so snapshot.computedAt is stable across runs.
const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

/** Shared starting input — each test mutates one slice to isolate one behavior. */
const baseInput: BuildQuoteSnapshotInput = {
  models: [{ recipeId: "r1", quantity: "10", perUnitCostDecimal: "150" }],
  indirectCosts: [],
  profit: { mode: "percentage", percent: "30" },
  depositPercent: "0",
  expirationDate: "2026-12-31",
  currentDate: FIXED_DATE,
};

describe("buildQuoteSnapshot (PR #4a.calc foundation)", () => {
  it("Single-model quote: 150 × 10, no indirects, 30% → 1500 / 450 / 1950", () => {
    const snap = buildQuoteSnapshot(baseInput);
    expect(snap.materialsTotal).toBe("1500.00");
    expect(snap.indirectTotal).toBe("0.00");
    expect(snap.profitValue).toBe("450.00");
    expect(snap.total).toBe("1950.00");
    expect(snap.profitMethod).toBe("percentage");
  });

  it("profitInput preserves the user-entered percent verbatim (so the edit form can round-trip)", () => {
    const snap = buildQuoteSnapshot(baseInput);
    expect(snap.profitMethod).toBe("percentage");
    // Canonical decimal: "30" is canonical for the value 30.00. The
    // string the user typed is preserved exactly — no zero-padding.
    expect(snap.profitInput).toBe("30");
    // Calculated ARS is still in profitValue (existing contract).
    expect(snap.profitValue).toBe("450.00");
  });

  it("profitInput carries the ARS amount verbatim in fixed mode", () => {
    const snap = buildQuoteSnapshot({ ...baseInput, profit: { mode: "fixed", amount: "1234.5" } });
    expect(snap.profitMethod).toBe("fixed");
    expect(snap.profitInput).toBe("1234.5");
    expect(snap.profitValue).toBe("1234.50");
  });

  it("Multi-model quote: two templates with different quantities aggregate into a single materials total", () => {
    const snap = buildQuoteSnapshot({
      ...baseInput,
      models: [
        { recipeId: "r1", quantity: "10", perUnitCostDecimal: "150" }, // 1500
        { recipeId: "r2", quantity: "5", perUnitCostDecimal: "200" }, // 1000
      ],
      profit: { mode: "percentage", percent: "10" }, // (2500 + 0) × 0.10
    });
    expect(snap.materialsTotal).toBe("2500.00");
    expect(snap.profitValue).toBe("250.00");
    expect(snap.total).toBe("2750.00");
  });

  it("Quantity of one: 19.99 × 1 yields exactly 19.99 (no rounding to 20)", () => {
    const snap = buildQuoteSnapshot({
      ...baseInput,
      models: [{ recipeId: "r1", quantity: "1", perUnitCostDecimal: "19.99" }],
      profit: { mode: "percentage", percent: "0" },
    });
    expect(snap.materialsTotal).toBe("19.99");
    expect(snap.total).toBe("19.99");
  });

  it("Quote with no indirect cost line items: empty list sums to zero and never throws", () => {
    const snap = buildQuoteSnapshot({ ...baseInput, indirectCosts: [] });
    expect(snap.indirectTotal).toBe("0.00");
    expect(snap.indirectCosts).toHaveLength(0);
  });

  it("Reject negative indirect cost amount: throws a clear error", () => {
    expect(() =>
      buildQuoteSnapshot({
        ...baseInput,
        indirectCosts: [{ name: "labor", amount: "-0.01" }],
      }),
    ).toThrow(/non-negative|indirect/i);
  });

  it("Percentage profit with no indirect cost line items: 1500 × 30% = 450 (spec-pinned)", () => {
    const snap = buildQuoteSnapshot(baseInput);
    expect(snap.profitValue).toBe("450.00");
    expect(snap.profitMethod).toBe("percentage");
  });

  it("Fixed profit: amount is exactly 2000 regardless of materials or indirects", () => {
    const snap = buildQuoteSnapshot({
      ...baseInput,
      indirectCosts: [{ name: "labor", amount: "500" }],
      profit: { mode: "fixed", amount: "2000" },
    });
    expect(snap.profitMethod).toBe("fixed");
    expect(snap.profitValue).toBe("2000.00");
    expect(snap.total).toBe("4000.00"); // 1500 + 500 + 2000
  });

  it("Switch profit method: percentage → fixed recomputes and the snapshot records the active method", () => {
    const pct = buildQuoteSnapshot({
      ...baseInput,
      profit: { mode: "percentage", percent: "10" },
    });
    const fix = buildQuoteSnapshot({ ...baseInput, profit: { mode: "fixed", amount: "999" } });
    expect({ v: pct.profitValue, m: pct.profitMethod }).toEqual({ v: "150.00", m: "percentage" });
    expect({ v: fix.profitValue, m: fix.profitMethod }).toEqual({ v: "999.00", m: "fixed" });
  });

  it("Percentage profit includes indirect cost line items: (1500 + 500) × 10% = 200", () => {
    const snap = buildQuoteSnapshot({
      ...baseInput,
      indirectCosts: [{ name: "labor", amount: "500" }],
      profit: { mode: "percentage", percent: "10" },
    });
    expect(snap.materialsTotal).toBe("1500.00");
    expect(snap.indirectTotal).toBe("500.00");
    expect(snap.profitValue).toBe("200.00");
    expect(snap.total).toBe("2200.00");
  });

  it("Editable deposit percentage: 0 is valid, 50 yields half the total, 100 yields the full total", () => {
    const buildAt = (deposit: string) =>
      buildQuoteSnapshot({
        ...baseInput,
        models: [{ recipeId: "r1", quantity: "1", perUnitCostDecimal: "100" }],
        profit: { mode: "percentage", percent: "0" },
        depositPercent: deposit,
      });
    const zero = buildAt("0");
    const half = buildAt("50");
    const full = buildAt("100");
    expect(zero.depositPercent).toBe("0");
    expect(zero.depositAmount).toBe("0.00");
    expect(half.depositAmount).toBe("50.00");
    expect(full.depositAmount).toBe("100.00");
  });

  it("Reject non-positive quantity: throws (zero AND negative)", () => {
    expect(() =>
      buildQuoteSnapshot({
        ...baseInput,
        models: [{ recipeId: "r1", quantity: "0", perUnitCostDecimal: "100" }],
      }),
    ).toThrow(/positive|quantity/i);
    expect(() =>
      buildQuoteSnapshot({
        ...baseInput,
        models: [{ recipeId: "r1", quantity: "-1", perUnitCostDecimal: "100" }],
      }),
    ).toThrow(/positive|quantity/i);
  });

  it("Default concepts on a new quote: snapshot preserves the full input indirect list verbatim", () => {
    const indirects = DEFAULT_INDIRECT_COST_NAMES.map((name) => ({ name, amount: "100" }));
    const snap = buildQuoteSnapshot({ ...baseInput, indirectCosts: indirects });
    expect(snap.indirectCosts).toHaveLength(4);
    expect(snap.indirectCosts.map((i) => i.name)).toEqual([...DEFAULT_INDIRECT_COST_NAMES]);
    expect(snap.indirectTotal).toBe("400.00");
  });

  it("Deep-freeze: snapshot, models, indirectCosts, visibility, and every nested entry are frozen", () => {
    const snap = buildQuoteSnapshot({
      ...baseInput,
      indirectCosts: [{ name: "labor", amount: "100" }],
    });
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.models)).toBe(true);
    expect(Object.isFrozen(snap.indirectCosts)).toBe(true);
    expect(Object.isFrozen(snap.visibility)).toBe(true);
    expect(Object.isFrozen(snap.models[0])).toBe(true);
    expect(Object.isFrozen(snap.indirectCosts[0])).toBe(true);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (snap as any).total = "0.00";
    }).toThrow();
    expect(() => {
      (snap.models as { length: number }).length = 0;
    }).toThrow();
  });

  it("applies DEFAULT_VISIBILITY when the input omits visibility, records computedAt verbatim, and assigns a non-empty id", () => {
    const snap = buildQuoteSnapshot({
      models: [{ recipeId: "r1", quantity: "1", perUnitCostDecimal: "1" }],
      indirectCosts: [],
      profit: { mode: "percentage", percent: "0" },
      depositPercent: "0",
      expirationDate: "2026-12-31",
      currentDate: FIXED_DATE,
    });
    expect(snap.visibility).toEqual(DEFAULT_VISIBILITY);
    expect(snap.computedAt).toEqual(FIXED_DATE);
    expect(snap.expirationDate).toBe("2026-12-31");
    expect(typeof snap.id).toBe("string");
    expect(snap.id.length).toBeGreaterThan(0);
  });
});
