import { and, eq } from "drizzle-orm";

/**
 * PR4.per-user-isolation (Task 4.1) — shared context for the data-isolation
 * integration suite. Lives in its own module so the parent test file can
 * skip `await import("../db/client")` (which throws without DATABASE_URL)
 * on workstations that don't have a live DB. The parent guards the import
 * with the same env flag it uses to gate the suite.
 */

export const uniqueId = () => `pv4-${crypto.randomUUID()}`;

const [{ db }, schema, materials, templates, quotes] = await Promise.all([
  import("../../db/client"),
  import("../../db/schema"),
  import("../../src/server/repositories/materials"),
  import("../../src/server/repositories/templates"),
  import("../../src/server/repositories/quotes"),
]);

export { db, materials, schema, templates, quotes };

export async function createTestUser(label: string): Promise<string> {
  const id = uniqueId();
  await db.insert(schema.appUser).values({
    id,
    email: `${label}-${id}@calculadora-flor-test.invalid`,
    role: "user",
    emailVerified: true,
  });
  return id;
}

async function deleteRow(
  table: typeof schema.materials | typeof schema.templates | typeof schema.quotes,
  id: string,
  userId: string,
) {
  await db.delete(table).where(and(eq(table.id, id), eq(table.userId, userId)));
}

export type CleanupPayload = {
  userA: string;
  materialIds: Set<string>;
  templateIds: Set<string>;
  quoteIds: Set<string>;
  createdUserIds: Set<string>;
};

export async function cleanup(payload: CleanupPayload): Promise<void> {
  const { userA, materialIds, templateIds, quoteIds, createdUserIds } = payload;
  for (const id of materialIds) await deleteRow(schema.materials, id, userA);
  for (const id of templateIds) {
    await db.delete(schema.templateItems).where(eq(schema.templateItems.templateId, id));
    await deleteRow(schema.templates, id, userA);
  }
  for (const id of quoteIds) await deleteRow(schema.quotes, id, userA);
  for (const id of createdUserIds) {
    await db.delete(schema.appUser).where(eq(schema.appUser.id, id));
  }
}
