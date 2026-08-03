import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "../../../db/client";
import { materials, templateItems, templates } from "../../../db/schema";
import {
  createTemplateInputSchema,
  type ParsedTemplateInput,
  type TemplateInput,
  type TemplateMaterialReference,
} from "../validation/templateSchema";

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

// Lets the page decide between the truly-empty empty state and the
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

function records(rows: readonly Template[], byTemplate: Map<string, TemplateItem[]>): TemplateRecord[] {
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

export async function createTemplate(ownerId: string, input: TemplateInput): Promise<TemplateRecord> {
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

    const templateId = crypto.randomUUID();
    try {
      const [template] = await tx
        .insert(templates)
        .values({ id: templateId, ownerId, name: parsed.name, unitCost: parsed.unitCost })
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

export async function updateTemplate(
  ownerId: string,
  id: string,
  input: TemplateInput,
): Promise<TemplateRecord> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(templates)
      .where(and(eq(templates.ownerId, ownerId), eq(templates.id, id), isNull(templates.archivedAt)))
      .for("update");
    if (!template) throw notFound(id);

    const materialRows = await tx
      .select()
      .from(materials)
      .where(eq(materials.ownerId, ownerId))
      .for("share");
    const parsed = parseInput(ownerId, input, materialRows);

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
        .set({ name: parsed.name, unitCost: parsed.unitCost })
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
      .where(and(eq(templates.ownerId, ownerId), eq(templates.id, id), isNull(templates.archivedAt)))
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
      .where(and(eq(templates.ownerId, ownerId), eq(templates.id, id), isNotNull(templates.archivedAt)))
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
