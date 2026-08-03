import type { Unit } from "@/domain/units";
import { TemplateArchiveControl } from "./TemplateArchiveControl";
import { TemplatesArchiveFeedback } from "./TemplatesArchiveFeedback";
import { TemplateEditForm, type TemplateMaterialOption } from "./TemplateEditForm";
import { TemplateViewFilter, type TemplateView } from "./TemplateViewFilter";

export type TemplateListItem = {
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  itemCount: number;
  // Minimal serializable projection of the template's ordered items for
  // the inline edit form. Dates/materialized objects stay server-side.
  items: Array<{ materialId: string; quantity: string; unit: string }>;
};

export function TemplatesList({
  templates,
  view,
  archivedCount,
  materials,
}: {
  templates: TemplateListItem[];
  view: TemplateView;
  archivedCount: number;
  materials: readonly TemplateMaterialOption[];
}) {
  const hasRemainingRows = templates.length > 0;
  // PR3z: wrap list + empty branches in TemplatesArchiveFeedback so polite status survives revalidation.
  // PR3z.focus: pass `view` so the focus effect can gate on the active view.
  return (
    <div className="flex flex-col gap-4">
      <TemplateViewFilter current={view} />
      <TemplatesArchiveFeedback view={view}>
        {templates.length === 0 ? (
          view === "active" && archivedCount > 0 ? (
            <section
              aria-labelledby="empty-templates"
              className="rounded-2xl border border-border-subtle bg-surface-soft p-6"
            >
              <h2 id="empty-templates" className="text-xl font-semibold text-ink">
                No hay plantillas activas
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                {archivedCount === 1
                  ? "1 plantilla está archivada y oculta en esta vista."
                  : `${archivedCount} plantillas están archivadas y ocultas en esta vista.`}
              </p>
              <a
                href="/templates?view=all"
                data-archive-focus="show-archived"
                className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Mostrar archivadas
              </a>
            </section>
          ) : (
            <section
              aria-labelledby="empty-templates"
              className="rounded-2xl border border-border-subtle bg-surface-soft p-6"
            >
              <h2 id="empty-templates" className="text-xl font-semibold text-ink">
                No hay plantillas todavía
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                Creá tu primera plantilla con los materiales disponibles.
              </p>
              <a
                href="#new-template"
                className="mt-4 inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4"
              >
                Creá tu primera plantilla
              </a>
            </section>
          )
        ) : (
          <ul
            className="grid gap-3 sm:grid-cols-2"
            aria-label="Plantillas"
            data-has-rows={hasRemainingRows}
          >
            {templates.map((template) => (
              <li
                key={template.id}
                data-testid="template-card"
                className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6 shadow transition-transform hover:-translate-y-1"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                       <h3 className="font-semibold text-ink">📋 {template.name}</h3>
                    <p className="mt-1 text-sm text-ink-muted">ARS {template.unitCost}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {template.itemCount === 1 ? "1 elemento" : `${template.itemCount} elementos`}
                    </p>
                  </div>
                  {template.archivedAt !== null ? (
                    <span
                      data-testid="archived-badge"
                      aria-label={`${template.name} está archivada`}
                      className="inline-flex min-h-7 items-center rounded-full bg-surface-soft px-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted"
                    >
                      Archivada
                    </span>
                  ) : null}
                </div>
                {template.archivedAt === null ? (
                  <div className="flex flex-col gap-2">
                    {/* PR3v.next: stable per-template identity isolates form defaultValues between siblings;
                      the hash anchor doubles as a deep-link for keyboard/screen reader users. */}
                    <a
                      href={`#edit-template-${template.id}`}
                      data-edit-link={template.id}
                      className="self-start font-semibold text-brand underline underline-offset-4"
                    >
                      Editar {template.name}
                    </a>
                    <TemplateEditForm
                      key={template.id}
                      template={{
                        id: template.id,
                        name: template.name,
                        items: template.items.map((item) => ({
                          materialId: item.materialId,
                          quantity: item.quantity,
                          // Template items persist normalized quantities; original unit is projected from the catalog
                          // (or sentinel "g" fallback) and cast to the form's strict Unit union.
                          unit: item.unit as Unit,
                        })),
                      }}
                      materials={materials}
                    />
                  </div>
                ) : null}
                {/* PR3z: archive/restore; polite status now lives in TemplatesArchiveFeedback above. */}
                <TemplateArchiveControl
                  template={{
                    id: template.id,
                    name: template.name,
                    archived: template.archivedAt !== null,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </TemplatesArchiveFeedback>
    </div>
  );
}
