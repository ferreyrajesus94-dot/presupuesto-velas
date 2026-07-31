import { describe, expect, it } from "vitest";
import { QUOTE_DEFAULT_TZ, isExpiredSent } from "@/domain/quoteExpired";
import type { QuoteStatus } from "@/domain/snapshot";

// Frozen Buenos Aires fixtures — every `currentDate` in this file is a
// deterministic UTC instant whose calendar date in
// America/Argentina/Buenos_Aires (UTC-03:00, no DST since 2009) is fixed
// for the lifetime of a test run.

/** Anchor: 2025-06-15T12:00:00-03:00 → BA calendar date 2025-06-15. */
const ARGENTINA_BASE_ISO = "2025-06-15T12:00:00-03:00";
const ARGENTINA_BASE_UTC_MS = new Date(ARGENTINA_BASE_ISO).getTime();

/** Returns a `Date` at the anchor plus `offsetHours` hours. */
function argentinaDate(offsetHours: number = 0): Date {
  return new Date(ARGENTINA_BASE_UTC_MS + offsetHours * 3_600_000);
}

const SENT: QuoteStatus = "sent";
const ACCEPTED: QuoteStatus = "accepted";
const REJECTED: QuoteStatus = "rejected";
const DRAFT: QuoteStatus = "draft";

describe("isExpiredSent (PR #4a.expired — `expired` derivation)", () => {
  it("sent past expiration → expired (spec: Derived expired status)", () => {
    expect(isExpiredSent({ status: SENT, expirationDate: "2025-01-01" }, argentinaDate())).toBe(
      true,
    );
  });

  it("accepted past expiration → never expired (spec: accepted or rejected never become expired)", () => {
    expect(isExpiredSent({ status: ACCEPTED, expirationDate: "2025-01-01" }, argentinaDate())).toBe(
      false,
    );
  });

  it("rejected past expiration → never expired (spec: accepted or rejected never become expired)", () => {
    expect(isExpiredSent({ status: REJECTED, expirationDate: "2025-01-01" }, argentinaDate())).toBe(
      false,
    );
  });

  it("draft past expiration → never expired (spec: drafts never derive expired)", () => {
    expect(isExpiredSent({ status: DRAFT, expirationDate: "2025-01-01" }, argentinaDate())).toBe(
      false,
    );
  });

  it("sent exactly on expiration date → not expired (boundary: same BA calendar date)", () => {
    // argentinaDate() → BA calendar date 2025-06-15; expirationDate 2025-06-15 → not past.
    expect(isExpiredSent({ status: SENT, expirationDate: "2025-06-15" }, argentinaDate())).toBe(
      false,
    );
  });

  it("sent on the day after expiration → expired (boundary: next-day BA calendar date)", () => {
    // argentinaDate() → BA calendar date 2025-06-15; expirationDate 2025-06-14 → past.
    expect(isExpiredSent({ status: SENT, expirationDate: "2025-06-14" }, argentinaDate())).toBe(
      true,
    );
  });

  it("cross-summer/winter BA dates: January and July, same outcome (BA has no DST since 2009)", () => {
    // Southern-hemisphere summer (January) and winter (July) anchors.
    const summer = new Date("2025-01-15T12:00:00-03:00"); // BA date 2025-01-15
    const winter = new Date("2025-07-15T12:00:00-03:00"); // BA date 2025-07-15

    // Past-expiration checks must hold across both seasons.
    expect(
      isExpiredSent(
        { status: SENT, expirationDate: "2025-01-01" },
        summer,
        "America/Argentina/Buenos_Aires",
      ),
    ).toBe(true);
    expect(
      isExpiredSent(
        { status: SENT, expirationDate: "2025-01-01" },
        winter,
        "America/Argentina/Buenos_Aires",
      ),
    ).toBe(true);
    // Same-day boundary must hold across both seasons.
    expect(
      isExpiredSent(
        { status: SENT, expirationDate: "2025-01-15" },
        summer,
        "America/Argentina/Buenos_Aires",
      ),
    ).toBe(false);
    expect(
      isExpiredSent(
        { status: SENT, expirationDate: "2025-07-15" },
        winter,
        "America/Argentina/Buenos_Aires",
      ),
    ).toBe(false);
  });

  it("rejects invalid expirationDate format (must be YYYY-MM-DD, not /, single-digit, or empty)", () => {
    const badDates = [
      "2025/01/01", // wrong separator
      "2025-1-1", // single-digit month/day
      "", // empty
      "25-01-01", // two-digit year
      "2025-01-01T00:00:00Z", // ISO datetime
    ];
    for (const bad of badDates) {
      expect(() => isExpiredSent({ status: SENT, expirationDate: bad }, argentinaDate())).toThrow(
        /expirationDate/,
      );
    }
  });

  it("rejects calendar-overflow expirationDate (right shape, impossible day/month)", () => {
    const overflows = [
      "2025-02-31", // Feb 31 doesn't exist
      "2025-13-01", // month 13 doesn't exist
      "2025-04-31", // April has 30 days
      "2025-00-15", // month 0 doesn't exist
    ];
    for (const bad of overflows) {
      expect(() => isExpiredSent({ status: SENT, expirationDate: bad }, argentinaDate())).toThrow(
        /calendar date/,
      );
    }
  });

  it("sent before expiration → not expired (baseline non-expired case)", () => {
    // Argentina base → BA 2025-06-15. Expiration 2025-12-31 → future → not expired.
    expect(isExpiredSent({ status: SENT, expirationDate: "2025-12-31" }, argentinaDate())).toBe(
      false,
    );
  });

  it("custom `tz` parameter drives the comparison (UTC vs BA disagreement is observable)", () => {
    // Same instant, different calendar dates in different tzs.
    // 2025-06-16T02:00:00Z = 2025-06-15T23:00:00-03:00 in BA.
    const now = new Date("2025-06-16T02:00:00.000Z");
    // Expiration 2025-06-15 in BA: not past.
    expect(
      isExpiredSent(
        { status: SENT, expirationDate: "2025-06-15" },
        now,
        "America/Argentina/Buenos_Aires",
      ),
    ).toBe(false);
    // Same instant in UTC: BA date 2025-06-15 is past → expired.
    expect(isExpiredSent({ status: SENT, expirationDate: "2025-06-15" }, now, "UTC")).toBe(true);
  });

  it("default timezone is Buenos Aires: omit `tz` → uses QUOTE_DEFAULT_TZ", () => {
    expect(QUOTE_DEFAULT_TZ).toBe("America/Argentina/Buenos_Aires");
    // 2025-06-16T02:00:00Z = 2025-06-15T23:00:00-03:00 in BA.
    //   - Default tz (BA) sees calendar date 2025-06-15 → not past 2025-06-15 → not expired.
    //   - UTC sees calendar date 2025-06-16 → past 2025-06-15 → would be expired.
    const now = new Date("2025-06-16T02:00:00.000Z");
    expect(isExpiredSent({ status: SENT, expirationDate: "2025-06-15" }, now)).toBe(false);
    expect(isExpiredSent({ status: SENT, expirationDate: "2025-06-15" }, now, "UTC")).toBe(true);
  });
});
