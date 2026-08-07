-- Migration: persist calculator meta on template rows.
-- The plantillas workspace's live summary is derived from `time`, `hourly_rate`,
-- `overhead`, and `margin_pct`. Until now these inputs only lived in client state
-- and were lost on every page refresh. Persisting them verbatim as numeric(20,6)
-- strings keeps the same precision contract used by template_items.quantity and
-- the materials.unitCost shape — every row that existed before this migration
-- will default to zero (margin defaults to 30%) so the live summary stays
-- stable across revalidation.

ALTER TABLE "templates" ADD COLUMN "time" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "hourly_rate" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "overhead" numeric(20, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "margin_pct" numeric(20, 6) DEFAULT '30' NOT NULL;