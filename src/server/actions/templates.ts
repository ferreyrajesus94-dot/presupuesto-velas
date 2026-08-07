"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "../auth/requireOwner";
import {
  archiveTemplate,
  createBlankTemplate,
  createTemplate,
  deleteTemplateRow,
  findNextDefaultTemplateName,
  TemplateRepositoryError,
  restoreTemplate,
  updateTemplate,
} from "../repositories/templates";
import { type TemplateInput, templateInputSchema } from "../validation/templateSchema";
import type { Unit } from "../../domain/units";

const TEMPLATES_PATH = "/templates";
type TemplateField = keyof TemplateInput | "id" | "items";

export type TemplateActionState = {
  status: "idle" | "success" | "error";
  templateId?: string;
  message?: string;
  fieldErrors?: Partial<Record<TemplateField, string[]>>;
  values?: Partial<Record<TemplateField, string>>;
};

// Result envelope for the workspace's optimistic "Nueva plantilla" / "Eliminar"
// actions. Discriminated by `status` so the Client Component can narrow the
// union without optional chaining through `templateId` / `message`.
export type CreateBlankTemplateResult =
  { status: "success"; id: string; name: string } | { status: "error"; message: string };

export type DeleteTemplateResult =
  { status: "success"; id: string } | { status: "error"; message: string };

function value(formData: FormData, key: string): string {
  const item = formData.get(key);
  return typeof item === "string" ? item : "";
}

function readTemplateName(formData: FormData): string {
  return value(formData, "name");
}

function readTemplateItems(formData: FormData): {
  items?: TemplateInput["items"];
  state?: TemplateActionState;
} {
  const raw = value(formData, "items");
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return { state: { status: "error", message: "Template items could not be parsed." } };
  }
  if (!Array.isArray(parsed)) {
    return { state: { status: "error", fieldErrors: { items: ["Items are required"] } } };
  }
  const items: TemplateInput["items"] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      return { state: { status: "error", message: "Template items could not be parsed." } };
    }
    const row = entry as Record<string, unknown>;
    items.push({
      materialId: typeof row.materialId === "string" ? row.materialId : "",
      quantity: typeof row.quantity === "string" ? row.quantity : "",
      unit: (typeof row.unit === "string" ? row.unit : "") as Unit,
    });
  }
  return { items };
}

function readId(formData: FormData): string | TemplateActionState {
  const id = value(formData, "id").trim();
  if (id) return id;
  return {
    status: "error",
    fieldErrors: { id: ["Template ID is required"] },
    values: { id: "" },
  };
}

function readTemplateInput(
  formData: FormData,
): { input: TemplateInput; name: string } | { state: TemplateActionState } {
  const name = readTemplateName(formData);
  const parsed = readTemplateItems(formData);
  if (parsed.state) return { state: parsed.state };
  const input: TemplateInput = { name, items: parsed.items! };
  const shape = templateInputSchema.safeParse(input);
  if (!shape.success) {
    return {
      state: {
        status: "error",
        fieldErrors: shape.error.flatten().fieldErrors,
        values: { name },
      },
    };
  }
  return { input, name };
}

function failure(error: unknown, operation: string): TemplateActionState {
  if (error instanceof TemplateRepositoryError) {
    if (error.code === "DUPLICATE_NAME") {
      return { status: "error", message: "A template with that name already exists." };
    }
    if (error.code === "MATERIAL_UNAVAILABLE") {
      return { status: "error", message: "Template material is unavailable." };
    }
    return { status: "error", message: "Template could not be found." };
  }
  return { status: "error", message: `Unable to ${operation} template.` };
}

function success(templateId: string): TemplateActionState {
  revalidatePath(TEMPLATES_PATH);
  return { status: "success", templateId };
}

export async function createTemplateAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const owner = await requireOwner();
  const parsed = readTemplateInput(formData);
  if ("state" in parsed) return parsed.state;
  try {
    const record = await createTemplate(owner.id, parsed.input);
    return success(record.template.id);
  } catch (error) {
    return failure(error, "create");
  }
}

export async function updateTemplateAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") return id;
  const parsed = readTemplateInput(formData);
  if ("state" in parsed) return parsed.state;
  try {
    const record = await updateTemplate(owner.id, id, parsed.input);
    return success(record.template.id);
  } catch (error) {
    return failure(error, "update");
  }
}

export async function archiveTemplateAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") return id;
  try {
    const template = await archiveTemplate(owner.id, id);
    return success(template.id);
  } catch (error) {
    return failure(error, "archive");
  }
}

export async function restoreTemplateAction(
  _previous: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") return id;
  try {
    const template = await restoreTemplate(owner.id, id);
    return success(template.id);
  } catch (error) {
    return failure(error, "restore");
  }
}

function readBlankName(formData: FormData): string | null {
  const name = value(formData, "name").trim();
  return name || null;
}

function blankFailure(
  operation: "create" | "delete",
  error: unknown,
): { status: "error"; message: string } {
  if (error instanceof TemplateRepositoryError) {
    if (error.code === "DUPLICATE_NAME") {
      return { status: "error", message: "Ya existe una plantilla con ese nombre." };
    }
    if (error.code === "NOT_FOUND") {
      return {
        status: "error",
        message:
          operation === "delete"
            ? "No se pudo eliminar la plantilla."
            : "No se pudo crear la plantilla.",
      };
    }
  }
  return {
    status: "error",
    message:
      operation === "delete"
        ? "No se pudo eliminar la plantilla."
        : "No se pudo crear la plantilla.",
  };
}

// createBlankTemplateAction persists a name-only template row owned by the
// current owner. The workspace uses this for its optimistic "Nueva plantilla"
// CTA so a refresh keeps the new card. The repository helper bypasses the
// "at least one item" schema invariant that `createTemplate` enforces; we
// surface DUPLICATE_NAME as a friendly Spanish message and revalidate the
// templates catalog on success so the next render reflects the new row.
export async function createBlankTemplateAction(
  formData: FormData,
): Promise<CreateBlankTemplateResult> {
  const owner = await requireOwner();
  const parsed = readBlankName(formData);
  try {
    const name = parsed ?? (await findNextDefaultTemplateName(owner.id));
    const template = await createBlankTemplate(owner.id, name);
    revalidatePath(TEMPLATES_PATH);
    return { status: "success", id: template.id, name: template.name };
  } catch (error) {
    return blankFailure("create", error);
  }
}

// deleteTemplateAction hard-deletes the owner-scoped template identified by
// the form's `id` field. The workspace calls it from the per-card trash
// button after the browser confirm dialog; the repository helper cascades
// the items delete inside a transaction. NOT_FOUND surfaces as a friendly
// Spanish message so a stale local id never leaks the raw repository text.
export async function deleteTemplateAction(formData: FormData): Promise<DeleteTemplateResult> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") {
    return { status: "error", message: "Falta el identificador de la plantilla." };
  }
  try {
    await deleteTemplateRow(owner.id, id);
    revalidatePath(TEMPLATES_PATH);
    return { status: "success", id };
  } catch (error) {
    return blankFailure("delete", error);
  }
}

// Result envelope for the workspace's "Guardar" CTA. Discriminated by
// `status` so the client can replace its in-memory card with the server-
// confirmed record without an extra round-trip through /templates.
export type SaveTemplateResult =
  | {
      status: "success";
      template: {
        id: string;
        name: string;
        unitCost: string;
        archivedAt: Date | null;
        time: string;
        hourlyRate: string;
        overhead: string;
        marginPct: string;
      };
      meta: {
        unitCost: string;
        time: string;
        hourlyRate: string;
        overhead: string;
        marginPct: string;
      };
    }
  | {
      status: "error";
      fieldErrors?: Partial<Record<TemplateField, string[]>>;
      message?: string;
    };

function readMetaField(formData: FormData, key: keyof TemplateInput): string {
  return value(formData, key).trim();
}

function readSaveTemplateInput(formData: FormData):
  | { kind: "ok"; id: string | null; input: TemplateInput; name: string }
  | {
      kind: "error";
      state: { fieldErrors?: Partial<Record<TemplateField, string[]>>; message?: string };
    } {
  const rawId = value(formData, "id").trim();
  const name = readTemplateName(formData);
  const parsed = readTemplateItems(formData);
  if (parsed.state && parsed.state.status === "error") {
    return { kind: "error", state: parsed.state };
  }
  const itemsResult = "items" in parsed ? parsed.items : undefined;
  const time = readMetaField(formData, "time");
  const hourlyRate = readMetaField(formData, "hourlyRate");
  const overhead = readMetaField(formData, "overhead");
  const marginPct = readMetaField(formData, "marginPct");
  const draft: TemplateInput = {
    name,
    items: itemsResult!,
    time,
    hourlyRate,
    overhead,
    marginPct,
  };
  const shape = templateInputSchema.safeParse(draft);
  if (!shape.success) {
    return {
      kind: "error",
      state: {
        fieldErrors: shape.error.flatten().fieldErrors,
      },
    };
  }
  return { kind: "ok", id: rawId || null, input: draft, name };
}

function saveFailure(error: unknown): { status: "error"; message?: string } {
  if (error instanceof TemplateRepositoryError) {
    if (error.code === "DUPLICATE_NAME") {
      return { status: "error", message: "Ya existe una plantilla con ese nombre." };
    }
    if (error.code === "MATERIAL_UNAVAILABLE") {
      return {
        status: "error",
        message: "La plantilla referencia un material archivado o inexistente.",
      };
    }
    if (error.code === "NOT_FOUND") {
      return { status: "error", message: "No se encontró la plantilla para guardar." };
    }
  }
  return { status: "error", message: "No se pudo guardar la plantilla." };
}

function templateToClientShape(t: {
  id: string;
  name: string;
  unitCost: string;
  archivedAt: Date | null;
  time: string;
  hourlyRate: string;
  overhead: string;
  marginPct: string;
}) {
  return {
    id: t.id,
    name: t.name,
    unitCost: t.unitCost,
    archivedAt: t.archivedAt,
    time: t.time,
    hourlyRate: t.hourlyRate,
    overhead: t.overhead,
    marginPct: t.marginPct,
  };
}

// saveTemplateAction covers the workspace's "Guardar" CTA. Reads `id` (may
// be empty for in-memory placeholders), validates the full payload via
// `templateInputSchema`, then dispatches to `updateTemplate` when the row
// exists for the owner or `createTemplate` otherwise. Revalidates
// `/templates` on success so the next page render reflects the new meta.
export async function saveTemplateAction(formData: FormData): Promise<SaveTemplateResult> {
  const owner = await requireOwner();
  const parsed = readSaveTemplateInput(formData);
  if (parsed.kind === "error") {
    return { status: "error", ...parsed.state } satisfies SaveTemplateResult & {
      status: "error";
    };
  }

  try {
    const record = parsed.id
      ? await updateTemplate(owner.id, parsed.id, parsed.input)
      : await createTemplate(owner.id, parsed.input);
    revalidatePath(TEMPLATES_PATH);
    const t = record.template;
    return {
      status: "success",
      template: templateToClientShape(t),
      meta: {
        unitCost: t.unitCost,
        time: t.time,
        hourlyRate: t.hourlyRate,
        overhead: t.overhead,
        marginPct: t.marginPct,
      },
    };
  } catch (error) {
    return saveFailure(error);
  }
}
