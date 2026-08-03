import Link from "next/link";
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
    <div className="flex flex-col gap-4">
      <MaterialViewFilter current={view} />
      {/* prettier-ignore */}
      <MaterialsArchiveFeedback view={view} hasRemainingRows={hasRemainingRows}>
    {materials.length === 0 ? (
        view === "active" && archivedCount > 0 ? (
          // R3-002: archived-only owner in active view. Archived names are
          // still unique to the owner, so the empty state must not imply the
          // catalog is empty. Offer a semantic link to the archived/all view.
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
            className="rounded-2xl border border-dashed border-border-subtle bg-surface-soft p-6"
          >
            <h2 id="empty-materials" className="text-xl font-semibold text-ink">
              No hay materiales todavía
            </h2>
            <a
              href="#new-material"
              className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
            >
              Agregá tu primer material
            </a>
          </section>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {materials.map((material) => (
            <li
              key={material.id}
              className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6 shadow transition-transform hover:-translate-y-1"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                   <h3 className="font-semibold text-ink">📦 {material.name}</h3>
                  <p className="mt-1 text-sm text-ink-muted">
                    ARS {material.unitCost} por {material.baseUnit}
                  </p>
                </div>
                {material.archived ? (
                  <span
                    data-testid="archived-badge"
                    aria-label={`${material.name} está archivado`}
                    className="inline-flex min-h-7 items-center rounded-full bg-surface-soft px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    Archivado
                  </span>
                ) : null}
              </div>
              {material.archived ? null : <MaterialEditForm material={material} />}
              <MaterialArchiveControl
                material={{
                  id: material.id,
                  name: material.name,
                  archived: material.archived,
                }}
              />
            </li>
          ))}
        </ul>
      )}      </MaterialsArchiveFeedback>
    </div>
  );
}
