import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// citext is a case-insensitive text type. We enable the extension in
// db/migrations/0001_enable_citext.sql and use this custom type here.
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

// Enums -----------------------------------------------------------------
export const dimension = pgEnum("dimension", ["mass", "volume", "length", "count"]);
export const quoteStatus = pgEnum("quote_status", ["draft", "sent", "accepted", "rejected"]);
export const profitMethod = pgEnum("profit_method", ["percentage", "fixed"]);

// Owner -----------------------------------------------------------------
export const appOwner = pgTable(
  "app_owner",
  {
    id: text("id").primaryKey(),
    email: citext("email").notNull(),
    singleton: boolean("singleton").notNull().default(true),
  },
  (t) => [
    uniqueIndex("app_owner_email_uidx").on(t.email),
    check("app_owner_singleton_true", sql`${t.singleton} = true`),
  ],
);
export type AppOwner = typeof appOwner.$inferSelect;

// Materials -------------------------------------------------------------
export const materials = pgTable(
  "materials",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => appOwner.id),
    name: text("name").notNull(),
    dimension: dimension("dimension").notNull(),
    baseUnit: text("base_unit").notNull(),
    purchaseUnit: text("purchase_unit").notNull(),
    purchaseQuantity: numeric("purchase_quantity", {
      precision: 24,
      scale: 6,
    }).notNull(),
    purchasePrice: numeric("purchase_price", {
      precision: 20,
      scale: 2,
    }).notNull(),
    unitCost: numeric("unit_cost", { precision: 38, scale: 18 }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("materials_owner_name_uidx").on(t.ownerId, t.name),
    index("materials_owner_idx").on(t.ownerId),
    check("materials_purchase_qty_pos", sql`${t.purchaseQuantity} > 0`),
    check("materials_purchase_price_pos", sql`${t.purchasePrice} > 0`),
  ],
);

// Recipes ---------------------------------------------------------------
export const recipes = pgTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => appOwner.id),
    name: text("name").notNull(),
    unitCost: numeric("unit_cost", { precision: 38, scale: 18 }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("recipes_owner_name_uidx").on(t.ownerId, t.name),
    index("recipes_owner_idx").on(t.ownerId),
  ],
);

export const recipeItems = pgTable(
  "recipe_items",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id),
    position: integer("position").notNull(),
    materialId: text("material_id")
      .notNull()
      .references(() => materials.id),
    quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("recipe_items_recipe_pos_uidx").on(t.recipeId, t.position),
    check("recipe_items_pos_pos", sql`${t.position} > 0`),
    check("recipe_items_qty_pos", sql`${t.quantity} > 0`),
  ],
);

// Quotes ----------------------------------------------------------------
export const quotes = pgTable(
  "quotes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => appOwner.id),
    customerName: text("customer_name"),
    expirationDate: date("expiration_date").notNull(),
    status: quoteStatus("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(0),
    lockVersion: bigint("lock_version", { mode: "number" }).notNull().default(0),
    duplicatedFromQuoteId: text("duplicated_from_quote_id"),
    duplicatedFromVersion: integer("duplicated_from_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("quotes_owner_status_updated_idx").on(t.ownerId, t.status, t.updatedAt),
    index("quotes_owner_expiration_open_idx")
      .on(t.ownerId, t.expirationDate)
      .where(sql`status NOT IN ('accepted', 'rejected')`),
    index("quotes_owner_idx").on(t.ownerId),
  ],
);

export const quoteVersions = pgTable(
  "quote_versions",
  {
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id),
    versionNo: integer("version_no").notNull(),
    visibilityInternal: boolean("visibility_internal").notNull().default(true),
    visibilityProfit: boolean("visibility_profit").notNull().default(true),
    profitMethod: profitMethod("profit_method").notNull(),
    profitValue: numeric("profit_value", { precision: 20, scale: 2 }).notNull(),
    depositPercent: numeric("deposit_percent", {
      precision: 5,
      scale: 2,
    }).notNull(),
    materialsTotal: numeric("materials_total", {
      precision: 20,
      scale: 2,
    }).notNull(),
    indirectTotal: numeric("indirect_total", {
      precision: 20,
      scale: 2,
    }).notNull(),
    profitAmount: numeric("profit_amount", {
      precision: 20,
      scale: 2,
    }).notNull(),
    finalPrice: numeric("final_price", { precision: 20, scale: 2 }).notNull(),
    depositAmount: numeric("deposit_amount", {
      precision: 20,
      scale: 2,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteId, t.versionNo] }),
    check("quote_versions_no_pos", sql`${t.versionNo} > 0`),
    check("quote_versions_final_nonneg", sql`${t.finalPrice} >= 0`),
  ],
);

export const quoteVersionModels = pgTable(
  "quote_version_models",
  {
    quoteId: text("quote_id").notNull(),
    versionNo: integer("version_no").notNull(),
    position: integer("position").notNull(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => recipes.id),
    recipeName: text("recipe_name").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 38, scale: 18 }).notNull(),
    lineTotal: numeric("line_total", { precision: 20, scale: 2 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteId, t.versionNo, t.position] }),
    check("quote_version_models_pos_pos", sql`${t.position} > 0`),
    check("quote_version_models_qty_pos", sql`${t.quantity} > 0`),
  ],
);

export const quoteVersionMaterials = pgTable(
  "quote_version_materials",
  {
    quoteId: text("quote_id").notNull(),
    versionNo: integer("version_no").notNull(),
    modelPosition: integer("model_position").notNull(),
    position: integer("position").notNull(),
    materialId: text("material_id")
      .notNull()
      .references(() => materials.id),
    materialName: text("material_name").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 38, scale: 18 }).notNull(),
    lineTotal: numeric("line_total", { precision: 20, scale: 2 }).notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.quoteId, t.versionNo, t.modelPosition, t.position],
    }),
    check("quote_version_materials_qty_pos", sql`${t.quantity} > 0`),
  ],
);

export const quoteVersionIndirectCosts = pgTable(
  "quote_version_indirect_costs",
  {
    quoteId: text("quote_id").notNull(),
    versionNo: integer("version_no").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteId, t.versionNo, t.position] }),
    check("quote_version_indirect_pos_pos", sql`${t.position} > 0`),
    check("quote_version_indirect_amount_nonneg", sql`${t.amount} >= 0`),
  ],
);

export const quoteStatusEvents = pgTable(
  "quote_status_events",
  {
    id: text("id").primaryKey(),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quotes.id),
    fromStatus: quoteStatus("from_status"),
    toStatus: quoteStatus("to_status").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quote_status_events_quote_idx").on(t.quoteId, t.occurredAt)],
);
