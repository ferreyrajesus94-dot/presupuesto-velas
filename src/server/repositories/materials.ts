import "server-only";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../../../db/client";
import { materials } from "../../../db/schema";
import {
  materialInputSchema,
  type MaterialInput,
  type ParsedMaterialInput,
} from "../validation/materialSchema";

export type Material = typeof materials.$inferSelect;

export class MaterialRepositoryError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "DUPLICATE_NAME",
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

async function hasNameConflict(ownerId: string, name: string): Promise<boolean> {
  const conditions = [eq(materials.ownerId, ownerId), eq(materials.name, name)];
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
  ownerId: string,
  visibility: MaterialVisibility = {},
): Promise<Material[]> {
  const conditions = [eq(materials.ownerId, ownerId)];
  if (!visibility.includeArchived) conditions.push(isNull(materials.archivedAt));
  return db
    .select()
    .from(materials)
    .where(and(...conditions))
    .orderBy(asc(materials.name), asc(materials.id));
}

export async function getMaterial(
  ownerId: string,
  id: string,
  visibility: MaterialVisibility = {},
): Promise<Material | null> {
  const conditions = [eq(materials.ownerId, ownerId), eq(materials.id, id)];
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
export async function countArchivedMaterials(ownerId: string): Promise<number> {
  const rows = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.ownerId, ownerId), isNotNull(materials.archivedAt)));
  return rows.length;
}

export async function createMaterial(ownerId: string, input: MaterialInput): Promise<Material> {
  const parsed = parseInput(input);
  if (await hasNameConflict(ownerId, parsed.name)) throw duplicateName(parsed.name);
  try {
    const [material] = await db
      .insert(materials)
      .values({ id: crypto.randomUUID(), ownerId, ...parsed })
      .returning();
    return material;
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName(parsed.name);
    throw error;
  }
}

export async function updateMaterial(
  ownerId: string,
  id: string,
  input: MaterialInput,
): Promise<Material> {
  const parsed = parseInput(input);
  try {
    const [material] = await db
      .update(materials)
      .set(parsed)
      .where(
        and(eq(materials.ownerId, ownerId), eq(materials.id, id), isNull(materials.archivedAt)),
      )
      .returning();
    if (!material) throw notFound(id);
    return material;
  } catch (error) {
    if (error instanceof MaterialRepositoryError) throw error;
    if (isUniqueViolation(error)) throw duplicateName(parsed.name);
    throw error;
  }
}

export async function archiveMaterial(ownerId: string, id: string): Promise<Material> {
  const [material] = await db
    .update(materials)
    .set({ archivedAt: new Date() })
    .where(and(eq(materials.ownerId, ownerId), eq(materials.id, id)))
    .returning();
  if (!material) throw notFound(id);
  return material;
}

export async function unarchiveMaterial(ownerId: string, id: string): Promise<Material> {
  const [material] = await db
    .update(materials)
    .set({ archivedAt: null })
    .where(and(eq(materials.ownerId, ownerId), eq(materials.id, id)))
    .returning();
  if (!material) throw notFound(id);
  return material;
}
