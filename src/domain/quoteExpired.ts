import type { QuoteStatus } from "./snapshot";

/**
 * Default timezone for `isExpiredSent`. The only canonical tz supported by
 * the quote domain — Buenos Aires has not observed DST since 2009, so
 * calendar dates are stable year-round. Reused by PR4c (status FSM) and
 * PR4i (lifecycle UI) to keep the comparison consistent.
 */
export const QUOTE_DEFAULT_TZ = "America/Argentina/Buenos_Aires";

const EXPIRATION_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pure derivation (design #998): a `sent` quote whose `expirationDate` is
 * strictly before today's calendar date in `tz` is `expired`. Every other
 * status (`draft`, `accepted`, `rejected`) is NEVER expired — `draft` has
 * not been sent, and `accepted` / `rejected` are terminal.
 *
 * The comparison is calendar-date based in the given timezone (not
 * millisecond-precise). Use `Intl.DateTimeFormat` to project `currentDate`
 * onto the `tz` calendar before comparing.
 *
 * Pure: no I/O, no `new Date()` inside — `currentDate` is a parameter so
 * tests stay deterministic. Throws on malformed `expirationDate`.
 */
export function isExpiredSent(
  quote: { status: QuoteStatus; expirationDate: string },
  currentDate: Date,
  tz: string = QUOTE_DEFAULT_TZ,
): boolean {
  validateExpirationDate(quote.expirationDate);
  if (quote.status !== "sent") return false;
  const currentInTz = formatDateInTimeZone(currentDate, tz);
  return currentInTz > quote.expirationDate;
}

function validateExpirationDate(value: string): void {
  if (typeof value !== "string" || !EXPIRATION_DATE_REGEX.test(value)) {
    throw new Error(`quoteExpired: expirationDate must be YYYY-MM-DD (got "${String(value)}")`);
  }
  // Calendar validity: round-trip through UTC midnight to reject overflow
  // dates like "2025-02-31" without any timezone-dependence.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`quoteExpired: expirationDate is not a valid calendar date (got "${value}")`);
  }
}

function formatDateInTimeZone(date: Date, tz: string): string {
  // en-CA yields YYYY-MM-DD-shaped parts. Stitch year/month/day.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) {
    throw new Error(`quoteExpired: failed to format date in timezone "${tz}"`);
  }
  return `${y}-${m}-${d}`;
}
