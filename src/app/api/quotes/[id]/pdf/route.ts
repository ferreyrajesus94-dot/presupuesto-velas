/**
 * PR2.auth-core (Task 2.8) — GET `/api/quotes/[id]/pdf` Route Handler.
 *
 * User-scoped PDF export of a single quote snapshot. The route:
 *   1. Validates authentication via `requireUser()` (redirects on
 *      missing session, on unverified session redirects to
 *      `/sign-in?hint=verify-email`).
 *   2. Loads the user-scoped `QuoteRecord` via `getQuote()`.
 *   3. Reads visibility toggles from the `?visibility=` query param.
 *   4. Calls `renderQuotePdf()` which uses `projectQuote()` to apply the
 *      toggles — the snapshot is never mutated, never recalculated
 *      (design #998: "PDF and validated, encoded `wa.me?text=` never
 *      recalculate or mutate").
 *
 * Visibility query values (omit the prefix to show everything):
 *   - `internal-hidden` — strips per-line material costs + indirect costs.
 *   - `profit-hidden`   — strips the profit row (final price only).
 *   - Anything else (or missing) — both toggles on.
 */

import { NextResponse } from "next/server";

import { requireUser } from "@/server/auth/requireUser";
import { getQuote } from "@/server/repositories/quotes";
import { renderQuotePdf } from "@/lib/pdf/quotePdf";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser();
  const { id } = await context.params;
  const record = await getQuote(user.id, id);
  if (!record) {
    return new NextResponse("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const visibilityParam = url.searchParams.get("visibility");
  const showInternalCost = visibilityParam !== "internal-hidden";
  const showProfitMargin = visibilityParam !== "profit-hidden";

  const pdfBuffer = await renderQuotePdf(record, {
    internalCost: showInternalCost,
    profitMargin: showProfitMargin,
  });

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="presupuesto-${record.quote.id}.pdf"`,
    },
  });
}