import { requireOwner } from "@/server/auth/requireOwner";
import { listMaterials } from "@/server/repositories/materials";
import { countArchivedTemplates, listTemplates } from "@/server/repositories/templates";
import { TemplateViewFilter } from "./TemplateViewFilter";
import { resolveTemplateView, type TemplateView } from "./TemplateViewFilter";
import {
  PlantillasWorkspace,
  toClientTemplate,
  type PlantillaClientMaterial,
  type PlantillaClientTemplate,
} from "./PlantillasWorkspace";

const VIEW_VISIBILITY: Record<TemplateView, { includeArchived: boolean }> = {
  active: { includeArchived: false },
  all: { includeArchived: true },
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const owner = await requireOwner();
  const { view: rawView } = await searchParams;
  const view = resolveTemplateView(rawView);
  const visibility = VIEW_VISIBILITY[view];
  const records = await listTemplates(owner.id, visibility);

  const archivedCount =
    view === "active" && records.length === 0 ? await countArchivedTemplates(owner.id) : 0;

  // The create and edit forms both accept active materials. We fetch the
  // catalog here so the Client Components receive a stable, owner-scoped
  // list and stay decoupled from the server repository layer.
  const activeMaterials = await listMaterials(owner.id, { includeArchived: false });
  const materialOptions: PlantillaClientMaterial[] = activeMaterials.map((m) => ({
    id: m.id,
    name: m.name,
    baseUnit: m.baseUnit,
    unitCost: m.unitCost,
  }));

  const initialTemplates: PlantillaClientTemplate[] = records.map(({ template, items }) =>
    toClientTemplate(
      {
        id: template.id,
        name: template.name,
        unitCost: template.unitCost,
        archivedAt: template.archivedAt,
        items: items.map((row) => ({
          id: row.id,
          materialId: row.materialId,
          quantity: row.quantity,
          unit: materialOptions.find((m) => m.id === row.materialId)?.baseUnit ?? "g",
        })),
      },
      materialOptions,
    ),
  );

  return (
    // Root layout owns <main id="main">; this page must not nest another one.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-surface p-6 shadow">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
            Calculadora Flor
          </p>
          <h1 aria-label="Plantillas" className="mt-2 text-3xl font-semibold text-ink text-wrap-balance">📋 Plantillas</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" data-help="templates" aria-label="Ayuda sobre plantillas" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border text-ink transition-transform hover:-translate-y-1">
            ?
          </button>
        </div>
      </header>

      <TemplateViewFilter current={view} />
      <PlantillasWorkspace
        initialTemplates={initialTemplates}
        materials={materialOptions}
      />
      {archivedCount > 0 && view === "active" ? (
        <p className="text-xs text-ink-muted">
          {archivedCount === 1
            ? "1 plantilla está archivada y oculta en esta vista."
            : `${archivedCount} plantillas están archivadas y ocultas en esta vista.`}
          <a
            href="/templates?view=all"
            className="ml-2 font-semibold text-brand underline underline-offset-4"
          >
            Mostrar archivadas
          </a>
        </p>
      ) : null}
    </div>
  );
}
