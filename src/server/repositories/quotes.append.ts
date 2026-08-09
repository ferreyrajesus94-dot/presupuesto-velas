/**
 * PR2.auth-core (Task 2.8) — `appendQuoteVersion` transaction rewritten
 * for the user era. User-scoped, optimistic-concurrency append of
 * `quote_versions` + children in one `db.transaction`. Initial quote
 * lookup is `SELECT ... FOR UPDATE`. `lock_version` mismatch is a typed
 * error. `version_no = current_version + 1` allocated INSIDE the tx;
 * composite PK is the final safety net. Decimal.js (precision 50,
 * ROUND_HALF_UP) for ALL money arithmetic — `Number(...).toFixed()` is
 * FORBIDDEN. `quantity` → 6 dp; `lineTotal` → 2.
 */

import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import Decimal from "decimal.js";
import { db } from "../../../db/client";
import {
  materials,
  quoteVersionIndirectCosts,
  quoteVersionMaterials,
  quoteVersionModels,
  quoteVersions,
  quotes,
  templateItems,
  templates,
} from "../../../db/schema";
import { parseStrictDecimal } from "../../domain/decimal";
import { verifyTerminalStatus, type QuoteStatus } from "../../domain/snapshot";
import type { QuoteSnapshot } from "../../domain/quote";

import {
  lockVersionMismatch,
  notFound,
  terminalStatus,
  type Quote,
  type QuoteVersion,
} from "./quotes";

export { QuoteRepositoryError, type Quote, type QuoteVersion } from "./quotes";

function computePerCandleQuantity(modelQuantity: string, itemQuantity: string): string {
  return parseStrictDecimal(modelQuantity)
    .mul(parseStrictDecimal(itemQuantity))
    .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
    .toFixed(6);
}

function computeLineTotal(perCandleQuantity: string, unitCost: string): string {
  return parseStrictDecimal(perCandleQuantity)
    .mul(parseStrictDecimal(unitCost))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

export async function appendQuoteVersion(
  userId: string,
  id: string,
  snapshot: QuoteSnapshot,
  expectedLockVersion: number,
): Promise<{ quote: Quote; version: QuoteVersion }> {
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(quotes)
      .where(and(eq(quotes.userId, userId), eq(quotes.id, id)))
      .for("update");
    if (!quote) throw notFound(id);
    if (quote.lockVersion !== expectedLockVersion) {
      throw lockVersionMismatch(expectedLockVersion, quote.lockVersion);
    }
    if (verifyTerminalStatus(quote.status as QuoteStatus)) {
      throw terminalStatus(quote.status);
    }

    const versionNo = quote.currentVersion + 1;

    // Fetch templates, items, materials. FK constraints surface missing refs as INSERT violations.
    const templateIds = Array.from(new Set(snapshot.models.map((m) => m.recipeId)));
    const templateRows =
      templateIds.length === 0
        ? []
        : await tx
            .select({ id: templates.id, name: templates.name })
            .from(templates)
            .where(inArray(templates.id, templateIds));
    const templateNameById = Object.fromEntries(templateRows.map((r) => [r.id, r.name]));
    const itemRows =
      templateIds.length === 0
        ? []
        : await tx
            .select()
            .from(templateItems)
            .where(inArray(templateItems.templateId, templateIds))
            .orderBy(asc(templateItems.position));
    const itemsByTemplate = new Map<string, typeof itemRows>(
      Object.entries(Object.groupBy(itemRows, (item) => item.templateId)) as [
        string,
        typeof itemRows,
      ][],
    );
    const materialIds = Array.from(new Set(itemRows.map((i) => i.materialId)));
    const materialRows =
      materialIds.length === 0
        ? []
        : await tx.select().from(materials).where(inArray(materials.id, materialIds));
    const materialById = Object.fromEntries(materialRows.map((m) => [m.id, m]));

    await tx.insert(quoteVersions).values({
      quoteId: id,
      versionNo,
      visibilityInternal: snapshot.visibility.internalCost,
      visibilityProfit: snapshot.visibility.profitMargin,
      // `profitValue` (DB) = user input (percent or fixed amount), so the
      // edit form can round-trip it verbatim. `profitAmount` (DB) = the
      // calculated ARS amount for the totals strip. `snapshot.profitValue`
      // is the calculated amount — the previous code wrote the SAME value
      // to both columns, which lost the original user input and made the
      // edit form re-open with the calculated ARS in the percent field.
      // `profitInput` is optional on the snapshot type (read-side
      // consumers like PDF/WhatsApp reconstruct from DB rows and don't
      // need it), so we fall back to "0" defensively — `buildQuoteSnapshot`
      // always sets it for write paths.
      profitMethod: snapshot.profitMethod,
      profitValue: snapshot.profitInput ?? "0",
      depositPercent: snapshot.depositPercent,
      materialsTotal: snapshot.materialsTotal,
      indirectTotal: snapshot.indirectTotal,
      profitAmount: snapshot.profitValue,
      finalPrice: snapshot.total,
      depositAmount: snapshot.depositAmount,
    });

    let modelPos = 0;
    for (const model of snapshot.models) {
      modelPos += 1;
      await tx.insert(quoteVersionModels).values({
        quoteId: id,
        versionNo,
        position: modelPos,
        templateId: model.recipeId,
        templateName: templateNameById[model.recipeId] ?? "",
        quantity: model.quantity,
        unitCost: model.perUnitCost,
        lineTotal: model.lineTotal,
      });
      const items = itemsByTemplate.get(model.recipeId) ?? [];
      if (items.length === 0) continue;
      await tx.insert(quoteVersionMaterials).values(
        items.map((item, idx) => {
          const mat = materialById[item.materialId];
          const perCandleQty = computePerCandleQuantity(model.quantity, item.quantity);
          return {
            quoteId: id,
            versionNo,
            modelPosition: modelPos,
            position: idx + 1,
            materialId: item.materialId,
            materialName: mat?.name ?? "",
            quantity: perCandleQty,
            unitCost: mat?.unitCost ?? "0",
            lineTotal: computeLineTotal(perCandleQty, mat?.unitCost ?? "0"),
          };
        }),
      );
    }

    if (snapshot.indirectCosts.length > 0) {
      await tx.insert(quoteVersionIndirectCosts).values(
        snapshot.indirectCosts.map((ic, idx) => ({
          quoteId: id,
          versionNo,
          position: idx + 1,
          name: ic.name,
          amount: ic.amount,
        })),
      );
    }

    const [updatedQuote] = await tx
      .update(quotes)
      .set({ currentVersion: versionNo, lockVersion: quote.lockVersion + 1, updatedAt: new Date() })
      .where(eq(quotes.id, id))
      .returning();
    if (!updatedQuote) throw notFound(id);

    const [version] = await tx
      .select()
      .from(quoteVersions)
      .where(and(eq(quoteVersions.quoteId, id), eq(quoteVersions.versionNo, versionNo)));
    if (!version) throw notFound(id);

    return { quote: updatedQuote, version };
  });
}
