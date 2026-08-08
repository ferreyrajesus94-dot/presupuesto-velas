/**
 * PR #4d — Server-side validation for quote Server Action inputs.
 * Mirrors the inline validation in `buildQuoteSnapshot` (PR #4a.calc) at the
 * HTTP boundary. Canonical decimal = `/^-?\d+(\.\d+)?$/`. The `profit`
 * discriminated union forces `mode === "percentage" → percent` AND
 * `mode === "fixed" → amount`. Server actions (PR #4e) call
 * `parseQuoteDraftInput(raw)` before `buildQuoteSnapshot(...)`.
 */
import { z } from "zod";

/** Canonical decimal string: `^-?\d+(\.\d+)?$`. */
export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "Must be a canonical decimal string");

const atMostTwoDecimals = (s: string) => !s.split(".")[1] || s.split(".")[1].length <= 2;

/** Percentage profit: canonical decimal in `[0, 10000]` with at most two decimals. */
export const percentageProfitString = decimalString
  .refine((s) => {
    const v = parseFloat(s);
    return v >= 0 && v <= 10000;
  }, "Percentage profit must be in 0..10000")
  .refine(atMostTwoDecimals, "At most 2 decimal places");

/** Fixed profit: nonnegative canonical decimal. Zero is allowed. */
export const fixedProfitString = decimalString.refine(
  (s) => parseFloat(s) >= 0,
  "Fixed profit must be >= 0",
);

/** Deposit percent: canonical decimal in `[0, 100]` with at most two decimals. */
export const depositPercentString = decimalString
  .refine((s) => {
    const v = parseFloat(s);
    return v >= 0 && v <= 100;
  }, "Deposit percent must be in 0..100")
  .refine(atMostTwoDecimals, "At most 2 decimal places");

/** ISO `YYYY-MM-DD` calendar date. Overflow dates are caught by `buildQuoteSnapshot`. */
export const expirationDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiration date must be YYYY-MM-DD");

/** Indirect cost line item: non-empty name (1–50 chars) plus nonnegative amount. */
export const indirectCostSchema = z.object({
  name: z.string().min(1).max(50),
  amount: decimalString.refine((s) => parseFloat(s) >= 0, "Amount must be >= 0"),
});

/**
 * Profit discriminated union. `mode === "percentage"` requires `percent`;
 * `mode === "fixed"` requires `amount`. Options are `z.object(...)` (NOT
 * inline literals) because Zod 4's `discriminatedUnion` requires its options
 * to be discriminable Zod schemas — inline objects throw `Cannot read
 * properties of undefined (reading 'propValues')` from the JIT fastpass.
 */
const percentageProfitOption = z.object({
  mode: z.literal("percentage"),
  percent: percentageProfitString,
});
const fixedProfitOption = z.object({
  mode: z.literal("fixed"),
  amount: fixedProfitString,
});

export const profitSchema = z.discriminatedUnion("mode", [
  percentageProfitOption,
  fixedProfitOption,
]);

/**
 * Quote draft input — mirrors `BuildQuoteSnapshotInput` (PR #4a.calc) minus
 * the `visibility`/`currentDate` defaults (those are applied by the builder).
 * An empty models list is accepted per the orchestrator's literal `min(0)`.
 */
export const quoteDraftInputSchema = z.object({
  expirationDate: expirationDateString,
  profit: profitSchema,
  depositPercent: depositPercentString,
  indirectCosts: z.array(indirectCostSchema),
  models: z
    .array(
      z.object({
        recipeId: z.string().uuid(),
        quantity: decimalString.refine((s) => parseFloat(s) > 0, "Quantity must be > 0"),
      }),
    )
    .min(0),
  visibility: z.object({
    internalCost: z.boolean(),
    profitMargin: z.boolean(),
  }),
});

/** Strict TDD: throw `ZodError` on invalid input. Convenience for Server Actions. */
export function parseQuoteDraftInput(raw: unknown) {
  return quoteDraftInputSchema.parse(raw);
}

/**
 * `appendQuoteVersion` Server Action input — `expectedLockVersion` plus the
 * full draft snapshot. The action layer derives `userId` from the session,
 * so it is NOT part of this schema (clients cannot fake ownership).
 */
export const quoteVersionInputSchema = quoteDraftInputSchema.extend({
  expectedLockVersion: z.number().int().nonnegative(),
});

/** Stored statuses — DB enum is `draft|sent|accepted|rejected`; `expired` is derived. */
export const STORED_QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected"] as const;
export type StoredQuoteStatus = (typeof STORED_QUOTE_STATUSES)[number];

/** Allowed FSM transitions — matches `quotes.status.ts#ALLOWED` (PR #4c). */
const ALLOWED_TRANSITIONS: ReadonlyArray<readonly [StoredQuoteStatus, StoredQuoteStatus]> = [
  ["draft", "sent"],
  ["sent", "accepted"],
  ["sent", "rejected"],
];

/**
 * `transitionQuoteStatus` Server Action input — `fromStatus`, `toStatus`,
 * `expectedLockVersion`. `expired` is rejected (derived, never stored).
 * Transitions outside the FSM allowlist are rejected here so the repository
 * layer receives a pre-validated payload.
 */
export const quoteStatusTransitionSchema = z
  .object({
    fromStatus: z.enum(STORED_QUOTE_STATUSES),
    toStatus: z.enum(STORED_QUOTE_STATUSES),
    expectedLockVersion: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    const ok = ALLOWED_TRANSITIONS.some(([f, t]) => f === value.fromStatus && t === value.toStatus);
    if (!ok) {
      ctx.addIssue({
        code: "custom",
        path: ["toStatus"],
        message: `Status transition "${value.fromStatus}" → "${value.toStatus}" is not allowed`,
      });
    }
  });
