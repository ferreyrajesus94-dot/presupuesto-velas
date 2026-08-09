/**
 * One-shot data fix for materials whose `purchase_unit` equals `base_unit`
 * (e.g. baseUnit=g purchaseUnit=g). That shape only appeared during the
 * v0.4.6 QA smoke run, when the runner script was selecting 'Gramos'
 * for both selects before the smart-defaults fix landed. The math is
 * internally consistent (unitCost = purchasePrice / purchaseQuantity)
 * but the resulting unitCost is ~1000x too high for any material the
 * operator meant to buy in bulk (1 kg @ $5000 stored as 1 g @ $5000
 * = 5000/g instead of 5/g).
 *
 * This script:
 *   1. Scans every material in the DB.
 *   2. For each one with `purchase_unit === base_unit` AND `dimension`
 *      in {mass, volume, length}, it proposes a corrected shape where
 *      the purchase unit is bumped to the larger unit of the dimension
 *      and the purchase quantity is scaled by the same factor (so the
 *      absolute purchase stays the same — 1 g becomes 0.001 kg).
 *   3. Recalculates unitCost with the corrected shape.
 *   4. In `--apply` mode, writes the change and reports before/after.
 *
 * Run with --apply to commit the change; default is dry-run.
 */
import { neon } from "@neondatabase/serverless";

const APPLY = process.argv.includes("--apply");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const DIMENSION_BIG_UNIT: Record<string, string> = {
  mass: "kg",
  volume: "L",
  length: "m",
  count: "unit",
};

// Conversion factor from base_unit to the bigger unit of the same dimension.
// Mirrors src/domain/units.ts:CONVERSION_FACTORS (Decimal-free because we
// only need integer / power-of-10 factors here).
const BIG_UNIT_FACTOR: Record<string, number> = {
  kg: 1000, // 1 kg = 1000 g
  L: 1000, // 1 L = 1000 ml
  m: 100, // 1 m = 100 cm
  unit: 1,
};

interface MaterialRow {
  id: string;
  user_id: string;
  name: string;
  dimension: string;
  base_unit: string;
  purchase_unit: string;
  purchase_quantity: string;
  purchase_price: string;
  unit_cost: string;
}

async function main(): Promise<void> {
  const rows = (await sql`
    SELECT id, user_id, name, dimension, base_unit, purchase_unit,
           purchase_quantity::text AS purchase_quantity,
           purchase_price::text AS purchase_price,
           unit_cost::text AS unit_cost
    FROM materials
    WHERE archived_at IS NULL
    ORDER BY user_id, name
  `) as MaterialRow[];

  if (rows.length === 0) {
    console.log("No active materials found.");
    return;
  }

  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — scanning ${rows.length} active material(s)\n`);

  let changed = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.purchase_unit !== row.base_unit) {
      console.log(
        `⏭  ${row.name} (${row.dimension}/${row.base_unit}→${row.purchase_unit}) — units already differ, skipping`,
      );
      skipped += 1;
      continue;
    }
    const bigUnit = DIMENSION_BIG_UNIT[row.dimension];
    if (!bigUnit || bigUnit === row.base_unit) {
      console.log(
        `⏭  ${row.name} (${row.dimension}) — no larger unit in this dimension, skipping`,
      );
      skipped += 1;
      continue;
    }
    const factor = BIG_UNIT_FACTOR[bigUnit];
    // 0.1 kg, 0.01 m etc. lose precision as `numeric(6,6)`. Cap the resulting
    // quantity at 6 decimals to fit the column, and round the last digit.
    // Assume the operator meant the bigger purchase unit. The previous
    // shape (e.g. `1 g @ $5000`) only appeared because the QA runner
    // script was selecting the same unit for both selects before the
    // smart-defaults fix landed. A `1 g @ $5000` candle-wax line is
    // economically nonsensical — every candle maker buys wax in
    // kilograms, not grams — so we re-interpret the row as `1 kg @ $5000`
    // and normalize the unit cost to per-base-unit terms.
    const newQty = 1;
    const newPrice = Number(row.purchase_price); // price stays the same
    // unitCost is per `base_unit` (not per `purchase_unit`). After
    // switching purchase_unit to the bigger one, the per-base-unit cost
    // recomputes to:
    //   unitCost = purchasePrice / (1 * factor)
    // which for the Cera row (5000 / 1000) yields 5 ARS/g.
    const newUnitCost = (newPrice / (newQty * factor)).toFixed(6);

    console.log(
      `\n🔧  ${row.name} (user ${row.user_id.slice(0, 8)}…)`,
    );
    console.log(
      `    BEFORE  base=${row.base_unit}  purchase=${row.purchase_unit}  qty=${row.purchase_quantity}  price=${row.purchase_price}  unitCost=${row.unit_cost}`,
    );
    console.log(
      `    AFTER   base=${row.base_unit}  purchase=${bigUnit}     qty=${newQty}        price=${newPrice}       unitCost=${newUnitCost}`,
    );
    console.log(
      `    IMPACT  re-interpret as 1 ${bigUnit} @ $${newPrice} → unit cost per ${row.base_unit} drops from ${row.unit_cost} → ${newUnitCost}. A template using 1000 ${row.base_unit} of this material will now cost 1000 × ${newUnitCost} = ${(1000 * Number(newUnitCost)).toFixed(2)} ARS (was ${(1000 * Number(row.unit_cost)).toFixed(2)}).`,
    );

    if (APPLY) {
      await sql`
        UPDATE materials
        SET purchase_unit = ${bigUnit},
            purchase_quantity = ${newQty}::numeric,
            unit_cost = ${newUnitCost}::numeric
        WHERE id = ${row.id}
      `;
      console.log(`    ✅ written to DB`);
      changed += 1;
    } else {
      console.log(`    ⏸  dry-run, no DB write`);
      changed += 1;
    }
  }

  console.log(`\n${APPLY ? "✅" : "⏸ "}  ${changed} would change, ${skipped} skipped.`);
  if (!APPLY) {
    console.log(`    Re-run with --apply to commit the changes.`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(2);
});
