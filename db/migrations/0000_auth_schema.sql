-- Enable citext for case-insensitive email (app_owner.email).
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."dimension" AS ENUM('mass', 'volume', 'length', 'count');--> statement-breakpoint
CREATE TYPE "public"."profit_method" AS ENUM('percentage', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "app_owner" (
	"id" text PRIMARY KEY NOT NULL,
	"email" "citext" NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	CONSTRAINT "app_owner_singleton_true" CHECK ("app_owner"."singleton" = true)
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"dimension" "dimension" NOT NULL,
	"base_unit" text NOT NULL,
	"purchase_unit" text NOT NULL,
	"purchase_quantity" numeric(24, 6) NOT NULL,
	"purchase_price" numeric(20, 2) NOT NULL,
	"unit_cost" numeric(38, 18) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_purchase_qty_pos" CHECK ("materials"."purchase_quantity" > 0),
	CONSTRAINT "materials_purchase_price_pos" CHECK ("materials"."purchase_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_status_events" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"from_status" "quote_status",
	"to_status" "quote_status" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_version_indirect_costs" (
	"quote_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	CONSTRAINT "quote_version_indirect_costs_quote_id_version_no_position_pk" PRIMARY KEY("quote_id","version_no","position"),
	CONSTRAINT "quote_version_indirect_pos_pos" CHECK ("quote_version_indirect_costs"."position" > 0),
	CONSTRAINT "quote_version_indirect_amount_nonneg" CHECK ("quote_version_indirect_costs"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quote_version_materials" (
	"quote_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"model_position" integer NOT NULL,
	"position" integer NOT NULL,
	"material_id" text NOT NULL,
	"material_name" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"unit_cost" numeric(38, 18) NOT NULL,
	"line_total" numeric(20, 2) NOT NULL,
	CONSTRAINT "quote_version_materials_quote_id_version_no_model_position_position_pk" PRIMARY KEY("quote_id","version_no","model_position","position"),
	CONSTRAINT "quote_version_materials_qty_pos" CHECK ("quote_version_materials"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_version_models" (
	"quote_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"position" integer NOT NULL,
	"recipe_id" text NOT NULL,
	"recipe_name" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	"unit_cost" numeric(38, 18) NOT NULL,
	"line_total" numeric(20, 2) NOT NULL,
	CONSTRAINT "quote_version_models_quote_id_version_no_position_pk" PRIMARY KEY("quote_id","version_no","position"),
	CONSTRAINT "quote_version_models_pos_pos" CHECK ("quote_version_models"."position" > 0),
	CONSTRAINT "quote_version_models_qty_pos" CHECK ("quote_version_models"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "quote_versions" (
	"quote_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"visibility_internal" boolean DEFAULT true NOT NULL,
	"visibility_profit" boolean DEFAULT true NOT NULL,
	"profit_method" "profit_method" NOT NULL,
	"profit_value" numeric(20, 2) NOT NULL,
	"deposit_percent" numeric(5, 2) NOT NULL,
	"materials_total" numeric(20, 2) NOT NULL,
	"indirect_total" numeric(20, 2) NOT NULL,
	"profit_amount" numeric(20, 2) NOT NULL,
	"final_price" numeric(20, 2) NOT NULL,
	"deposit_amount" numeric(20, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_versions_quote_id_version_no_pk" PRIMARY KEY("quote_id","version_no"),
	CONSTRAINT "quote_versions_no_pos" CHECK ("quote_versions"."version_no" > 0),
	CONSTRAINT "quote_versions_final_nonneg" CHECK ("quote_versions"."final_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"customer_name" text,
	"expiration_date" date NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"lock_version" bigint DEFAULT 0 NOT NULL,
	"duplicated_from_quote_id" text,
	"duplicated_from_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_items" (
	"id" text PRIMARY KEY NOT NULL,
	"recipe_id" text NOT NULL,
	"position" integer NOT NULL,
	"material_id" text NOT NULL,
	"quantity" numeric(24, 6) NOT NULL,
	CONSTRAINT "recipe_items_pos_pos" CHECK ("recipe_items"."position" > 0),
	CONSTRAINT "recipe_items_qty_pos" CHECK ("recipe_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"unit_cost" numeric(38, 18) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_status_events" ADD CONSTRAINT "quote_status_events_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_version_materials" ADD CONSTRAINT "quote_version_materials_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_version_models" ADD CONSTRAINT "quote_version_models_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_items" ADD CONSTRAINT "recipe_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owner_id_app_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_owner_email_uidx" ON "app_owner" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_owner_name_uidx" ON "materials" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "materials_owner_idx" ON "materials" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "quote_status_events_quote_idx" ON "quote_status_events" USING btree ("quote_id","occurred_at");--> statement-breakpoint
CREATE INDEX "quotes_owner_status_updated_idx" ON "quotes" USING btree ("owner_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "quotes_owner_expiration_open_idx" ON "quotes" USING btree ("owner_id","expiration_date") WHERE status NOT IN ('accepted', 'rejected');--> statement-breakpoint
CREATE INDEX "quotes_owner_idx" ON "quotes" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_items_recipe_pos_uidx" ON "recipe_items" USING btree ("recipe_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "recipes_owner_name_uidx" ON "recipes" USING btree ("owner_id","name");--> statement-breakpoint
CREATE INDEX "recipes_owner_idx" ON "recipes" USING btree ("owner_id");