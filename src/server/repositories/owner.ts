import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { appOwner, type AppOwner } from "../../../db/schema";

export async function getOwner(id: string): Promise<AppOwner | null> {
  const rows = await db.select().from(appOwner).where(eq(appOwner.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getSingletonOwner(): Promise<AppOwner | null> {
  const rows = await db.select().from(appOwner).where(eq(appOwner.singleton, true)).limit(1);
  return rows[0] ?? null;
}

export async function upsertOwner(input: { id: string; email: string }): Promise<AppOwner> {
  const [row] = await db
    .insert(appOwner)
    .values({ id: input.id, email: input.email, singleton: true })
    .onConflictDoUpdate({ target: appOwner.id, set: { email: input.email } })
    .returning();
  return row;
}
