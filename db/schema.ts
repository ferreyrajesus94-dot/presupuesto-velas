import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
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
    // Table-wide singleton: at most one row with singleton = true.
    uniqueIndex("app_owner_singleton_uidx")
      .on(sql`(TRUE)`)
      .where(sql`${t.singleton} = TRUE`),
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
    // Compatible base/purchase units: must share the same dimension.
    // `mass`: g|kg; `volume`: ml|L; `length`: cm|m; `count`: unit.
    check(
      "materials_units_compatible",
      sql`(${t.dimension} = 'mass' AND ${t.baseUnit} IN ('g', 'kg') AND ${t.purchaseUnit} IN ('g', 'kg'))
        OR (${t.dimension} = 'volume' AND ${t.baseUnit} IN ('ml', 'L') AND ${t.purchaseUnit} IN ('ml', 'L'))
        OR (${t.dimension} = 'length' AND ${t.baseUnit} IN ('cm', 'm') AND ${t.purchaseUnit} IN ('cm', 'm'))
        OR (${t.dimension} = 'count' AND ${t.baseUnit} = 'unit' AND ${t.purchaseUnit} = 'unit')`,
    ),
    // Count integrality: when dimension = count, purchase_quantity must be integer.
    check(
      "materials_count_integral",
      sql`${t.dimension} <> 'count' OR ${t.purchaseQuantity} = FLOOR(${t.purchaseQuantity})`,
    ),
  ],
);

// Templates -------------------------------------------------------------
// Calculator meta (time, hourly_rate, overhead, margin_pct) is persisted
// alongside the derived unitCost so the workspace's live summary survives a
// page refresh. Stored verbatim as decimal strings — the calculator's summary
// helper already tolerates missing or empty values via safeDecimal(0).
export const templates = pgTable(
  "templates",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => appOwner.id),
    name: text("name").notNull(),
    unitCost: numeric("unit_cost", { precision: 38, scale: 18 }).notNull(),
    time: numeric("time", { precision: 20, scale: 6 }).notNull().default("0"),
    hourlyRate: numeric("hourly_rate", { precision: 20, scale: 6 }).notNull().default("0"),
    overhead: numeric("overhead", { precision: 20, scale: 6 }).notNull().default("0"),
    marginPct: numeric("margin_pct", { precision: 20, scale: 6 }).notNull().default("30"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("templates_owner_name_uidx").on(t.ownerId, t.name),
    index("templates_owner_idx").on(t.ownerId),
  ],
);

export const templateItems = pgTable(
  "template_items",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id),
    position: integer("position").notNull(),
    materialId: text("material_id")
      .notNull()
      .references(() => materials.id),
    quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("template_items_template_pos_uidx").on(t.templateId, t.position),
    index("template_items_material_idx").on(t.materialId),
    check("template_items_pos_pos", sql`${t.position} > 0`),
    check("template_items_qty_pos", sql`${t.quantity} > 0`),
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
    index("quote_versions_quote_idx").on(t.quoteId),
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
    templateId: text("template_id")
      .notNull()
      .references(() => templates.id),
    templateName: text("template_name").notNull(),
    quantity: numeric("quantity", { precision: 24, scale: 6 }).notNull(),
    unitCost: numeric("unit_cost", { precision: 38, scale: 18 }).notNull(),
    lineTotal: numeric("line_total", { precision: 20, scale: 2 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.quoteId, t.versionNo, t.position] }),
    foreignKey({
      columns: [t.quoteId, t.versionNo],
      foreignColumns: [quoteVersions.quoteId, quoteVersions.versionNo],
      name: "quote_version_models_parent_fk",
    }).onDelete("cascade"),
    index("quote_version_models_template_idx").on(t.templateId),
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
    foreignKey({
      columns: [t.quoteId, t.versionNo, t.modelPosition],
      foreignColumns: [
        quoteVersionModels.quoteId,
        quoteVersionModels.versionNo,
        quoteVersionModels.position,
      ],
      name: "quote_version_materials_model_parent_fk",
    }).onDelete("cascade"),
    index("quote_version_materials_material_idx").on(t.materialId),
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
    foreignKey({
      columns: [t.quoteId, t.versionNo],
      foreignColumns: [quoteVersions.quoteId, quoteVersions.versionNo],
      name: "quote_version_indirect_costs_parent_fk",
    }).onDelete("cascade"),
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
