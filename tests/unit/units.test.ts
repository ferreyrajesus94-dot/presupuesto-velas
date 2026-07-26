import { describe, expect, it } from "vitest";
import { decimal, toMoneyString } from "../../src/domain/decimal";
import {
  areUnitsCompatible,
  assertCountIntegral,
  countIntegralSchema,
  getUnitDimension,
  isUnit,
  normalizeToBaseUnit,
  UNITS_BY_DIMENSION,
} from "../../src/domain/units";

describe("units domain (PR #3a foundation)", () => {
  it("classifies every supported unit by its dimension", () => {
    expect(getUnitDimension("g")).toBe("mass");
    expect(getUnitDimension("kg")).toBe("mass");
    expect(getUnitDimension("ml")).toBe("volume");
    expect(getUnitDimension("L")).toBe("volume");
    expect(getUnitDimension("cm")).toBe("length");
    expect(getUnitDimension("m")).toBe("length");
    expect(getUnitDimension("unit")).toBe("count");
  });

  it("lists every supported unit under its dimension", () => {
    expect(UNITS_BY_DIMENSION.mass).toEqual(expect.arrayContaining(["g", "kg"]));
    expect(UNITS_BY_DIMENSION.volume).toEqual(expect.arrayContaining(["ml", "L"]));
    expect(UNITS_BY_DIMENSION.length).toEqual(expect.arrayContaining(["cm", "m"]));
    expect(UNITS_BY_DIMENSION.count).toEqual(["unit"]);
  });

  it("treats same-dimension units as compatible (mass, volume, length, count)", () => {
    expect(areUnitsCompatible("g", "kg")).toBe(true);
    expect(areUnitsCompatible("kg", "g")).toBe(true);
    expect(areUnitsCompatible("ml", "L")).toBe(true);
    expect(areUnitsCompatible("cm", "m")).toBe(true);
    expect(areUnitsCompatible("unit", "unit")).toBe(true);
  });

  it("rejects cross-dimension unit pairs (g/L, g/unit, L/m)", () => {
    expect(areUnitsCompatible("g", "L")).toBe(false);
    expect(areUnitsCompatible("g", "unit")).toBe(false);
    expect(areUnitsCompatible("L", "m")).toBe(false);
    expect(areUnitsCompatible("kg", "cm")).toBe(false);
  });

  it("normalizes 1 kg of wax to 1000 g and reports cost in base-unit money", () => {
    const normalized = normalizeToBaseUnit(decimal("1"), "kg", "g");
    expect(normalized.toString()).toBe("1000");
    const costPerGram = toMoneyString(normalized); // not meaningful alone, but exact
    expect(costPerGram).toBe("1000.00");
  });

  it("normalizes 0.1 kg to 100 g for the recipe-line cross-unit scenario", () => {
    expect(normalizeToBaseUnit(decimal("0.1"), "kg", "g").toString()).toBe("100");
  });

  it("normalizes 2 L to 2000 ml and 0.5 m to 50 cm", () => {
    expect(normalizeToBaseUnit(decimal("2"), "L", "ml").toString()).toBe("2000");
    expect(normalizeToBaseUnit(decimal("0.5"), "m", "cm").toString()).toBe("50");
  });

  it("returns the same value for the count dimension (1 unit stays 1 unit)", () => {
    expect(normalizeToBaseUnit(decimal("3"), "unit", "unit").toString()).toBe("3");
  });

  it("throws on cross-dimension normalization (g to L) so the error is loud", () => {
    expect(() => normalizeToBaseUnit(decimal("1"), "L", "g")).toThrow(/incompatible units/i);
  });

  it("rejects fractional quantities on the count dimension (assert + schema)", () => {
    expect(() => assertCountIntegral(decimal("1.5"))).toThrow(/count dimension/i);
    expect(() => assertCountIntegral(decimal("0.5"))).toThrow(/count dimension/i);
    expect(() => assertCountIntegral(decimal("2"))).not.toThrow();
    // Schema helper
    expect(countIntegralSchema("1.5")).toBe(false);
    expect(countIntegralSchema("2")).toBe(true);
    expect(countIntegralSchema("0")).toBe(false);
  });
});

/**
 * Regression for R3-001: `in` against a plain object literal accepts every
 * Object.prototype key as a valid unit. A type guard that uses `in` is only
 * as truthful as its runtime membership check — the unit table must own its
 * keys outright, not borrow them from the prototype chain.
 *
 * Every assertion in this block fails against the pre-fix implementation
 * (where `isUnit` returns `true` for `constructor`/`toString`/`__proto__`,
 * `getUnitDimension` returns `undefined` or a non-dimension for the same,
 * and `areUnitsCompatible` reports prototype keys as compatible).
 */
describe("units domain — R3-001 prototype-key regression", () => {
  // Representative Object.prototype keys. The fix must reject ALL of them,
  // not just the three named in the finding.
  const prototypeKeys = [
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
    "isPrototypeOf",
    "valueOf",
    "propertyIsEnumerable",
  ] as const;

  it.each(prototypeKeys)("isUnit rejects the Object.prototype key %j as a unit", (key) => {
    expect(isUnit(key)).toBe(false);
  });

  it("isUnit still accepts every real domain unit alongside the prototype-key guard", () => {
    for (const real of ["g", "kg", "ml", "L", "cm", "m", "unit"]) {
      expect(isUnit(real)).toBe(true);
    }
  });

  it.each(prototypeKeys)(
    "getUnitDimension throws on the Object.prototype key %j (no dimension produced)",
    (key) => {
      expect(() => getUnitDimension(key)).toThrow(/unknown unit/i);
    },
  );

  it("areUnitsCompatible returns false whenever either side is a prototype key", () => {
    for (const key of prototypeKeys) {
      expect(areUnitsCompatible(key, "g")).toBe(false);
      expect(areUnitsCompatible("g", key)).toBe(false);
    }
    // Two prototype keys must not pair as compatible — they share no
    // dimension, and the dimension lookup must not treat them as a real unit.
    expect(areUnitsCompatible("constructor", "toString")).toBe(false);
    expect(areUnitsCompatible("toString", "toString")).toBe(false);
    expect(areUnitsCompatible("__proto__", "__proto__")).toBe(false);
  });

  it("areUnitsCompatible stays true for real same-dimension pairs after the prototype guard", () => {
    expect(areUnitsCompatible("g", "kg")).toBe(true);
    expect(areUnitsCompatible("ml", "L")).toBe(true);
  });
});
