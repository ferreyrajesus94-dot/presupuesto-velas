"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "../auth/requireOwner";
import {
  archiveTemplate,
  createTemplate,
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
