import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class RepositoryError extends Error {
    constructor(
      readonly code: "NOT_FOUND" | "DUPLICATE_NAME" | "MATERIAL_UNAVAILABLE",
      message: string,
    ) {
      super(message);
    }
  }
  return {
    RepositoryError,
    requireOwner: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    archiveTemplate: vi.fn(),
    restoreTemplate: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("../../src/server/auth/requireOwner", () => ({
  requireOwner: mocks.requireOwner,
}));
vi.mock("../../src/server/repositories/templates", () => ({
  TemplateRepositoryError: mocks.RepositoryError,
  createTemplate: mocks.createTemplate,
  updateTemplate: mocks.updateTemplate,
  archiveTemplate: mocks.archiveTemplate,
  restoreTemplate: mocks.restoreTemplate,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  archiveTemplateAction,
  createTemplateAction,
  restoreTemplateAction,
  updateTemplateAction,
} from "../../src/server/actions/templates";

const OWNER = { id: "owner-1", email: "owner@example.com" };
const TEMPLATE_RECORD = { template: { id: "template-1" }, items: [] };
const TEMPLATE = { id: "template-1" };
const INITIAL_STATE = { status: "idle" as const };

const ITEMS = [
  { materialId: "wax", quantity: "100", unit: "g" },
  { materialId: "scent", quantity: "50", unit: "ml" },
];

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function templateForm(name = "Vanilla", items = ITEMS) {
  return form({ name, items: JSON.stringify(items) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireOwner.mockResolvedValue(OWNER);
});

describe("template Server Actions", () => {
  it("creates a template for the authenticated owner and revalidates the catalog", async () => {
    mocks.createTemplate.mockResolvedValue(TEMPLATE_RECORD);

    const result = await createTemplateAction(INITIAL_STATE, templateForm());

    expect(result).toEqual({ status: "success", templateId: "template-1" });
    expect(mocks.createTemplate).toHaveBeenCalledWith(
      OWNER.id,
      expect.objectContaining({ name: "Vanilla" }),
    );
    expect(mocks.createTemplate.mock.calls[0][1].items).toEqual(ITEMS);
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("updates a template for the owner and revalidates the catalog", async () => {
    mocks.updateTemplate.mockResolvedValue(TEMPLATE_RECORD);

    const result = await updateTemplateAction(
      INITIAL_STATE,
      form({ id: "template-1", ...Object.fromEntries(templateForm("New Vanilla")) }),
    );

    expect(result).toEqual({ status: "success", templateId: "template-1" });
    expect(mocks.updateTemplate).toHaveBeenCalledWith(
      OWNER.id,
      "template-1",
      expect.objectContaining({ name: "New Vanilla" }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("archives a template for the owner", async () => {
    mocks.archiveTemplate.mockResolvedValue(TEMPLATE);

    const result = await archiveTemplateAction(INITIAL_STATE, form({ id: "template-1" }));

    expect(result).toEqual({ status: "success", templateId: "template-1" });
    expect(mocks.archiveTemplate).toHaveBeenCalledWith(OWNER.id, "template-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("restores a template for the owner", async () => {
    mocks.restoreTemplate.mockResolvedValue(TEMPLATE);

    const result = await restoreTemplateAction(INITIAL_STATE, form({ id: "template-1" }));

    expect(result).toEqual({ status: "success", templateId: "template-1" });
    expect(mocks.restoreTemplate).toHaveBeenCalledWith(OWNER.id, "template-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("returns a schema field error when name is empty without calling the repository", async () => {
    const result = await createTemplateAction(INITIAL_STATE, templateForm(""));

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.name).toEqual(["Name is required"]);
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a schema field error when items are empty without calling the repository", async () => {
    const result = await createTemplateAction(INITIAL_STATE, templateForm("Vanilla", []));

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.items).toBeDefined();
    expect(mocks.createTemplate).not.toHaveBeenCalled();
  });

  it("returns a malformed-items error when items JSON cannot be parsed", async () => {
    const result = await createTemplateAction(
      INITIAL_STATE,
      form({ name: "Vanilla", items: "not-json" }),
    );

    expect(result.status).toBe("error");
    expect(result.message).toBeDefined();
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps duplicate names without exposing repository details", async () => {
    mocks.createTemplate.mockRejectedValue(
      new mocks.RepositoryError("DUPLICATE_NAME", 'Template name "Vanilla" is already used'),
    );

    const result = await createTemplateAction(INITIAL_STATE, templateForm());

    expect(result).toEqual({
      status: "error",
      message: "A template with that name already exists.",
    });
    expect(result.message).not.toContain("Vanilla");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unavailable material to a safe user-facing message", async () => {
    mocks.createTemplate.mockRejectedValue(
      new mocks.RepositoryError("MATERIAL_UNAVAILABLE", "secret material details"),
    );

    const result = await createTemplateAction(INITIAL_STATE, templateForm());

    expect(result).toEqual({
      status: "error",
      message: "Template material is unavailable.",
    });
    expect(result.message).not.toContain("secret");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps not-found and cross-owner mutations to the same safe result", async () => {
    mocks.updateTemplate.mockRejectedValue(
      new mocks.RepositoryError("NOT_FOUND", "secret-id details"),
    );

    const result = await updateTemplateAction(
      INITIAL_STATE,
      form({ id: "other-owner-template", ...Object.fromEntries(templateForm()) }),
    );

    expect(result).toEqual({ status: "error", message: "Template could not be found." });
    expect(result.message).not.toContain("secret-id");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("requires the template id for update and returns a field error", async () => {
    const result = await updateTemplateAction(
      INITIAL_STATE,
      form({ name: "Vanilla", items: JSON.stringify(ITEMS) }),
    );

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.id).toEqual(["Template ID is required"]);
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "__redirect:/sign-in"],
    ["non-owner", "__redirect:/403"],
  ])("preserves %s denial before validation or mutation", async (_label, redirect) => {
    const error = Object.assign(new Error(redirect), { __redirect: redirect.slice(11) });
    mocks.requireOwner.mockRejectedValue(error);

    await expect(createTemplateAction(INITIAL_STATE, templateForm())).rejects.toMatchObject({
      __redirect: error.__redirect,
    });

    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
