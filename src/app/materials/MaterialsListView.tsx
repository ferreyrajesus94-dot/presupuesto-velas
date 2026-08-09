import type { ReactNode } from "react";
import { formatArsDecimalDisplay, formatDecimalDisplay } from "@/lib/moneyFormat";
import { dimensionLabel, unitLabel, unitSingularLabel } from "@/lib/unitLabels";
import type { MaterialListItem } from "./MaterialsList";
import { MaterialArchiveControl } from "./MaterialArchiveControl";

/**
 * Compact list view for /materials. The cards mode (the default)
 * inlines the full edit form for every material, which burns ~600px
 * of vertical space per material on mobile. The list mode is a
 * view-only table so the user can scan all their materials at a
 * glance — they can switch back to the cards mode to edit.
 *
 * Mobile: each material is a single row with the most useful info
 * (name + unit cost + status badge + a small '→' cue) so the user
 * can see ~10 materials above the fold. The row links to
 * /materials?view=… (cards mode) and is also the hit area for the
 * archive control.
 *
 * Desktop: 7-column table with the full data plus a status badge
 * and the archive control.
 */
export function MaterialsListView({ materials }: { materials: MaterialListItem[] }) {
  return (
    <div className="relative w-full min-w-0 overflow-x-auto overscroll-x-contain rounded-2xl border border-border bg-surface shadow-sm">
      <h2 className="sr-only">Lista compacta de materiales</h2>
      <table className="w-full min-w-[36rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-surface-soft text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted">
            <th scope="col" className="px-3 py-2 text-left">Insumo</th>
            <th scope="col" className="px-3 py-2 text-left max-md:hidden">Dimensión</th>
            <th scope="col" className="px-3 py-2 text-left max-md:hidden">Compra</th>
            <th scope="col" className="px-3 py-2 text-right max-md:hidden">Cant.</th>
            <th scope="col" className="px-3 py-2 text-right max-md:hidden">Precio</th>
            <th scope="col" className="px-3 py-2 text-right">Costo unitario</th>
            <th scope="col" className="px-3 py-2 text-right">Estado</th>
            <th scope="col" className="px-3 py-2 text-right">Acción</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((material) => (
            <ListRow key={material.id} material={material} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListRow({ material }: { material: MaterialListItem }) {
  return (
    <tr className="border-t border-border-subtle hover:bg-surface-soft/50">
      <th
        scope="row"
        className="px-3 py-2 text-left align-middle font-semibold text-ink"
      >
        <div className="flex flex-col gap-0.5">
          <span className="break-words">{material.name}</span>
          {material.archived ? (
            <span
              data-testid="archived-badge"
              aria-label={`${material.name} está archivado`}
              className="inline-flex w-fit min-h-7 items-center rounded-full bg-surface px-2 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-muted md:hidden"
            >
              Archivado
            </span>
          ) : null}
        </div>
      </th>
      <td className="px-3 py-2 text-left align-middle text-ink-muted max-md:hidden">
        {dimensionLabel(material.dimension)}
      </td>
      <td className="px-3 py-2 text-left align-middle text-ink-muted max-md:hidden">
        {unitLabel(material.purchaseUnit)}
      </td>
      <td className="px-3 py-2 text-right align-middle tabular-nums text-ink-muted max-md:hidden">
        {formatDecimalDisplay(material.purchaseQuantity)}
      </td>
      <td className="px-3 py-2 text-right align-middle tabular-nums text-ink-muted max-md:hidden">
        {formatArsDecimalDisplay(material.purchasePrice)}
      </td>
      <td className="px-3 py-2 text-right align-middle text-sm font-semibold tabular-nums text-ink">
        <div className="flex flex-col items-end gap-0 leading-tight md:block">
          <span>{formatArsDecimalDisplay(material.unitCost)}</span>
          <span className="text-[0.7rem] font-normal text-ink-muted">
            por {unitSingularLabel(material.baseUnit)}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 text-right align-middle max-md:hidden">
        {material.archived ? (
          <span
            data-testid="archived-badge"
            aria-label={`${material.name} está archivado`}
            className="inline-flex min-h-7 items-center rounded-full bg-surface px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
          >
            Archivado
          </span>
        ) : (
          <span className="inline-flex min-h-7 items-center rounded-full bg-status-success/15 px-2.5 text-xs font-semibold uppercase tracking-wide text-status-success">
            Activo
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right align-middle">
        <MaterialArchiveControl
          material={{
            id: material.id,
            name: material.name,
            archived: material.archived,
          }}
        />
      </td>
    </tr>
  );
}
