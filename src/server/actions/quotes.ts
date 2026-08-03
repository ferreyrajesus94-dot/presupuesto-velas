"use server";

/**
 * PR4e — Server Actions for quotes. `requireOwner()` (single-user allowlist)
 * + Zod validation (before DB) + repository transactions + cache
 * revalidation (on success only). Each action returns a discriminated-union
 * `ActionResult<T>` — repository errors map 1:1 to the `QuoteRepositoryError`
 * codes (NOT_FOUND, INVALID_INPUT, LOCK_VERSION_MISMATCH, TERMINAL_STATUS,
 * INVALID_STATUS, EXPIRED_SENT_CANNOT_ACCEPT).
 */

import "server-only";
import { revalidatePath } from "next/cache";
import { type z } from "zod";

import { requireOwner } from "../auth/requireOwner";
import {
  appendQuoteVersion,
  createQuoteDraft,
  QuoteRepositoryError,
  transitionQuoteStatus,
  type Quote,
  type QuoteRecord,
  type QuoteVersion,
} from "../repositories/quotes";
import type { QuoteStatusEvent } from "../repositories/quotes.status";
import {
  parseQuoteDraftInput,
  quoteDraftInputSchema,
  quoteStatusTransitionSchema,
  quoteVersionInputSchema,
} from "../validation/quoteSchema";
import { buildQuoteSnapshot, type BuildQuoteSnapshotInput } from "../../domain/quote";
import type { QuoteStatus } from "../../domain/snapshot";

// Server-side draft shape mirrored from the PR4d Zod schema. `customerName`
// rides along even though the Zod schema doesn't validate it (PR4d is
// stable); we forward it from the raw `input` to `createQuoteDraft`.
type QuoteDraftInput = z.infer<typeof quoteDraftInputSchema> & {
  customerName?: string | null;
};

/** All error codes a quote Server Action can surface. Mirrors `QuoteRepositoryError`. */
type ErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "LOCK_VERSION_MISMATCH"
  | "TERMINAL_STATUS"
  | "INVALID_STATUS"
  | "EXPIRED_SENT_CANNOT_ACCEPT";

/** Discriminated-union result envelope. */
export type ActionResult<T> =
  { ok: true; value: T } | { ok: false; error: { code: ErrorCode; message: string } };

function failure<T = never>(code: ErrorCode, message: string): ActionResult<T> {
  return { ok: false, error: { code, message } };
}

function mapRepositoryError(error: unknown): ActionResult<never> {
  if (error instanceof QuoteRepositoryError) return failure(error.code, error.message);
  // Unknown errors map to INVALID_INPUT so we never leak stack traces to UI.
  return failure("INVALID_INPUT", "Unexpected server error");
}

/**
 * Create a draft quote. The full draft is Zod-validated (so profit /
 * deposit / models shape is well-formed for the eventual first
 * `appendQuoteVersion`), but only `expirationDate` and `customerName` are
 * persisted at draft time — versions arrive via `appendQuoteVersionAction`.
 */
export async function createQuoteDraftAction(
  input: QuoteDraftInput,
): Promise<ActionResult<QuoteRecord>> {
  const owner = await requireOwner();
  let parsed: QuoteDraftInput;
  try {
    parsed = parseQuoteDraftInput(input);
  } catch (error) {
    return failure("INVALID_INPUT", error instanceof Error ? error.message : "Invalid input");
  }
  try {
    const record = await createQuoteDraft(owner.id, {
      expirationDate: parsed.expirationDate,
      // Pulled from raw `input` because the PR4d Zod schema doesn't declare
      // `customerName` and would strip it during parsing.
      customerName: input.customerName ?? null,
    });
    revalidatePath("/quotes");
    return { ok: true, value: record };
  } catch (error) {
    return mapRepositoryError(error);
  }
}

/**
 * Append a new version to an existing quote. Validates the draft input +
 * `expectedLockVersion` via `quoteVersionInputSchema`, builds the
 * immutable snapshot, then runs the optimistic-concurrency append
 * transaction. The form layer resolves each model's `perUnitCostDecimal`
 * from the templates catalog before invoking this action (PR4g wires the
 * form-side lookup; see the cast below).
 */
export async function appendQuoteVersionAction(
  quoteId: string,
  snapshotInput: QuoteDraftInput,
  expectedLockVersion: number,
): Promise<ActionResult<{ quote: Quote; version: QuoteVersion }>> {
  const owner = await requireOwner();
  const parsed = quoteVersionInputSchema.safeParse({ ...snapshotInput, expectedLockVersion });
  if (!parsed.success) return failure("INVALID_INPUT", parsed.error.message);
  const snapshot = buildQuoteSnapshot(snapshotInput as unknown as BuildQuoteSnapshotInput);
  try {
    const result = await appendQuoteVersion(owner.id, quoteId, snapshot, expectedLockVersion);
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true, value: result };
  } catch (error) {
    return mapRepositoryError(error);
  }
}

/**
 * Apply a status FSM transition. Validates `fromStatus`, `toStatus`,
 * `expectedLockVersion` via `quoteStatusTransitionSchema`. Schema-level
 * FSM rejections and enum mismatches surface as `INVALID_STATUS`; other
 * Zod failures (e.g., negative lock version) surface as `INVALID_INPUT`.
 */
export async function transitionQuoteStatusAction(
  quoteId: string,
  fromStatus: QuoteStatus,
  toStatus: QuoteStatus,
  expectedLockVersion: number,
): Promise<ActionResult<{ quote: Quote; event: QuoteStatusEvent }>> {
  const owner = await requireOwner();
  const parsed = quoteStatusTransitionSchema.safeParse({
    fromStatus,
    toStatus,
    expectedLockVersion,
  });
  if (!parsed.success) {
    // The schema's `superRefine` adds FSM-violation issues at path
    // ["toStatus"]; enum mismatches on either status also land there.
    const isStatusIssue = parsed.error.issues.some(
      (issue) =>
        (issue.path.length === 1 && issue.path[0] === "toStatus") ||
        (issue.path.length === 1 && issue.path[0] === "fromStatus"),
    );
    return failure(isStatusIssue ? "INVALID_STATUS" : "INVALID_INPUT", parsed.error.message);
  }
  try {
    const result = await transitionQuoteStatus(
      owner.id,
      quoteId,
      parsed.data.fromStatus,
      parsed.data.toStatus,
      parsed.data.expectedLockVersion,
    );
    revalidatePath("/quotes");
    revalidatePath(`/quotes/${quoteId}`);
    return { ok: true, value: result };
  } catch (error) {
    return mapRepositoryError(error);
  }
}
