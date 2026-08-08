-- Migration: 0004_auth_public_signup.sql
-- PR1.migration of auth-public-signup.
--
-- Hand-written because drizzle-kit's generator does NOT emit `IF NOT EXISTS`
-- / `IF EXISTS` qualifiers, and this migration MUST be safe to re-run on a
-- partially-applied state (e.g. interrupted after step a, before step d).
--
-- Steps (all inside one transaction so the orphan window between renames
-- is impossible):
--   (a) CREATE TYPE app_role + CREATE TABLE app_user IF NOT EXISTS
--   (b) Seed the original owner row from app_owner with role='owner'
--   (c) Rename owner_id -> user_id AND retarget every FK to app_user.id
--       in one operation per table
--   (d) DROP TABLE app_owner IF EXISTS
--
-- Every DDL uses IF NOT EXISTS / IF EXISTS or DO blocks with EXCEPTION
-- handlers, so re-running on a partially-applied state is safe and the
-- migration is verified idempotent by
-- tests/integration/app-user-migration.test.ts.

BEGIN;--> statement-breakpoint

-- (a) Enum + new user table.
DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('owner', 'user');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS app_user (
  id text PRIMARY KEY,
  email citext NOT NULL UNIQUE,
  role app_role NOT NULL DEFAULT 'user',
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

-- (b) Seed the original owner row from app_owner. Skip when the row has
-- already been promoted (e.g. on a re-run). Use to_regclass() instead of
-- EXISTS(SELECT 1 FROM app_owner) because referencing a missing table
-- inside a PL/pgSQL block raises an error rather than returning false.
DO $$ BEGIN
  IF to_regclass('public.app_owner') IS NOT NULL THEN
    INSERT INTO app_user (id, email, role, email_verified, created_at, updated_at)
    SELECT id, email, 'owner', true, now(), now()
    FROM app_owner
    WHERE NOT EXISTS (
      SELECT 1 FROM app_user WHERE app_user.email = app_owner.email
    );
  END IF;
END $$;--> statement-breakpoint

-- (c) Rename columns owner_id -> user_id. Idempotent: only rename if the
-- old column still exists. The DO block raises no error on re-run because
-- the IF guard skips silently.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'materials' AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE materials RENAME COLUMN owner_id TO user_id;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE templates RENAME COLUMN owner_id TO user_id;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'quotes' AND column_name = 'owner_id'
  ) THEN
    ALTER TABLE quotes RENAME COLUMN owner_id TO user_id;
  END IF;
END $$;--> statement-breakpoint

-- Drop the legacy FK constraints and add the renamed ones. The DO blocks
-- make this safe on a re-run (the old constraint is already gone, the
-- new one already exists).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'materials_owner_id_app_owner_id_fk'
  ) THEN
    ALTER TABLE materials DROP CONSTRAINT materials_owner_id_app_owner_id_fk;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'materials_user_id_app_user_id_fk'
  ) THEN
    ALTER TABLE materials
      ADD CONSTRAINT materials_user_id_app_user_id_fk
      FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'templates_owner_id_app_owner_id_fk'
  ) THEN
    ALTER TABLE templates DROP CONSTRAINT templates_owner_id_app_owner_id_fk;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'templates_user_id_app_user_id_fk'
  ) THEN
    ALTER TABLE templates
      ADD CONSTRAINT templates_user_id_app_user_id_fk
      FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotes_owner_id_app_owner_id_fk'
  ) THEN
    ALTER TABLE quotes DROP CONSTRAINT quotes_owner_id_app_owner_id_fk;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotes_user_id_app_user_id_fk'
  ) THEN
    ALTER TABLE quotes
      ADD CONSTRAINT quotes_user_id_app_user_id_fk
      FOREIGN KEY (user_id) REFERENCES public.app_user(id) ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- Rename indexes. Idempotent: ALTER INDEX ... RENAME TO ... would raise
-- "already exists" on re-run, so guard with IF EXISTS on the source name.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'materials_owner_name_uidx') THEN
    ALTER INDEX materials_owner_name_uidx RENAME TO materials_user_name_uidx;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'materials_owner_idx') THEN
    ALTER INDEX materials_owner_idx RENAME TO materials_user_idx;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'templates_owner_name_uidx') THEN
    ALTER INDEX templates_owner_name_uidx RENAME TO templates_user_name_uidx;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'templates_owner_idx') THEN
    ALTER INDEX templates_owner_idx RENAME TO templates_user_idx;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'quotes_owner_status_updated_idx') THEN
    ALTER INDEX quotes_owner_status_updated_idx RENAME TO quotes_user_status_updated_idx;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'quotes_owner_expiration_open_idx') THEN
    ALTER INDEX quotes_owner_expiration_open_idx RENAME TO quotes_user_expiration_open_idx;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'quotes_owner_idx') THEN
    ALTER INDEX quotes_owner_idx RENAME TO quotes_user_idx;
  END IF;
END $$;--> statement-breakpoint

-- (d) Drop legacy. Safe even when app_owner never existed (e.g. test env).
DROP TABLE IF EXISTS app_owner;--> statement-breakpoint

COMMIT;