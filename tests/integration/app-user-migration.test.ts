import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeNeonTestDatabase } from "./assert-safe-neon-test-database";

assertSafeNeonTestDatabase();

const { db } = await import("../../db/client");

/**
 * PR1.migration — verify the idempotent `app_owner → app_user` migration
 * preserves the original owner row, retargets every foreign key to the new
 * `app_user.id` column, drops the legacy `app_owner` table, renames every
 * `owner_*` index, and survives a second run without producing duplicates.
 *
 * RED-first: every assertion below fails against the pre-PR1 schema (where
 * `app_owner` exists and `app_user` does not), and passes after the
 * migration in `db/migrations/0004_auth_public_signup.sql` is applied.
 */
describe("0004 auth_public_signup migration (integration vs dev branch)", () => {
  beforeAll(async () => {
    // No data setup: this test inspects schema state produced by the
    // migration, not domain rows. The `db` import is required so the safety
    // check runs against the dev branch before any assertions.
    await db.execute(sql`SELECT 1`);
  });

  afterAll(async () => {
    // Idempotency check is performed inside the `it` blocks; no teardown
    // here so a second invocation can verify the migration is re-runnable.
  });

  it("creates the `app_user` table with a `role app_role` enum column", async () => {
    const result = await db.execute(sql`
      SELECT column_name, data_type, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'app_user'
      ORDER BY ordinal_position
    `);
    type Column = {
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
    };
    const rows = (result as unknown as { rows: Column[] }).rows;
    const byName = new Map(rows.map((r) => [r.column_name, r]));

    expect(rows.length).toBeGreaterThan(0);
    const role = byName.get("role");
    expect(role?.udt_name).toBe("app_role");
    expect(role?.is_nullable).toBe("NO");

    const id = byName.get("id");
    expect(id?.data_type).toBe("text");

    const email = byName.get("email");
    expect(email?.data_type).toBe("citext");

    const emailVerified = byName.get("email_verified");
    expect(emailVerified?.data_type).toBe("boolean");
    expect(emailVerified?.is_nullable).toBe("NO");

    const createdAt = byName.get("created_at");
    expect(createdAt?.data_type).toBe("timestamp with time zone");

    const updatedAt = byName.get("updated_at");
    expect(updatedAt?.data_type).toBe("timestamp with time zone");
  });

  it("registers the `app_role` enum with `owner` and `user` values", async () => {
    const result = await db.execute(sql`
      SELECT enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'app_role'
      ORDER BY e.enumsortorder
    `);
    const labels = ((result as unknown as { rows: { enumlabel: string }[] }).rows).map(
      (r) => r.enumlabel,
    );
    expect(labels).toEqual(["owner", "user"]);
  });

  it("preserves the original owner row in `app_user` with role='owner'", async () => {
    // The bootstrap owner from the pre-PR1 `app_owner` table must be
    // promoted to `app_user` with role='owner' and email_verified=true.
    const result = await db.execute(sql`
      SELECT id, email, role::text AS role, email_verified
      FROM app_user
      WHERE role = 'owner'
    `);
    type Row = { id: string; email: string; role: string; email_verified: boolean };
    const rows = (result as unknown as { rows: Row[] }).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const owner = rows[0];
    expect(owner.role).toBe("owner");
    expect(owner.email_verified).toBe(true);
    expect(owner.id).toMatch(/[0-9a-f-]{36}/i);
    // email must be a valid (non-empty) identifier
    expect(owner.email.length).toBeGreaterThan(3);
  });

  it("retargets every domain-table FK from app_owner to app_user", async () => {
    const result = await db.execute(sql`
      SELECT conrelid::regclass::text AS table_name,
             conname,
             pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype = 'f'
        AND pg_get_constraintdef(oid) ILIKE '%app_user%'
      ORDER BY table_name, conname
    `);
    type Row = { table_name: string; conname: string; definition: string };
    const rows = (result as unknown as { rows: Row[] }).rows;

    // The three domain tables must each have a renamed FK pointing at
    // app_user.id using their user_id column.
    const byName = new Map(rows.map((r) => [r.conname, r]));
    expect(byName.get("materials_user_id_app_user_id_fk")?.definition).toMatch(
      /FOREIGN KEY \(user_id\) REFERENCES app_user\(id\)/i,
    );
    expect(byName.get("templates_user_id_app_user_id_fk")?.definition).toMatch(
      /FOREIGN KEY \(user_id\) REFERENCES app_user\(id\)/i,
    );
    expect(byName.get("quotes_user_id_app_user_id_fk")?.definition).toMatch(
      /FOREIGN KEY \(user_id\) REFERENCES app_user\(id\)/i,
    );
  });

  it("has dropped every legacy FK that referenced app_owner", async () => {
    const result = await db.execute(sql`
      SELECT conname, conrelid::regclass::text AS table_name
      FROM pg_constraint
      WHERE contype = 'f'
        AND pg_get_constraintdef(oid) ILIKE '%app_owner%'
    `);
    type Row = { conname: string; table_name: string };
    const rows = (result as unknown as { rows: Row[] }).rows;
    expect(rows).toEqual([]);
  });

  it("drops the legacy `app_owner` table and its indexes", async () => {
    const tables = await db.execute(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_owner'
    `);
    expect((tables as unknown as { rows: { tablename: string }[] }).rows).toEqual([]);

    const indexes = await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'app_owner'
    `);
    expect((indexes as unknown as { rows: { indexname: string }[] }).rows).toEqual([]);
  });

  it("renames every owner_* index to user_* and leaves no owner_* residue", async () => {
    const result = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE '%owner%'
        AND tablename IN ('materials', 'templates', 'quotes')
    `);
    type Row = { indexname: string };
    const rows = (result as unknown as { rows: Row[] }).rows;
    expect(rows).toEqual([]);

    // Spot-check the renamed indexes exist on the right tables/columns.
    const renamed = await db.execute(sql`
      SELECT indexname, tablename FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'materials_user_idx',
          'materials_user_name_uidx',
          'templates_user_idx',
          'templates_user_name_uidx',
          'quotes_user_idx',
          'quotes_user_status_updated_idx',
          'quotes_user_expiration_open_idx'
        )
      ORDER BY tablename, indexname
    `);
    type NamedRow = { indexname: string; tablename: string };
    const names = ((renamed as unknown as { rows: NamedRow[] }).rows).map((r) => r.indexname);
    expect(names).toEqual([
      "materials_user_idx",
      "materials_user_name_uidx",
      "quotes_user_expiration_open_idx",
      "quotes_user_idx",
      "quotes_user_status_updated_idx",
      "templates_user_idx",
      "templates_user_name_uidx",
    ]);
  });

  it("retargets the materials unique-name index to user_id column", async () => {
    // The composite unique index on materials(name, owner_id) must now be
    // (name, user_id). If the migration had not retargeted the index, the
    // Drizzle schema and DB would diverge and PR1 would fail CI.
    const result = await db.execute(sql`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'materials_user_name_uidx'
    `);
    type Row = { indexdef: string };
    const rows = (result as unknown as { rows: Row[] }).rows;
    expect(rows.length).toBe(1);
    expect(rows[0].indexdef.toLowerCase()).toContain("user_id");
    expect(rows[0].indexdef.toLowerCase()).not.toContain("owner_id");
  });

  it("is idempotent: every DDL survives a second execution without duplicating indexes or columns", async () => {
    // Re-running the migration must NOT throw `duplicate column`,
    // `duplicate index`, or `already exists` errors. We invoke the SQL file
    // via `psql` here so the test exercises the same path CI uses.
    // The exact path is `db/migrations/0004_auth_public_signup.sql`.
    const { execFileSync } = await import("node:child_process");
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dbUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DIRECT_URL ?? "";
    if (!dbUrl) {
      throw new Error(
        "DATABASE_URL_UNPOOLED or DIRECT_URL must be set for the idempotency check",
      );
    }
    const sqlPath = resolve(__dirname, "../../db/migrations/0004_auth_public_signup.sql");
    const body = readFileSync(sqlPath, "utf8");
    // First run
    execFileSync("psql", ["--single-transaction", "--set", "ON_ERROR_STOP=1", dbUrl], {
      input: body,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Second run — must succeed without duplicates
    execFileSync("psql", ["--single-transaction", "--set", "ON_ERROR_STOP=1", dbUrl], {
      input: body,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Confirm no duplicate indexes on app_user
    const dupAppUserIdx = await db.execute(sql`
      SELECT indexname, COUNT(*) AS occurrences
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'app_user'
      GROUP BY indexname
      HAVING COUNT(*) > 1
    `);
    expect(
      (dupAppUserIdx as unknown as { rows: { indexname: string; occurrences: number }[] }).rows,
    ).toEqual([]);

    // Confirm the owner row is still exactly one
    const owners = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM app_user WHERE role = 'owner'
    `);
    const ownerCount = (
      owners as unknown as { rows: { n: number }[] }
    ).rows[0].n;
    expect(ownerCount).toBe(1);
  });
});