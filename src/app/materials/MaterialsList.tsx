import type { ReactNode } from "react";
import Link from "next/link";
import { formatArsDecimalDisplay, formatDecimalDisplay } from "@/lib/moneyFormat";
import { dimensionLabel, unitLabel, unitSingularLabel } from "@/lib/unitLabels";
import { MaterialArchiveControl } from "./MaterialArchiveControl";
import { MaterialsArchiveFeedback } from "./MaterialsArchiveFeedback";
import { MaterialEditForm } from "./MaterialEditForm";
import { MaterialViewFilter, type MaterialView } from "./MaterialViewFilter";
import type { MaterialInput } from "@/server/validation/materialSchema";

export type MaterialListItem = {
  id: string;
  name: string;
  dimension: MaterialInput["dimension"];
  baseUnit: MaterialInput["baseUnit"];
  purchaseUnit: MaterialInput["purchaseUnit"];
  purchaseQuantity: string;
  purchasePrice: string;
  unitCost: string;
  archived: boolean;
};

const rowGridClass =
  // Mobile (<md): two columns so the user can scan a wider field pair
  // (e.g. Cantidad / Precio) side-by-side instead of a tall stack.
  // Name + Precio unitario + Action span both columns on <md so the
  // form keeps a sensible vertical rhythm: short scalar pairs sit
  // next to each other, and full-width controls (Name, the derived
  // unit cost, the Guardar/Archivar buttons) own the full row.
  "grid min-w-0 grid-cols-2 gap-2 px-3 py-3 md:min-w-[72rem] md:grid-cols-[minmax(10rem,1.4fr)_minmax(6rem,0.7fr)_minmax(6rem,0.7fr)_minmax(6.5rem,0.75fr)_minmax(7rem,0.8fr)_minmax(8rem,0.9fr)_minmax(8rem,0.9fr)_minmax(6rem,0.65fr)_minmax(7.5rem,0.8fr)] md:items-start";
// Per-cell label shown only on small screens (md:sr-only hides on ≥md).
// Drop uppercase + tracking so 9 stacked fields don't feel like a contract.
const mobileCellLabelClass = "mb-1 block text-xs font-semibold text-ink-muted md:sr-only";

function ReadonlyCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className={mobileCellLabelClass}>{label}</span>
      <div className="flex min-h-11 min-w-0 items-center rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-sm text-ink">
        {children}
      </div>
    </div>
  );
}

export function MaterialsList({
  materials,
  view,
  archivedCount,
}: {
  materials: MaterialListItem[];
  view: MaterialView;
  archivedCount: number;
}) {
  // R3-003: the feedback provider must wrap both branches so the polite
  // role=status region and the focus destination survive the transition
  // from a non-empty active list to an empty active list. Mounting the
  // provider only inside the list branch (the previous wiring) caused the
  // success announcement to disappear and the "Show archived" focus move
  // to be skipped when the last active row was archived.
  const hasRemainingRows = materials.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <MaterialViewFilter current={view} />
      <MaterialsArchiveFeedback view={view} hasRemainingRows={hasRemainingRows}>
        {materials.length === 0 ? (
          view === "active" && archivedCount > 0 ? (
            <section
              aria-labelledby="empty-materials"
              className="rounded-2xl border border-dashed border-border-subtle bg-surface-soft p-6"
            >
              <h2 id="empty-materials" className="text-xl font-semibold text-ink">
                No hay materiales activos
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                {archivedCount === 1
                  ? "1 material está archivado y oculto en esta vista."
                  : `${archivedCount} materiales están archivados y ocultos en esta vista.`}
              </p>
              <Link
                href="/materials?view=all"
                data-archive-focus="show-archived"
                className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Mostrar archivados
              </Link>
            </section>
          ) : (
            <section
              aria-labelledby="empty-materials"
              className="flex flex-col gap-3 rounded-2xl border border-dashed border-border-subtle bg-surface-soft p-6"
            >
              <h2 id="empty-materials" className="text-xl font-semibold text-ink text-wrap-balance">
                ✨ Empezá agregando tu primer insumo
              </h2>
              <p className="text-sm text-ink-muted">
                Cargá los materiales que usás para hacer velas y armá plantillas a partir de ellos.
              </p>
              <a
                href="#new-material"
                className="mt-2 inline-flex min-h-11 w-fit items-center rounded-md bg-brand px-4 text-sm font-semibold text-on-brand"
              >
                + Agregar insumo
              </a>
            </section>
          )
        ) : (
          <div className="relative w-full min-w-0 md:overflow-x-auto md:overscroll-x-contain md:rounded-2xl md:border md:border-border md:bg-surface md:shadow-sm">
            <h2 id="materials-list-label" className="sr-only">
              Lista editable de materiales
            </h2>
            <div
              data-testid="materials-list-header"
              className={`${rowGridClass} border-b border-border-subtle bg-surface-soft text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted max-md:hidden`}
            >
              <span>Insumo</span>
              <span>Dimensión</span>
              <span>Unidad base</span>
              <span>Unidad de compra</span>
              <span>Cantidad de compra</span>
              <span>Precio de compra</span>
              <span>Precio unitario</span>
              <span className="md:col-span-2">Acciones</span>
            </div>
            {/*
             * Mobile: each material is its own rounded card with a gap
             * between them — without this, the inline edit form for one
             * material runs directly into the next material's name
             * field and there's no visual signal where one ends and the
             * other begins. Desktop: the <ul> stays a single table
             * surface with the column header, so `md:gap-0` and
             * `md:rounded-none` revert the items to the previous
             * row-divided layout. `space-y-3` on the <ul> gives each
             * mobile card breathing room; `md:divide-y md:divide-border-subtle`
             * re-enables the subtle row separator on ≥md.
             */}
            <ul
              aria-labelledby="materials-list-label"
              className="flex flex-col gap-3 md:gap-0 md:divide-y md:divide-border-subtle"
            >
              {materials.map((material) =>
                material.archived ? (
                  <li
                    key={material.id}
                    aria-label={`Material archivado: ${material.name}`}
                    className={`${rowGridClass} rounded-2xl border border-border bg-surface-soft p-3 md:rounded-none md:border-0 md:bg-surface-soft md:p-3`}
                  >
                    <ReadonlyCell label="Insumo">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words font-semibold">{material.name}</span>
                        <span
                          data-testid="archived-badge"
                          aria-label={`${material.name} está archivado`}
                          className="inline-flex min-h-7 items-center rounded-full bg-surface px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                        >
                          Archivado
                        </span>
                      </span>
                    </ReadonlyCell>
                    <ReadonlyCell label="Dimensión">
                      {dimensionLabel(material.dimension)}
                    </ReadonlyCell>
                    <ReadonlyCell label="Unidad base">{unitLabel(material.baseUnit)}</ReadonlyCell>
                    <ReadonlyCell label="Unidad de compra">
                      {unitLabel(material.purchaseUnit)}
                    </ReadonlyCell>
                    <ReadonlyCell label="Cantidad de compra">
                      <span className="tabular-nums">
                        {formatDecimalDisplay(material.purchaseQuantity)}
                      </span>
                    </ReadonlyCell>
                    <ReadonlyCell label="Precio de compra (ARS)">
                      <span className="tabular-nums">
                        {formatArsDecimalDisplay(material.purchasePrice)}
                      </span>
                    </ReadonlyCell>
                    <ReadonlyCell label="Precio unitario derivado">
                      <span className="font-semibold tabular-nums">
                        {formatArsDecimalDisplay(material.unitCost)} por{" "}
                        {unitSingularLabel(material.baseUnit)}
                      </span>
                    </ReadonlyCell>
                    <div className="min-w-0 md:col-span-2 md:col-start-8 md:row-start-1">
                      <span className={mobileCellLabelClass}>Acciones</span>
                      <MaterialArchiveControl
                        material={{
                          id: material.id,
                          name: material.name,
                          archived: material.archived,
                        }}
                      />
                    </div>
                  </li>
                ) : (
                  <li
                    key={material.id}
                    aria-label={`Editar material: ${material.name}`}
                    className={`${rowGridClass} rounded-2xl border border-border bg-surface p-3 md:rounded-none md:border-0 md:bg-surface md:p-3`}
                  >
                    <MaterialEditForm material={material} />
                    <div className="min-w-0 md:col-start-9 md:row-start-1">
                      <span className={mobileCellLabelClass}>Acción de estado</span>
                      <MaterialArchiveControl
                        material={{
                          id: material.id,
                          name: material.name,
                          archived: material.archived,
                        }}
                      />
                    </div>
                  </li>
                ),
              )}
            </ul>
          </div>
        )}
      </MaterialsArchiveFeedback>
    </div>
  );
}
