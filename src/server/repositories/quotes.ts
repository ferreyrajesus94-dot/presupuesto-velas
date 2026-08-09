import "server-only";
import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "../../../db/client";
import {
  quoteStatusEvents,
  quoteVersionIndirectCosts,
  quoteVersionMaterials,
  quoteVersionModels,
  quoteVersions,
  quotes,
} from "../../../db/schema";

// Types ------------------------------------------------------------------

export type Quote = typeof quotes.$inferSelect;
export type QuoteVersion = typeof quoteVersions.$inferSelect;
export type QuoteVersionModel = typeof quoteVersionModels.$inferSelect;
export type QuoteVersionMaterial = typeof quoteVersionMaterials.$inferSelect;
export type QuoteVersionIndirectCost = typeof quoteVersionIndirectCosts.$inferSelect;

/**
 * PR2.auth-core (Task 2.8) — User-scoped quote record returned by
 * `listQuotes` / `getQuote`. Children are loaded eagerly by `getQuote`
 * and returned empty by `listQuotes` — PR4b keeps the list read
 * lightweight. PR4f (list UI) will add child data loading for the list
 * path as needed.
 *
 * PR4.per-user-isolation (Task 4.3) — Id-enumeration defense: every
 * cross-user detail returns `null` (handled by the page-level
 * `notFound()`), and every cross-user write — `deleteQuoteDraft`,
 * `appendQuoteVersion`, `transitionQuoteStatus` — throws
 * `QuoteRepositoryError("NOT_FOUND")`. The action layer maps the
 * discriminated result of `deleteQuoteDraft` 1:1 so callers can
 * distinguish success from typed failure without leaking whether the id
 * exists for another user. Contract proof:
 * `tests/integration/data-isolation.test.ts`.
 *
 * Caller invariant: every read/write in this file is scoped by `userId`,
 * which is sourced from `requireUser()` only.
 */
export interface QuoteRecord {
  quote: Quote;
  versions: QuoteVersion[];
  models: QuoteVersionModel[];
  materials: QuoteVersionMaterial[];
  indirectCosts: QuoteVersionIndirectCost[];
}

/**
 * Visibility controls. `includeArchived` and `includeTerminal` are synonyms:
 * quotes have no `archivedAt` column, so terminal status (`accepted` /
 * `rejected`) plays the role of the "closed" set. The templates/quotas API
 * surface is symmetric.
 */
export type QuoteVisibility = { includeArchived?: boolean; includeTerminal?: boolean };

// Errors -----------------------------------------------------------------

/**
 * Typed error codes thrown by the quote repository.
 * PR4b (CRUD): `NOT_FOUND`, `INVALID_INPUT`. PR4b.append adds
 * `LOCK_VERSION_MISMATCH`, `TERMINAL_STATUS`. PR4c adds
 * `INVALID_STATUS`, `EXPIRED_SENT_CANNOT_ACCEPT`. The factories below
 * are exported so every transaction file can throw without re-declaring
 * the code/message conventions.
 */
export class QuoteRepositoryError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "LOCK_VERSION_MISMATCH"
      | "TERMINAL_STATUS"
      | "INVALID_STATUS"
      | "EXPIRED_SENT_CANNOT_ACCEPT",
    message: string,
  ) {
    super(message);
    this.name = "QuoteRepositoryError";
  }
}

export const notFound = (id: string) =>
  new QuoteRepositoryError("NOT_FOUND", `Quote "${id}" was not found`);

export const invalidInput = (message: string) => new QuoteRepositoryError("INVALID_INPUT", message);

export const lockVersionMismatch = (expected: number, actual: number) =>
  new QuoteRepositoryError(
    "LOCK_VERSION_MISMATCH",
    `expected lockVersion ${expected} but found ${actual}`,
  );

export const terminalStatus = (current: string) =>
  new QuoteRepositoryError(
    "TERMINAL_STATUS",
    `quote status "${current}" is terminal; duplicate to create a new version`,
  );

export const invalidStatus = (message: string) =>
  new QuoteRepositoryError("INVALID_STATUS", message);

export const expiredSentCannotAccept = () =>
  new QuoteRepositoryError(
    "EXPIRED_SENT_CANNOT_ACCEPT",
    "an expired sent quote cannot transition directly to accepted; duplicate it into a new draft",
  );

const EXPIRATION_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function validateExpirationDate(value: string): void {
  if (typeof value !== "string" || !EXPIRATION_DATE_REGEX.test(value)) {
    throw invalidInput(`expirationDate must be YYYY-MM-DD (got "${String(value)}")`);
  }
  // Calendar validity (reject e.g. "2026-02-31") via UTC midnight round-trip.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw invalidInput(`expirationDate is not a valid calendar date (got "${value}")`);
  }
}

// Same walker used in `src/server/repositories/templates.ts` — Postgres
// unique_violation is SQLSTATE 23505. Exported for PR4b.append (concurrent
// `version_no` allocation) and PR4c (status FSM) to detect races.
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      if ((current as { code?: unknown }).code === "23505") return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

// Quotes have no `archivedAt` column — terminal status (accepted|rejected)
// plays the role of the "closed" set. `includeArchived` and `includeTerminal`
// are synonyms so the templates/quotas API mirrors match.
function activeViewFilter(visibility: QuoteVisibility) {
  if (visibility.includeArchived || visibility.includeTerminal) return undefined;
  return inArray(quotes.status, ["draft", "sent"]);
}

function whereOf(conditions: Array<SQL | undefined>) {
  return and(...conditions.filter((c): c is SQL => c !== undefined));
}

// Reads ------------------------------------------------------------------

/**
 * Count of user-scoped terminal quotes. Mirrors `countArchivedRecipes`
 * (same intent: "is the active list empty, or are there closed records
 * hiding?"). Terminal status maps to the templates `archivedAt != null`.
 */
export async function countArchivedQuotes(userId: string): Promise<number> {
  const rows = await db
    .select({ id: quotes.id })
    .from(quotes)
    .where(and(eq(quotes.userId, userId), inArray(quotes.status, ["accepted", "rejected"])));
  return rows.length;
}

/**
 * User-scoped list. Default view excludes terminal quotes (the "active"
 * catalog: `draft` | `sent`). Children are returned empty; PR4f (list UI)
 * will add per-record child data loading.
 */
export async function listQuotes(
  userId: string,
  visibility: QuoteVisibility = {},
): Promise<QuoteRecord[]> {
  const rows = await db
    .select()
    .from(quotes)
    .where(whereOf([eq(quotes.userId, userId), activeViewFilter(visibility)]))
    .orderBy(asc(quotes.updatedAt), asc(quotes.id));
  return rows.map((quote) => ({
    quote,
    versions: [],
    models: [],
    materials: [],
    indirectCosts: [],
  }));
}

/**
 * Single user-scoped quote with all child rows loaded. Returns `null` for
 * missing id, cross-user queries, and terminal quotes under the default
 * (active) view. Children load in parallel.
 */
export async function getQuote(
  userId: string,
  id: string,
  visibility: QuoteVisibility = {},
): Promise<QuoteRecord | null> {
  const rows = await db
    .select()
    .from(quotes)
    .where(whereOf([eq(quotes.userId, userId), eq(quotes.id, id), activeViewFilter(visibility)]))
    .limit(1);
  const quote = rows[0];
  if (!quote) return null;
  const [versionRows, modelRows, materialRows, indirectRows] = await Promise.all([
    db.select().from(quoteVersions).where(eq(quoteVersions.quoteId, id)),
    db.select().from(quoteVersionModels).where(eq(quoteVersionModels.quoteId, id)),
    db.select().from(quoteVersionMaterials).where(eq(quoteVersionMaterials.quoteId, id)),
    db.select().from(quoteVersionIndirectCosts).where(eq(quoteVersionIndirectCosts.quoteId, id)),
  ]);
  return {
    quote,
    versions: versionRows,
    models: modelRows,
    materials: materialRows,
    indirectCosts: indirectRows,
  };
}

// Writes -----------------------------------------------------------------

export interface QuoteDraftInput {
  expirationDate: string;
  customerName?: string | null;
}

/**
 * Create a draft quote. `status` defaults to `'draft'`, `currentVersion`
 * and `lockVersion` start at 0 — the quote has no versions yet; the first
 * version is appended via `appendQuoteVersion` (PR4b.append).
 *
 * Every write runs inside a `db.transaction` for FK / default-value
 * consistency (design #998). Numeric values stay as canonical strings
 * (Drizzle `numeric` type) — no JS arithmetic on money.
 */
export async function createQuoteDraft(
  userId: string,
  input: QuoteDraftInput,
): Promise<QuoteRecord> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw invalidInput("userId must be a non-empty string");
  }
  validateExpirationDate(input.expirationDate);
  const id = crypto.randomUUID();
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .insert(quotes)
      .values({
        id,
        userId,
        customerName: input.customerName ?? null,
        expirationDate: input.expirationDate,
        status: "draft",
        currentVersion: 0,
        lockVersion: 0,
      })
      .returning();
    if (!quote) throw notFound(id);
    return { quote, versions: [], models: [], materials: [], indirectCosts: [] };
  });
}

// Re-export the version-append (PR4b.append) and status-FSM (PR4c)
// transactions from their dedicated modules so ergonomic consumers can
// import every quote repository call from one path. PR4e (server
// actions) will import both via these re-exports.
export { appendQuoteVersion } from "./quotes.append";
export { transitionQuoteStatus } from "./quotes.status";

// PR4h — Delete-on-draft. Discriminated-union result so the action layer
// can map success/failure to its `ActionResult<T>` envelope 1:1.
export type DeleteQuoteDraftResult =
  | { ok: true }
  | {
      ok: false;
      error: { code: "NOT_FOUND" | "TERMINAL_STATUS" | "INVALID_INPUT"; message: string };
    };

/**
 * Delete a draft quote and all of its child rows. User-scoped + status-checked
 * (only `draft` quotes can be deleted; `sent`, `accepted`, `rejected` must
 * either transition or be archived).
 *
 * The DB's FKs from `quote_status_events` and `quote_versions` are
 * `NO ACTION` (verified against information_schema) — Postgres refuses
 * the parent delete when child rows exist, surfacing as
 * `error: update or delete on table "quotes" violates foreign key
 * constraint`. So we explicitly tear down children in the right order
 * inside the same transaction:
 *
 *   1. `quote_version_materials` (FK → quote_versions)
 *   2. `quote_version_models`      (FK → quote_versions)
 *   3. `quote_version_indirect_costs` (FK → quote_versions)
 *   4. `quote_versions`             (FK → quotes)
 *   5. `quote_status_events`        (FK → quotes)
 *   6. `quotes`                     (the row we are deleting)
 */
export async function deleteQuoteDraft(
  userId: string,
  id: string,
): Promise<DeleteQuoteDraftResult> {
  if (typeof userId !== "string" || userId.length === 0) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "userId must be a non-empty string" },
    };
  }
  if (typeof id !== "string" || id.length === 0) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "quoteId must be a non-empty string" },
    };
  }
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.userId, userId), eq(quotes.id, id)))
      .for("update");
    if (!quote) {
      return { ok: false, error: { code: "NOT_FOUND", message: `Quote "${id}" was not found` } };
    }
    if (quote.status !== "draft") {
      return {
        ok: false,
        error: {
          code: "TERMINAL_STATUS",
          message: `quote status "${quote.status}" is not draft; delete is only allowed on drafts`,
        },
      };
    }
    // The FKs from `quote_status_events` and `quote_versions` are NO ACTION
    // (not CASCADE), so Postgres refuses the parent delete when children
    // exist. Walk the child tree in dependency order before removing the
    // parent.
    await tx.delete(quoteVersionMaterials).where(eq(quoteVersionMaterials.quoteId, id));
    await tx.delete(quoteVersionModels).where(eq(quoteVersionModels.quoteId, id));
    await tx.delete(quoteVersionIndirectCosts).where(
      eq(quoteVersionIndirectCosts.quoteId, id),
    );
    await tx.delete(quoteVersions).where(eq(quoteVersions.quoteId, id));
    await tx.delete(quoteStatusEvents).where(eq(quoteStatusEvents.quoteId, id));
    await tx.delete(quotes).where(eq(quotes.id, id));
    return { ok: true };
  });
}
