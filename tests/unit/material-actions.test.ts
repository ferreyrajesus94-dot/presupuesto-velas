import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR2.auth-core (Task 2.8) — `material-actions.test.ts` rewritten for the
 * user era. `requireOwner` mock → `requireUser` mock; "non-owner" denial
 * case is removed because there is no more `/403` allowlist gate
 * (VERIFY-GATE redirects unverified users via `requireUser` instead).
 */

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
    requireUser: vi.fn(),
    createMaterial: vi.fn(),
    updateMaterial: vi.fn(),
    archiveMaterial: vi.fn(),
    unarchiveMaterial: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("../../src/server/auth/requireUser", () => ({
  requireUser: mocks.requireUser,
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

const USER = {
  id: "user-1",
  email: "user@example.com",
  role: "user" as const,
  emailVerified: true,
};
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
  mocks.requireUser.mockResolvedValue(USER);
});

describe("material Server Actions", () => {
  it("creates a material for the authenticated user and revalidates the catalog", async () => {
    mocks.createMaterial.mockResolvedValue(MATERIAL);

    const result = await createMaterialAction(INITIAL_STATE, materialForm());

    expect(result).toEqual({ status: "success", materialId: "material-1" });
    expect(mocks.createMaterial).toHaveBeenCalledWith(
      USER.id,
      expect.objectContaining({ name: "Soy wax" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/materials");
  });

  it("updates only the current material for the user", async () => {
    mocks.updateMaterial.mockResolvedValue(MATERIAL);

    const result = await updateMaterialAction(
      INITIAL_STATE,
      form({ ...Object.fromEntries(materialForm()), id: "material-1", name: "New wax" }),
    );

    expect(result).toEqual({ status: "success", materialId: "material-1" });
    expect(mocks.updateMaterial).toHaveBeenCalledWith(
      USER.id,
      "material-1",
      expect.objectContaining({ name: "New wax" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/materials");
  });

  it("archives a user material", async () => {
    mocks.archiveMaterial.mockResolvedValue(MATERIAL);

    const result = await archiveMaterialAction(INITIAL_STATE, form({ id: "material-1" }));

    expect(result).toEqual({ status: "success", materialId: "material-1" });
    expect(mocks.archiveMaterial).toHaveBeenCalledWith(USER.id, "material-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/materials");
  });

  it("unarchives a user material", async () => {
    mocks.unarchiveMaterial.mockResolvedValue(MATERIAL);

    const result = await unarchiveMaterialAction(INITIAL_STATE, form({ id: "material-1" }));

    expect(result).toEqual({ status: "success", materialId: "material-1" });
    expect(mocks.unarchiveMaterial).toHaveBeenCalledWith(USER.id, "material-1");
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

  it("maps not-found and cross-user mutations to the same safe result", async () => {
    mocks.updateMaterial.mockRejectedValue(
      new mocks.RepositoryError("NOT_FOUND", "secret-id details"),
    );

    const result = await updateMaterialAction(
      INITIAL_STATE,
      form({ ...Object.fromEntries(materialForm()), id: "other-user-material" }),
    );

    expect(result).toEqual({ status: "error", message: "Material could not be found." });
    expect(result.message).not.toContain("secret-id");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves unauthenticated denial before validation or mutation", async () => {
    const error = Object.assign(new Error("__redirect:/sign-in"), { __redirect: "/sign-in" });
    mocks.requireUser.mockRejectedValue(error);

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
