import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isExpiredSent } from "@/domain/quoteExpired";
import type { QuoteStatus } from "@/domain/snapshot";

/**
 * Frozen Buenos Aires timezone fixtures for the `expired` derivation.
 *
 * The specs (sdd/calculadora-flor — "Derived expired status") and design
 * (#998) pin Argentina (BA, `America/Argentina/Buenos_Aires`) as the canonical
 * quote timezone and require calendar-date comparison via `Intl.DateTimeFormat`.
 * Argentina stopped observing DST in 2009, so BA is UTC-03:00 year-round;
 * the same UTC instant yields the same BA calendar date in July and in
 * January. This file freezes those assumptions as deterministic fixtures so
 * refactors of `isExpiredSent` cannot silently drift the boundary.
 *
 * `mkQuote` mirrors the public `Quote` shape (status + expirationDate, plus
 * the noise fields that callers normally pass) so the helper keeps accepting
 * the canonical shape once it is integrated with the repository layer.
 *
 * `vi.useFakeTimers` + `vi.setSystemTime` keep the `currentDate` parameter
 * deterministic, so the fixtures are robust against host clock drift.
 */

interface QuoteShaped {
  readonly id: string;
  readonly ownerId: string;
  readonly customerName: string | null;
  readonly status: QuoteStatus;
  readonly expirationDate: string;
  readonly currentVersion: number;
  readonly lockVersion: number;
  readonly archivedAt: string | null;
  readonly duplicatedFromQuoteId: string | null;
  readonly duplicatedFromVersion: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const SENT: QuoteStatus = "sent";
const DRAFT: QuoteStatus = "draft";
const ACCEPTED: QuoteStatus = "accepted";
const REJECTED: QuoteStatus = "rejected";

function mkQuote(overrides: Partial<QuoteShaped> = {}): QuoteShaped {
  return {
    id: "q-fixed",
    ownerId: "owner-1",
    customerName: null,
    status: SENT,
    expirationDate: "2026-01-15",
    currentVersion: 1,
    lockVersion: 0,
    archivedAt: null,
    duplicatedFromQuoteId: null,
    duplicatedFromVersion: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** BA date → midnight UTC instant (BA is UTC-3 year-round, so add 03:00). */
function baMidnight(isoDate: string): Date {
  return new Date(`${isoDate}T03:00:00.000Z`);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Anchor the host clock far from every fixture so a `new Date()` without an
  // explicit `currentDate` cannot accidentally land inside a frozen window.
  vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isExpiredSent — frozen BA timezone fixtures (PR4j)", () => {
  describe("basic sent-vs-expiration cases", () => {
    it("sent past expiration → expired", () => {
      // BA calendar date 2026-01-20 is strictly past expiration 2026-01-15.
      expect(
        isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), baMidnight("2026-01-20")),
      ).toBe(true);
    });

    it("sent exactly on expiration date → not expired (same BA calendar date)", () => {
      expect(
        isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), baMidnight("2026-01-15")),
      ).toBe(false);
    });

    it("sent before expiration → not expired", () => {
      expect(
        isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), baMidnight("2026-01-14")),
      ).toBe(false);
    });
  });

  describe("status semantics (only `sent` can be expired)", () => {
    it.each([
      ["draft", DRAFT],
      ["accepted", ACCEPTED],
      ["rejected", REJECTED],
    ] as const)("status=%s past expiration → never expired", (_label, status) => {
      expect(
        isExpiredSent(mkQuote({ status, expirationDate: "2026-01-15" }), baMidnight("2026-01-20")),
      ).toBe(false);
    });
  });

  describe("Buenos Aires timezone (UTC-3, year-round)", () => {
    it("UTC 2026-01-16T02:00:00Z = BA 2026-01-15T23:00 → same BA day as expiration → not expired", () => {
      // The helper projects `currentDate` onto the BA calendar; at 23:00 BA
      // time the BA date is still 2026-01-15, identical to the expiration day.
      const now = new Date("2026-01-16T02:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), now)).toBe(false);
    });

    it("UTC 2026-01-16T03:00:00Z = BA 2026-01-16T00:00 → next BA day → expired", () => {
      // One hour later, the BA calendar rolls over; now is strictly past.
      const now = new Date("2026-01-16T03:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), now)).toBe(true);
    });

    it("UTC 2026-01-15T23:00:00Z = BA 2026-01-15T20:00 → same BA day → not expired", () => {
      const now = new Date("2026-01-15T23:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), now)).toBe(false);
    });
  });

  describe("DST forward verification (Argentina has NOT observed DST since 2009)", () => {
    it("March 15 expiration at BA 23:00 the next day → same BA day → not expired", () => {
      // Some southern-hemisphere zones shift DST in March; BA must not.
      // 2026-03-16T02:00:00Z = 2026-03-15T23:00 BA time.
      const now = new Date("2026-03-16T02:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-03-15" }), now)).toBe(false);
    });

    it("October 15 expiration at BA 23:00 the next day → same BA day → not expired", () => {
      // Northern DST ends in October/early November; BA must stay UTC-3.
      // 2026-10-16T02:00:00Z = 2026-10-15T23:00 BA time.
      const now = new Date("2026-10-16T02:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-10-15" }), now)).toBe(false);
    });

    it("March 15 → March 16 BA midnight → expired (BA rolls over at 03:00 UTC, no spring-forward)", () => {
      // If BA secretly observed DST, the BA date at 03:00 UTC would be 2026-03-16T01:00 or 2026-03-16T02:00
      // instead of the expected 2026-03-16T00:00. Lock the BA midnight to 03:00 UTC.
      const now = new Date("2026-03-16T03:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-03-15" }), now)).toBe(true);
    });
  });

  describe("cross-season (BA is UTC-3 year-round, so summer and winter behave the same)", () => {
    it("summer: December 15 expiration, February 1 anchor → expired", () => {
      expect(
        isExpiredSent(mkQuote({ expirationDate: "2025-12-15" }), baMidnight("2026-02-01")),
      ).toBe(true);
    });

    it("winter: June 15 expiration, August 1 anchor → expired", () => {
      expect(
        isExpiredSent(mkQuote({ expirationDate: "2026-06-15" }), baMidnight("2026-08-01")),
      ).toBe(true);
    });

    it("summer same-day anchor: January 15 expiration, January 15 midday → not expired", () => {
      // 2026-01-15T12:00:00Z = 2026-01-15T09:00 BA → same day.
      const now = new Date("2026-01-15T12:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), now)).toBe(false);
    });

    it("winter same-day anchor: July 15 expiration, July 15 midday → not expired", () => {
      // 2026-07-15T12:00:00Z = 2026-07-15T09:00 BA → same day.
      const now = new Date("2026-07-15T12:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-07-15" }), now)).toBe(false);
    });
  });

  describe("boundary cases at the BA midnight rollover", () => {
    it("exactly at BA midnight on the expiration day → not expired (same day)", () => {
      // 2026-01-15T03:00:00Z = 2026-01-15T00:00 BA = expiration day midnight.
      const now = new Date("2026-01-15T03:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), now)).toBe(false);
    });

    it("one second after BA midnight on the day after expiration → expired", () => {
      // 2026-01-16T03:00:01Z = 2026-01-16T00:00:01 BA = first second of the day after.
      const now = new Date("2026-01-16T03:00:01.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-01-15" }), now)).toBe(true);
    });
  });

  describe("custom timezone parameter", () => {
    it("NY tz disagrees with BA tz for the same UTC instant (June DST)", () => {
      // 2026-07-04T03:00:00Z projections:
      //   - BA (UTC-3, no DST) → 2026-07-04T00:00 → BA date 2026-07-04
      //   - NY (EDT, UTC-4)   → 2026-07-03T23:00 → NY date 2026-07-03
      // Expiration 2026-07-03:
      //   - In BA: now (2026-07-04) > expiration (2026-07-03) → expired = true
      //   - In NY: now (2026-07-03) > expiration (2026-07-03) → not expired = false
      const now = new Date("2026-07-04T03:00:00.000Z");
      expect(isExpiredSent(mkQuote({ expirationDate: "2026-07-03" }), now)).toBe(true);
      expect(
        isExpiredSent(mkQuote({ expirationDate: "2026-07-03" }), now, "America/New_York"),
      ).toBe(false);
    });
  });
});
