import "server-only";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../../db/client";
import { materials, templateItems } from "../../../db/schema";
import {
  materialInputSchema,
  type MaterialInput,
  type ParsedMaterialInput,
} from "../validation/materialSchema";

/**
 * PR2.auth-core (Task 2.8) — Materials repository rewritten for the user
 * era. Every public function takes a `userId: string` parameter and
 * scopes every read/write by it. The DB column is `user_id` (renamed in
 * PR1.migration); the JS-side `ownerId` compat shim is gone.
 *
 * PR4.per-user-isolation (Task 4.3) — Id-enumeration defense: every
 * cross-user detail returns `null` and every cross-user write throws
 * `MaterialRepositoryError("NOT_FOUND")`. The action layer maps both
 * surfaces to a generic "Material could not be found" message so an
 * attacker cannot distinguish "id does not exist" from "id belongs to
 * another user" — see `tests/integration/data-isolation.test.ts` for
 * the contract proof.
 *
 * Caller invariant: `userId` is sourced from `requireUser()` only. No
 * caller may supply a different id; cross-user attempts surface as
 * `NOT_FOUND`.
 */

export type Material = typeof materials.$inferSelect;

export class MaterialRepositoryError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "DUPLICATE_NAME" | "BASE_UNIT_REFERENCED",
    message: string,
  ) {
    super(message);
    this.name = "MaterialRepositoryError";
  }
}

type MaterialVisibility = { includeArchived?: boolean };

function notFound(id: string): MaterialRepositoryError {
  return new MaterialRepositoryError("NOT_FOUND", `Material "${id}" was not found`);
}

function duplicateName(name: string): MaterialRepositoryError {
  return new MaterialRepositoryError("DUPLICATE_NAME", `Material name "${name}" is already used`);
}

// R3-001 prerequisite guard. Template items persist quantities normalized to
// the material's baseUnit at write time (see templateSchema). If a referenced
// material's baseUnit flipped, every persisted quantity would silently
// change meaning — templates created against g would now resolve as if the
// unit were kg. Both active and archived templates count, because history
// must remain semantically stable across the archive boundary.
function baseUnitReferenced(id: string): MaterialRepositoryError {
  return new MaterialRepositoryError(
    "BASE_UNIT_REFERENCED",
    `Material "${id}" base unit cannot change while referenced by templates`,
  );
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

async function hasNameConflict(userId: string, name: string): Promise<boolean> {
  const conditions = [eq(materials.userId, userId), eq(materials.name, name)];
  return (
    (
      await db
        .select({ id: materials.id })
        .from(materials)
        .where(and(...conditions))
        .limit(1)
    ).length > 0
  );
}

function parseInput(input: MaterialInput): ParsedMaterialInput {
  return materialInputSchema.parse(input);
}

export async function listMaterials(
  userId: string,
  visibility: MaterialVisibility = {},
): Promise<Material[]> {
  const conditions = [eq(materials.userId, userId)];
  if (!visibility.includeArchived) conditions.push(isNull(materials.archivedAt));
  return db
    .select()
    .from(materials)
    .where(and(...conditions))
    .orderBy(asc(materials.name), asc(materials.id));
}

export async function getMaterial(
  userId: string,
  id: string,
  visibility: MaterialVisibility = {},
): Promise<Material | null> {
  const conditions = [eq(materials.userId, userId), eq(materials.id, id)];
  if (!visibility.includeArchived) conditions.push(isNull(materials.archivedAt));
  const rows = await db
    .select()
    .from(materials)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

// R3-002: lets the page decide between the truly-empty empty state and the
// "no active materials, archived exist" empty state without a second full
// material fetch.
export async function countArchivedMaterials(userId: string): Promise<number> {
  const rows = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, userId), isNotNull(materials.archivedAt)));
  return rows.length;
}

export async function createMaterial(userId: string, input: MaterialInput): Promise<Material> {
  const parsed = parseInput(input);
  if (await hasNameConflict(userId, parsed.name)) throw duplicateName(parsed.name);
  try {
    const [material] = await db
      .insert(materials)
      .values({ id: crypto.randomUUID(), userId, ...parsed })
      .returning();
    return material;
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName(parsed.name);
    throw error;
  }
}

export async function updateMaterial(
  userId: string,
  id: string,
  input: MaterialInput,
): Promise<Material> {
  const parsed = parseInput(input);
  try {
    return await db.transaction(async (tx) => {
      // R3-001 prerequisite guard. Lock the user-scoped active row FOR
      // UPDATE so we can compare baseUnit and check template_items
      // references safely without a TOCTOU window. Lock-order invariant:
      // updateMaterial takes the material lock first; updateTemplate takes
      // the template lock first then a shared material lock. Since neither
      // path acquires the same lock type on (template, materials) in
      // reverse order, deadlock is unreachable.
      const [current] = await tx
        .select({ baseUnit: materials.baseUnit })
        .from(materials)
        .where(
          and(eq(materials.userId, userId), eq(materials.id, id), isNull(materials.archivedAt)),
        )
        .for("update");
      if (!current) throw notFound(id);
      if (parsed.baseUnit !== current.baseUnit) {
        // Template history must remain semantically stable, so referenced
        // materials (active or archived) cannot flip baseUnit. limit(1)
        // is the existence probe — we only need to know whether at least
        // one template_items row still points at this material.
        const [ref] = await tx
          .select({ id: templateItems.id })
          .from(templateItems)
          .where(eq(templateItems.materialId, id))
          .limit(1);
        if (ref) throw baseUnitReferenced(id);
      }
      const [material] = await tx
        .update(materials)
        .set(parsed)
        .where(
          and(eq(materials.userId, userId), eq(materials.id, id), isNull(materials.archivedAt)),
        )
        .returning();
      if (!material) throw notFound(id);
      return material;
    });
  } catch (error) {
    if (error instanceof MaterialRepositoryError) throw error;
    if (isUniqueViolation(error)) throw duplicateName(parsed.name);
    throw error;
  }
}

export async function archiveMaterial(userId: string, id: string): Promise<Material> {
  const [material] = await db
    .update(materials)
    .set({ archivedAt: new Date() })
    .where(and(eq(materials.userId, userId), eq(materials.id, id)))
    .returning();
  if (!material) throw notFound(id);
  return material;
}

export async function unarchiveMaterial(userId: string, id: string): Promise<Material> {
  const [material] = await db
    .update(materials)
    .set({ archivedAt: null })
    .where(and(eq(materials.userId, userId), eq(materials.id, id)))
    .returning();
  if (!material) throw notFound(id);
  return material;
}
