-- Migration: rename recipes → templates
-- Generated for: port-prototype-ui-overhaul, Phase 2
-- Order: drop FKs → rename tables → rename columns → rename indexes → rename
-- checks → rename FKs → re-add FK on quote_version_models.template_id.
-- Wrapped in a transaction so an orphan window between renames is impossible.

BEGIN;--> statement-breakpoint

-- 1. Drop the FK that references recipes so the rename does not collide with
--    the FK constraint name anchored to the recipes table.
ALTER TABLE "quote_version_models" DROP CONSTRAINT "quote_version_models_recipe_id_recipes_id_fk";--> statement-breakpoint

-- 2. Drop the FK on recipe_items that points at recipes as well.
ALTER TABLE "recipe_items" DROP CONSTRAINT "recipe_items_recipe_id_recipes_id_fk";--> statement-breakpoint

-- 3. Rename the two tables.
ALTER TABLE "recipes" RENAME TO "templates";--> statement-breakpoint
ALTER TABLE "recipe_items" RENAME TO "template_items";--> statement-breakpoint

-- 4. Rename columns: recipe_id → template_id on the two tables that hold it,
--    and recipe_name → template_name on quote_version_models.
ALTER TABLE "template_items" RENAME COLUMN "recipe_id" TO "template_id";--> statement-breakpoint
ALTER TABLE "quote_version_models" RENAME COLUMN "recipe_id" TO "template_id";--> statement-breakpoint
ALTER TABLE "quote_version_models" RENAME COLUMN "recipe_name" TO "template_name";--> statement-breakpoint

-- 5. Rename indexes that reference the old identifiers.
ALTER INDEX "recipes_owner_idx" RENAME TO "templates_owner_idx";--> statement-breakpoint
ALTER INDEX "recipes_owner_name_uidx" RENAME TO "templates_owner_name_uidx";--> statement-breakpoint
ALTER INDEX "recipe_items_recipe_pos_uidx" RENAME TO "template_items_template_pos_uidx";--> statement-breakpoint
ALTER INDEX "recipe_items_material_idx" RENAME TO "template_items_material_idx";--> statement-breakpoint
ALTER INDEX "quote_version_models_recipe_idx" RENAME TO "quote_version_models_template_idx";--> statement-breakpoint

-- 6. Rename the check constraints on template_items.
ALTER TABLE "template_items" RENAME CONSTRAINT "recipe_items_pos_pos" TO "template_items_pos_pos";--> statement-breakpoint
ALTER TABLE "template_items" RENAME CONSTRAINT "recipe_items_qty_pos" TO "template_items_qty_pos";--> statement-breakpoint

-- 7. Rename the FK constraint on template_items so the constraint name
--    matches the new table + column identifiers.
ALTER TABLE "template_items" RENAME CONSTRAINT "recipe_items_recipe_id_recipes_id_fk" TO "template_items_template_id_templates_id_fk";--> statement-breakpoint

-- 8. Re-add the FK on quote_version_models pointing at the renamed templates
--    table and the renamed template_id column.
ALTER TABLE "quote_version_models" ADD CONSTRAINT "quote_version_models_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

COMMIT;--> statement-breakpoint
