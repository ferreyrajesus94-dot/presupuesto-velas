import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class RepositoryError extends Error {
    constructor(
      readonly code: "NOT_FOUND" | "DUPLICATE_NAME" | "BASE_UNIT_REFERENCED",
      message: string,
    ) {
      super(message);
    }
  }
  return {
    RepositoryError,
    requireOwner: vi.fn(),
    createMaterial: vi.fn(),
    updateMaterial: vi.fn(),
    archiveMaterial: vi.fn(),
    unarchiveMaterial: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("../../src/server/auth/requireOwner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("../../src/server/repositories/materials", () => ({
  MaterialRepositoryError: mocks.RepositoryError,
  createMaterial: mocks.createMaterial,
  updateMaterial: mocks.updateMaterial,
  archiveMaterial: mocks.archiveMaterial,
  unarchiveMaterial: mocks.unarchiveMaterial,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  archiveMaterialAction,
  createMaterialAction,
  unarchiveMaterialAction,
  updateMaterialAction,
} from "../../src/server/actions/materials";

const OWNER = { id: "owner-1", email: "owner@example.com" };
const MATERIAL = { id: "material-1" };
const INITIAL_STATE = { status: "idle" as const };

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function materialForm(name = "Soy wax") {
  return form({
    name,
    dimension: "mass",
    baseUnit: "g",
    purchaseUnit: "kg",
    purchaseQuantity: "1",
    purchasePrice: "10000",
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue(OWNER);
});

describe("material Server Actions", () => {
  it("creates a material for the authenticated owner and revalidates the catalog", async () => {
    mocks.createMaterial.mockResolvedValue(MATERIAL);

    const result = await createMaterialAction(INITIAL_STATE, materialForm());

    expect(result).toEqual({ status: "success", materialId: "material-1" });
    expect(mocks.createMaterial).toHaveBeenCalledWith(
      OWNER.id,
      expect.objectContaining({ name: "Soy wax" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/materials");
  });

  it("updates only the current material for the owner", async () => {
    mocks.updateMaterial.mockResolvedValue(MATERIAL);

    const result = await updateMaterialAction(
      INITIAL_STATE,
      form({ ...Object.fromEntries(materialForm()), id: "material-1", name: "New wax" }),
    );

    expect(result).toEqual({ status: "success", materialId: "material-1" });
    expect(mocks.updateMaterial).toHaveBeenCalledWith(
      OWNER.id,
      "material-1",
      expect.objectContaining({ name: "New wax" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/materials");
  });

  it("archives an owner material", async () => {
    mocks.archiveMaterial.mockResolvedValue(MATERIAL);

    const result = await archiveMaterialAction(INITIAL_STATE, form({ id: "material-1" }));

    expect(result).toEqual({ status: "success", materialId: "material-1" });
    expect(mocks.archiveMaterial).toHaveBeenCalledWith(OWNER.id, "material-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/materials");
  });

  it("unarchives an owner material", async () => {
    mocks.unarchiveMaterial.mockResolvedValue(MATERIAL);

    const result = await unarchiveMaterialAction(INITIAL_STATE, form({ id: "material-1" }));

    expect(result).toEqual({ status: "success", materialId: "material-1" });
    expect(mocks.unarchiveMaterial).toHaveBeenCalledWith(OWNER.id, "material-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/materials");
  });

  it("returns schema field errors without calling the repository", async () => {
    const result = await createMaterialAction(INITIAL_STATE, materialForm(""));

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toEqual(["Name is required"]);
    expect(mocks.createMaterial).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps duplicate names without exposing repository details", async () => {
    mocks.createMaterial.mockRejectedValue(
      new mocks.RepositoryError("DUPLICATE_NAME", 'Material name "Soy wax" is already used'),
    );

    const result = await createMaterialAction(INITIAL_STATE, materialForm());

    expect(result).toEqual({
      status: "error",
      message: "A material with that name already exists.",
    });
    expect(result.message).not.toContain("Soy wax");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps not-found and cross-owner mutations to the same safe result", async () => {
    mocks.updateMaterial.mockRejectedValue(
      new mocks.RepositoryError("NOT_FOUND", "secret-id details"),
    );

    const result = await updateMaterialAction(
      INITIAL_STATE,
      form({ ...Object.fromEntries(materialForm()), id: "other-owner-material" }),
    );

    expect(result).toEqual({ status: "error", message: "Material could not be found." });
    expect(result.message).not.toContain("secret-id");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "__redirect:/sign-in"],
    ["non-owner", "__redirect:/403"],
  ])("preserves %s denial before validation or mutation", async (_label, redirect) => {
    const error = Object.assign(new Error(redirect), { __redirect: redirect.slice(11) });
    mocks.requireOwner.mockRejectedValue(error);

    await expect(createMaterialAction(INITIAL_STATE, materialForm())).rejects.toMatchObject({
      __redirect: error.__redirect,
    });

    expect(mocks.createMaterial).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("R3-001: maps BASE_UNIT_REFERENCED to a safe UI message without leaking the material id", async () => {
    // The repository surfaces the typed error with the material id in the
    // message. The Server Action must translate it into a non-disclosing
    // user-facing sentence so the id never reaches the browser.
    mocks.updateMaterial.mockRejectedValue(
      new mocks.RepositoryError(
        "BASE_UNIT_REFERENCED",
        'Material "secret-material-id" base unit cannot change while referenced by templates',
      ),
    );

    const result = await updateMaterialAction(
      INITIAL_STATE,
      form({ ...Object.fromEntries(materialForm()), id: "secret-material-id", baseUnit: "g" }),
    );

    expect(result).toEqual({
      status: "error",
      message: "Base unit cannot be changed while this material is used in templates.",
    });
    expect(result.message).not.toContain("secret-material-id");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
