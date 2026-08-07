import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, like } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "../../../db/client";
import { materials, templateItems, templates } from "../../../db/schema";
import {
  createTemplateInputSchema,
  parseTemplateMeta,
  type ParsedTemplateInput,
  type TemplateInput,
  type TemplateMaterialReference,
} from "../validation/templateSchema";

// Calculator meta persisted alongside the derived unitCost. The repository
// stores whatever the input provides (already trimmed by the validation
// layer) as a verbatim numeric string so the column round-trip stays
// deterministic — empty strings collapse to "0" / "30" defaults at the DB.
const DEFAULT_TEMPLATE_META = {
  time: "0",
  hourlyRate: "0",
  overhead: "0",
  marginPct: "30",
} as const;

type TemplateMetaInput = Pick<TemplateInput, "time" | "hourlyRate" | "overhead" | "marginPct">;

function normalizeMeta(raw: TemplateMetaInput | undefined): {
  time: string;
  hourlyRate: string;
  overhead: string;
  marginPct: string;
} {
  if (!raw) return { ...DEFAULT_TEMPLATE_META };
  const trimmed = parseTemplateMeta(raw);
  return {
    time: trimmed.time === "" ? DEFAULT_TEMPLATE_META.time : trimmed.time,
    hourlyRate: trimmed.hourlyRate === "" ? DEFAULT_TEMPLATE_META.hourlyRate : trimmed.hourlyRate,
    overhead: trimmed.overhead === "" ? DEFAULT_TEMPLATE_META.overhead : trimmed.overhead,
    marginPct: trimmed.marginPct === "" ? DEFAULT_TEMPLATE_META.marginPct : trimmed.marginPct,
  };
}

export type Template = typeof templates.$inferSelect;
export type TemplateItem = typeof templateItems.$inferSelect;
export type TemplateRecord = { template: Template; items: TemplateItem[] };

type TemplateVisibility = { includeArchived?: boolean };

export class TemplateRepositoryError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "DUPLICATE_NAME" | "MATERIAL_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "TemplateRepositoryError";
  }
}

function duplicateName(name: string): TemplateRepositoryError {
  return new TemplateRepositoryError("DUPLICATE_NAME", `Template name "${name}" is already used`);
}

function materialUnavailable(): TemplateRepositoryError {
  return new TemplateRepositoryError("MATERIAL_UNAVAILABLE", "Template material is unavailable");
}

function notFound(id: string): TemplateRepositoryError {
  return new TemplateRepositoryError("NOT_FOUND", `Template "${id}" was not found`);
}

export async function findNextDefaultTemplateName(
  ownerId: string,
  prefix = "Nueva plantilla",
): Promise<string> {
  const rows = await db
    .select({ name: templates.name })
    .from(templates)
    .where(and(eq(templates.ownerId, ownerId), like(templates.name, `${prefix} %`)));
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffixPattern = new RegExp(`^${escapedPrefix} (\\d+)$`);
  let max = 0;
  for (const row of rows) {
    const match = row.name.match(suffixPattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix} ${max + 1}`;
}

// "no active templates, archived exist" empty state without a second full
// template fetch. Mirrors countArchivedMaterials so the page-level wiring
// is symmetric across the two catalogs.
export async function countArchivedTemplates(ownerId: string): Promise<number> {
  const rows = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.ownerId, ownerId), isNotNull(templates.archivedAt)));
  return rows.length;
}

function isUniqueViolation(error: unknown): boolean {
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

function materialReferences(
  rows: readonly (typeof materials.$inferSelect)[],
): TemplateMaterialReference[] {
  return rows.map((row) => ({
    id: row.id,
    ownerId: row.ownerId,
    baseUnit: row.baseUnit,
    unitCost: row.unitCost,
    archivedAt: row.archivedAt,
  }));
}

function parseInput(
  ownerId: string,
  input: TemplateInput,
  materialRows: readonly (typeof materials.$inferSelect)[],
): ParsedTemplateInput {
  try {
    return createTemplateInputSchema(ownerId, materialReferences(materialRows)).parse(input);
  } catch (error) {
    if (
      error instanceof ZodError &&
      error.issues.some(
        (issue) =>
          issue.message === "Material is unavailable" ||
          issue.message === "Archived materials cannot be added to templates",
      )
    ) {
      throw materialUnavailable();
    }
    throw error;
  }
}

async function readItems(
  rows: readonly Template[],
  query: typeof db,
): Promise<Map<string, TemplateItem[]>> {
  const ids = rows.map(({ id }) => id);
  if (ids.length === 0) return new Map();
  const items = await query
    .select()
    .from(templateItems)
    .where(inArray(templateItems.templateId, ids))
    .orderBy(asc(templateItems.templateId), asc(templateItems.position));
  const byTemplate = new Map<string, TemplateItem[]>();
  for (const item of items)
    byTemplate.set(item.templateId, [...(byTemplate.get(item.templateId) ?? []), item]);
  return byTemplate;
}

function records(
  rows: readonly Template[],
  byTemplate: Map<string, TemplateItem[]>,
): TemplateRecord[] {
  return rows.map((template) => ({ template, items: byTemplate.get(template.id) ?? [] }));
}

export async function listTemplates(
  ownerId: string,
  visibility: TemplateVisibility = {},
): Promise<TemplateRecord[]> {
  const conditions = [eq(templates.ownerId, ownerId)];
  if (!visibility.includeArchived) conditions.push(isNull(templates.archivedAt));
  const rows = await db
    .select()
    .from(templates)
    .where(and(...conditions))
    .orderBy(asc(templates.name), asc(templates.id));
  return records(rows, await readItems(rows, db));
}

export async function getTemplate(
  ownerId: string,
  id: string,
  visibility: TemplateVisibility = {},
): Promise<TemplateRecord | null> {
  const conditions = [eq(templates.ownerId, ownerId), eq(templates.id, id)];
  if (!visibility.includeArchived) conditions.push(isNull(templates.archivedAt));
  const rows = await db
    .select()
    .from(templates)
    .where(and(...conditions))
    .limit(1);
  if (rows.length === 0) return null;
  return records(rows, await readItems(rows, db))[0];
}

export async function createTemplate(
  ownerId: string,
  input: TemplateInput,
): Promise<TemplateRecord> {
  // FOR SHARE serializes the template validation snapshot against any
  // concurrent UPDATE on the owner's materials. While this transaction is
  // open, an in-flight archive or price update on those rows must wait for
  // our commit. Our SELECT then reads the latest committed snapshot once
  // the lock clears, closing the TOCTOU window between reading materials
  // for validation and inserting the template. Without FOR SHARE, a non-
  // locking SELECT could race past a just-committed archive or price edit
  // and produce a template referencing unavailable material or stale cost.
  return db.transaction(async (tx) => {
    const materialRows = await tx
      .select()
      .from(materials)
      .where(eq(materials.ownerId, ownerId))
      .for("share");
    const parsed = parseInput(ownerId, input, materialRows);
    const meta = normalizeMeta(input);

    const templateId = crypto.randomUUID();
    try {
      const [template] = await tx
        .insert(templates)
        .values({
          id: templateId,
          ownerId,
          name: parsed.name,
          unitCost: parsed.unitCost,
          time: meta.time,
          hourlyRate: meta.hourlyRate,
          overhead: meta.overhead,
          marginPct: meta.marginPct,
        })
        .returning();
      if (!template) {
        throw new TemplateRepositoryError("NOT_FOUND", `Template "${templateId}" was not found`);
      }
      const items: TemplateItem[] = parsed.items.map((item) => ({
        id: crypto.randomUUID(),
        templateId,
        position: item.position,
        materialId: item.materialId,
        quantity: item.quantity,
      }));
      await tx.insert(templateItems).values(items);
      return { template, items };
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(parsed.name);
      throw error;
    }
  });
}

// createBlankTemplate inserts an owner-scoped template row only, with no
// items. The workspace's "Nueva plantilla" CTA uses this to persist an
// empty placeholder before the user adds materials; the existing
// createTemplate path requires at least one item by schema, so this stays
// separate. Unique-name violations surface as DUPLICATE_NAME so the Server
// Action can map them to a friendly message. Optional meta lets callers
// seed default time/hourlyRate/overhead/marginPct; omitted values fall back
// to the schema defaults so the live summary widget never shows a NaN.
export async function createBlankTemplate(
  ownerId: string,
  name: string,
  meta: TemplateMetaInput = {},
): Promise<Template> {
  const templateId = crypto.randomUUID();
  const normalized = normalizeMeta(meta);
  try {
    const [template] = await db
      .insert(templates)
      .values({
        id: templateId,
        ownerId,
        name,
        unitCost: "0",
        time: normalized.time,
        hourlyRate: normalized.hourlyRate,
        overhead: normalized.overhead,
        marginPct: normalized.marginPct,
      })
      .returning();
    if (!template) {
      throw new TemplateRepositoryError("NOT_FOUND", `Template "${templateId}" was not found`);
    }
    return template;
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName(name);
    throw error;
  }
}

// deleteTemplateRow hard-deletes an owner-scoped template and its items.
// FOR UPDATE on the template row blocks concurrent archive / restore on
// the same id while the delete commits; the items cascade manually because
// the schema does not declare ON DELETE CASCADE on template_items. Cross-
// owner ids and missing ids both surface as NOT_FOUND.
export async function deleteTemplateRow(ownerId: string, id: string): Promise<void> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.ownerId, ownerId), eq(templates.id, id)))
      .for("update");
    if (!template) throw notFound(id);
    await tx.delete(templateItems).where(eq(templateItems.templateId, id));
    const [deleted] = await tx
      .delete(templates)
      .where(eq(templates.id, id))
      .returning({ id: templates.id });
    if (!deleted) throw notFound(id);
  });
}

export async function updateTemplate(
  ownerId: string,
  id: string,
  input: TemplateInput,
): Promise<TemplateRecord> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(templates)
      .where(
        and(eq(templates.ownerId, ownerId), eq(templates.id, id), isNull(templates.archivedAt)),
      )
      .for("update");
    if (!template) throw notFound(id);

    const materialRows = await tx
      .select()
      .from(materials)
      .where(eq(materials.ownerId, ownerId))
      .for("share");
    const parsed = parseInput(ownerId, input, materialRows);
    const meta = normalizeMeta(input);

    await tx.delete(templateItems).where(eq(templateItems.templateId, id));
    const items: TemplateItem[] = parsed.items.map((item) => ({
      id: crypto.randomUUID(),
      templateId: id,
      position: item.position,
      materialId: item.materialId,
      quantity: item.quantity,
    }));
    await tx.insert(templateItems).values(items);

    try {
      const [updated] = await tx
        .update(templates)
        .set({
          name: parsed.name,
          unitCost: parsed.unitCost,
          time: meta.time,
          hourlyRate: meta.hourlyRate,
          overhead: meta.overhead,
          marginPct: meta.marginPct,
        })
        .where(eq(templates.id, id))
        .returning();
      if (!updated) throw notFound(id);
      return { template: updated, items };
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName(parsed.name);
      throw error;
    }
  });
}

// archiveTemplate archives an active owner-scoped template and preserves its
// items. The transaction takes FOR UPDATE on the active template row only:
// - archived rows are excluded by `isNull(archivedAt)`, so re-archiving
//   and cross-owner / missing ids both surface as NOT_FOUND;
// - the items table is not touched, so any historical quote versions
//   referencing the template keep their snapshots verbatim.
// Materials are not touched, so no FOR SHARE on materials is required and
// the global lock-order invariant (template before materials whenever both
// are touched) does not apply on this path.
export async function archiveTemplate(ownerId: string, id: string): Promise<Template> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(templates)
      .where(
        and(eq(templates.ownerId, ownerId), eq(templates.id, id), isNull(templates.archivedAt)),
      )
      .for("update");
    if (!template) throw notFound(id);
    const [archived] = await tx
      .update(templates)
      .set({ archivedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();
    if (!archived) throw notFound(id);
    return archived;
  });
}

// restoreTemplate restores an archived owner-scoped template and preserves its
// items. Mirrors archiveTemplate: FOR UPDATE only on the archived row
// (`isNotNull(archivedAt)`), so already-active rows and cross-owner /
// missing ids surface as NOT_FOUND. Items stay intact across the
// transition; only archivedAt flips to NULL.
export async function restoreTemplate(ownerId: string, id: string): Promise<Template> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(templates)
      .where(
        and(eq(templates.ownerId, ownerId), eq(templates.id, id), isNotNull(templates.archivedAt)),
      )
      .for("update");
    if (!template) throw notFound(id);
    const [restored] = await tx
      .update(templates)
      .set({ archivedAt: null })
      .where(eq(templates.id, id))
      .returning();
    if (!restored) throw notFound(id);
    return restored;
  });
}
