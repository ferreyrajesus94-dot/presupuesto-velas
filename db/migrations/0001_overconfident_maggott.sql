ALTER TABLE "quote_version_indirect_costs" ADD CONSTRAINT "quote_version_indirect_costs_parent_fk" FOREIGN KEY ("quote_id","version_no") REFERENCES "public"."quote_versions"("quote_id","version_no") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_version_materials" ADD CONSTRAINT "quote_version_materials_model_parent_fk" FOREIGN KEY ("quote_id","version_no","model_position") REFERENCES "public"."quote_version_models"("quote_id","version_no","position") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_version_models" ADD CONSTRAINT "quote_version_models_parent_fk" FOREIGN KEY ("quote_id","version_no") REFERENCES "public"."quote_versions"("quote_id","version_no") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_owner_singleton_uidx" ON "app_owner" USING btree ((TRUE)) WHERE "app_owner"."singleton" = TRUE;--> statement-breakpoint
CREATE INDEX "quote_version_materials_material_idx" ON "quote_version_materials" USING btree ("material_id");--> statement-breakpoint
CREATE INDEX "quote_version_models_recipe_idx" ON "quote_version_models" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "quote_versions_quote_idx" ON "quote_versions" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "recipe_items_material_idx" ON "recipe_items" USING btree ("material_id");--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_units_compatible" CHECK (("materials"."dimension" = 'mass' AND "materials"."base_unit" IN ('g', 'kg') AND "materials"."purchase_unit" IN ('g', 'kg'))
        OR ("materials"."dimension" = 'volume' AND "materials"."base_unit" IN ('ml', 'L') AND "materials"."purchase_unit" IN ('ml', 'L'))
        OR ("materials"."dimension" = 'length' AND "materials"."base_unit" IN ('cm', 'm') AND "materials"."purchase_unit" IN ('cm', 'm'))
        OR ("materials"."dimension" = 'count' AND "materials"."base_unit" = 'unit' AND "materials"."purchase_unit" = 'unit'));--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_count_integral" CHECK ("materials"."dimension" <> 'count' OR "materials"."purchase_quantity" = FLOOR("materials"."purchase_quantity"));