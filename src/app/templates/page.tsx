import { requireOwner } from "@/server/auth/requireOwner";
import { listMaterials } from "@/server/repositories/materials";
import { countArchivedTemplates, listTemplates } from "@/server/repositories/templates";
import { TemplateCreateForm, type TemplateMaterialOption } from "./TemplateCreateForm";
import { TemplatesList, type TemplateListItem } from "./TemplatesList";
import { resolveTemplateView, type TemplateView } from "./TemplateViewFilter";

const VIEW_VISIBILITY: Record<TemplateView, { includeArchived: boolean }> = {
  active: { includeArchived: false },
  all: { includeArchived: true },
};

// PR3v.next: the edit form preloads each active template's ordered items.
// The repository persists the items in the template's chosen unit (after
// normalization to the material's baseUnit), and the projection layer
// lifts the unit display from the catalog so the Client Component
// receives only serializable strings.
const FALLBACK_UNIT = "g";

function projectTemplateItems(
  rows: ReadonlyArray<{ materialId: string; quantity: string; position: number }>,
  materialsById: ReadonlyMap<string, TemplateMaterialOption>,
): TemplateListItem["items"] {
  return rows
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      materialId: item.materialId,
      quantity: item.quantity,
      unit: materialsById.get(item.materialId)?.baseUnit ?? FALLBACK_UNIT,
    }));
}

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

  // Mirror materials: only query the archived count when the active list
  // might be empty — keeps the happy path to a single query and supports
  // the view-aware empty state for archived-only owners.
  const archivedCount =
    view === "active" && records.length === 0 ? await countArchivedTemplates(owner.id) : 0;

  // The create and edit forms both accept active materials. We fetch the
  // catalog here so the Client Components receive a stable, owner-scoped
  // list and stay decoupled from the server repository layer.
  const activeMaterials = await listMaterials(owner.id, { includeArchived: false });
  const materialOptions: TemplateMaterialOption[] = activeMaterials.map((m) => ({
    id: m.id,
    name: m.name,
    baseUnit: m.baseUnit,
    unitCost: m.unitCost,
  }));
  const materialsById = new Map(materialOptions.map((m) => [m.id, m] as const));

  const items: TemplateListItem[] = records.map(({ template, items: templateItems }) => ({
    id: template.id,
    name: template.name,
    unitCost: template.unitCost,
    archivedAt: template.archivedAt,
    itemCount: templateItems.length,
    items: projectTemplateItems(templateItems, materialsById),
  }));

  return (
    // Root layout owns <main id="main">; this page must not nest another one.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 bg-canvas px-4 py-8 text-ink sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-surface p-6 shadow">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand">
            Calculadora Flor
          </p>
          <h1 className="mt-2 text-3xl font-semibold text-ink text-wrap-balance">📋 Plantillas</h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="#new-template"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand transition-transform hover:-translate-y-1"
          >
            ✨ + Nueva plantilla
          </a>
          <button type="button" data-help="templates" aria-label="Ayuda sobre plantillas" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-border text-ink transition-transform hover:-translate-y-1">
            ?
          </button>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <TemplatesList
          templates={items}
          view={view}
          archivedCount={archivedCount}
          materials={materialOptions}
        />
        <TemplateCreateForm materials={materialOptions} />
      </div>
    </div>
  );
}
