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
            className="rounded-2xl border border-dashed border-rose-300 bg-rose-50 p-6"
          >
            <h2 id="empty-materials" className="text-xl font-semibold text-zinc-900">
              No active materials
            </h2>
            <p className="mt-2 text-sm text-zinc-700">
              {archivedCount === 1
                ? "1 material is archived and hidden in this view."
                : `${archivedCount} materials are archived and hidden in this view.`}
            </p>
            <Link
              href="/materials?view=all"
              data-archive-focus="show-archived"
              className="mt-4 inline-block font-semibold text-rose-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
            >
              Show archived
            </Link>
          </section>
        ) : (
          <section
            aria-labelledby="empty-materials"
            className="rounded-2xl border border-dashed border-rose-300 bg-rose-50 p-6"
          >
            <h2 id="empty-materials" className="text-xl font-semibold text-zinc-900">
              No materials yet
            </h2>
            <a
              href="#new-material"
              className="mt-4 inline-block font-semibold text-rose-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
            >
              Add your first material
            </a>
          </section>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {materials.map((material) => (
            <li
              key={material.id}
              className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-zinc-900">{material.name}</h3>
                  <p className="mt-1 text-sm text-zinc-700">
                    ARS {material.unitCost} per {material.baseUnit}
                  </p>
                </div>
                {material.archived ? (
                  <span
                    data-testid="archived-badge"
                    aria-label={`${material.name} is archived`}
                    className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-700"
                  >
                    Archived
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
