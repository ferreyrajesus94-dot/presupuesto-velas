"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "../auth/requireOwner";
import {
  archiveMaterial,
  createMaterial,
  MaterialRepositoryError,
  unarchiveMaterial,
  updateMaterial,
} from "../repositories/materials";
import {
  materialInputSchema,
  type MaterialInput,
  type ParsedMaterialInput,
} from "../validation/materialSchema";

const MATERIALS_PATH = "/materials";
type MaterialField = keyof MaterialInput | "unitCost" | "id";

export type MaterialActionState = {
  status: "idle" | "success" | "error";
  materialId?: string;
  message?: string;
  fieldErrors?: Partial<Record<MaterialField, string[]>>;
  values?: Partial<Record<MaterialField, string>>;
};

function value(formData: FormData, key: string): string {
  const item = formData.get(key);
  return typeof item === "string" ? item : "";
}

function readMaterialInput(formData: FormData): MaterialInput {
  return {
    name: value(formData, "name"),
    dimension: value(formData, "dimension") as MaterialInput["dimension"],
    baseUnit: value(formData, "baseUnit") as MaterialInput["baseUnit"],
    purchaseUnit: value(formData, "purchaseUnit") as MaterialInput["purchaseUnit"],
    purchaseQuantity: value(formData, "purchaseQuantity"),
    purchasePrice: value(formData, "purchasePrice"),
  };
}

function parseMaterialForm(
  formData: FormData,
): { parsed: ParsedMaterialInput } | { state: MaterialActionState } {
  const input = readMaterialInput(formData);
  const result = materialInputSchema.safeParse(input);
  if (!result.success) {
    return {
      state: {
        status: "error",
        fieldErrors: result.error.flatten().fieldErrors,
        values: input,
      },
    };
  }
  return { parsed: result.data };
}

function readId(formData: FormData): string | MaterialActionState {
  const id = value(formData, "id").trim();
  if (id) return id;
  return {
    status: "error",
    fieldErrors: { id: ["Material ID is required"] },
    values: { id },
  };
}

function failure(error: unknown, operation: string): MaterialActionState {
  if (error instanceof MaterialRepositoryError) {
    if (error.code === "DUPLICATE_NAME") {
      return { status: "error", message: "A material with that name already exists." };
    }
    // R3-001 prerequisite guard. Non-disclosing: we tell the user the
    // base unit cannot change while the material is referenced by
    // recipes, but never leak the material id or any internal detail.
    if (error.code === "BASE_UNIT_REFERENCED") {
      return {
        status: "error",
        message: "Base unit cannot be changed while this material is used in recipes.",
      };
    }
    return { status: "error", message: "Material could not be found." };
  }
  return { status: "error", message: `Unable to ${operation} material.` };
}

function success(materialId: string): MaterialActionState {
  revalidatePath(MATERIALS_PATH);
  return { status: "success", materialId };
}

export async function createMaterialAction(
  _previous: MaterialActionState,
  formData: FormData,
): Promise<MaterialActionState> {
  const owner = await requireOwner();
  const parsed = parseMaterialForm(formData);
  if ("state" in parsed) return parsed.state;
  try {
    const material = await createMaterial(owner.id, parsed.parsed);
    return success(material.id);
  } catch (error) {
    return failure(error, "create");
  }
}

export async function updateMaterialAction(
  _previous: MaterialActionState,
  formData: FormData,
): Promise<MaterialActionState> {
  const owner = await requireOwner();
  const parsed = parseMaterialForm(formData);
  if ("state" in parsed) return parsed.state;
  const id = readId(formData);
  if (typeof id !== "string") return id;
  try {
    const material = await updateMaterial(owner.id, id, parsed.parsed);
    return success(material.id);
  } catch (error) {
    return failure(error, "update");
  }
}

export async function archiveMaterialAction(
  _previous: MaterialActionState,
  formData: FormData,
): Promise<MaterialActionState> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") return id;
  try {
    const material = await archiveMaterial(owner.id, id);
    return success(material.id);
  } catch (error) {
    return failure(error, "archive");
  }
}

export async function unarchiveMaterialAction(
  _previous: MaterialActionState,
  formData: FormData,
): Promise<MaterialActionState> {
  const owner = await requireOwner();
  const id = readId(formData);
  if (typeof id !== "string") return id;
  try {
    const material = await unarchiveMaterial(owner.id, id);
    return success(material.id);
  } catch (error) {
    return failure(error, "restore");
  }
}
