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
    requireUser: vi.fn(),
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
    archiveTemplate: vi.fn(),
    restoreTemplate: vi.fn(),
    findNextDefaultTemplateName: vi.fn(),
    createBlankTemplate: vi.fn(),
    deleteTemplateRow: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("../../src/server/auth/requireUser", () => ({
  requireUser: mocks.requireUser,
}));
vi.mock("../../src/server/repositories/templates", () => ({
  TemplateRepositoryError: mocks.RepositoryError,
  createTemplate: mocks.createTemplate,
  updateTemplate: mocks.updateTemplate,
  archiveTemplate: mocks.archiveTemplate,
  restoreTemplate: mocks.restoreTemplate,
  createBlankTemplate: mocks.createBlankTemplate,
  findNextDefaultTemplateName: mocks.findNextDefaultTemplateName,
  deleteTemplateRow: mocks.deleteTemplateRow,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  archiveTemplateAction,
  createBlankTemplateAction,
  createTemplateAction,
  deleteTemplateAction,
  restoreTemplateAction,
  saveTemplateAction,
  updateTemplateAction,
} from "../../src/server/actions/templates";

const OWNER = { id: "user-1", email: "user@example.com" };
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
  mocks.requireUser.mockResolvedValue(OWNER);
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
    mocks.requireUser.mockRejectedValue(error);

    await expect(createTemplateAction(INITIAL_STATE, templateForm())).rejects.toMatchObject({
      __redirect: error.__redirect,
    });

    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createBlankTemplateAction", () => {
  it("persists a name-only template row, returns its id/name, and revalidates the catalog", async () => {
    mocks.createBlankTemplate.mockResolvedValue({
      id: "server-template-1",
      name: "Nueva plantilla 1",
    });

    const data = new FormData();
    data.set("name", "Nueva plantilla 1");
    const result = await createBlankTemplateAction(data);

    expect(result).toEqual({
      status: "success",
      id: "server-template-1",
      name: "Nueva plantilla 1",
    });
    expect(mocks.createBlankTemplate).toHaveBeenCalledWith(OWNER.id, "Nueva plantilla 1");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("trims the requested name before hitting the repository", async () => {
    mocks.createBlankTemplate.mockResolvedValue({
      id: "server-template-2",
      name: "Nueva plantilla 3",
    });

    const data = new FormData();
    data.set("name", "  Nueva plantilla 3  ");
    await createBlankTemplateAction(data);

    expect(mocks.createBlankTemplate).toHaveBeenCalledWith(OWNER.id, "Nueva plantilla 3");
  });

  it("auto-generates a default name when the name is empty", async () => {
    mocks.findNextDefaultTemplateName.mockResolvedValue("Nueva plantilla 1");
    mocks.createBlankTemplate.mockResolvedValue({
      id: "server-template-2",
      name: "Nueva plantilla 1",
    });

    const data = new FormData();
    data.set("name", "   ");
    const result = await createBlankTemplateAction(data);

    expect(result).toEqual({
      status: "success",
      id: "server-template-2",
      name: "Nueva plantilla 1",
    });
    expect(mocks.findNextDefaultTemplateName).toHaveBeenCalledWith(OWNER.id);
    expect(mocks.createBlankTemplate).toHaveBeenCalledWith(OWNER.id, "Nueva plantilla 1");
  });

  it("uses distinct server-picked names for parallel default creations", async () => {
    mocks.findNextDefaultTemplateName
      .mockResolvedValueOnce("Nueva plantilla 1")
      .mockResolvedValueOnce("Nueva plantilla 2");
    mocks.createBlankTemplate
      .mockResolvedValueOnce({ id: "server-template-1", name: "Nueva plantilla 1" })
      .mockResolvedValueOnce({ id: "server-template-2", name: "Nueva plantilla 2" });

    const [first, second] = await Promise.all([
      createBlankTemplateAction(new FormData()),
      createBlankTemplateAction(new FormData()),
    ]);

    expect(first).toEqual({
      status: "success",
      id: "server-template-1",
      name: "Nueva plantilla 1",
    });
    expect(second).toEqual({
      status: "success",
      id: "server-template-2",
      name: "Nueva plantilla 2",
    });
  });

  it("maps DUPLICATE_NAME to a friendly Spanish message and skips revalidation", async () => {
    mocks.createBlankTemplate.mockRejectedValue(
      new mocks.RepositoryError("DUPLICATE_NAME", 'Template name "X" is already used'),
    );

    const data = new FormData();
    data.set("name", "Nueva plantilla 2");
    const result = await createBlankTemplateAction(data);

    expect(result).toEqual({
      status: "error",
      message: "Ya existe una plantilla con ese nombre.",
    });
    if (result.status === "error") {
      expect(result.message).not.toContain("X");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unknown repository errors to a safe fallback without leaking details", async () => {
    mocks.createBlankTemplate.mockRejectedValue(new Error("connection refused"));

    const data = new FormData();
    data.set("name", "Nueva plantilla 9");
    const result = await createBlankTemplateAction(data);

    expect(result).toEqual({
      status: "error",
      message: "No se pudo crear la plantilla.",
    });
    if (result.status === "error") {
      expect(result.message).not.toContain("connection");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteTemplateAction", () => {
  function idForm(id: string): FormData {
    const data = new FormData();
    data.set("id", id);
    return data;
  }

  it("hard-deletes the template row and revalidates the catalog on success", async () => {
    mocks.deleteTemplateRow.mockResolvedValue(undefined);

    const result = await deleteTemplateAction(idForm("template-1"));

    expect(result).toEqual({ status: "success", id: "template-1" });
    expect(mocks.deleteTemplateRow).toHaveBeenCalledWith(OWNER.id, "template-1");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("returns a friendly Spanish error when the id is missing and skips the repository", async () => {
    const data = new FormData();
    const result = await deleteTemplateAction(data);

    expect(result).toEqual({
      status: "error",
      message: "Falta el identificador de la plantilla.",
    });
    expect(mocks.deleteTemplateRow).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps NOT_FOUND to a friendly Spanish message without leaking the id", async () => {
    mocks.deleteTemplateRow.mockRejectedValue(
      new mocks.RepositoryError("NOT_FOUND", 'Template "ghost-id" was not found'),
    );

    const result = await deleteTemplateAction(idForm("ghost-id"));

    expect(result).toEqual({
      status: "error",
      message: "No se pudo eliminar la plantilla.",
    });
    if (result.status === "error") {
      expect(result.message).not.toContain("ghost-id");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unknown repository errors to a safe fallback", async () => {
    mocks.deleteTemplateRow.mockRejectedValue(new Error("connection refused"));

    const result = await deleteTemplateAction(idForm("template-1"));

    expect(result).toEqual({
      status: "error",
      message: "No se pudo eliminar la plantilla.",
    });
    if (result.status === "error") {
      expect(result.message).not.toContain("connection");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

function saveForm(
  over: Partial<{
    id: string;
    name: string;
    items: unknown;
    time: string;
    hourlyRate: string;
    overhead: string;
    marginPct: string;
  }> = {},
): FormData {
  const data = new FormData();
  if (over.id !== undefined) data.set("id", over.id);
  data.set("name", over.name ?? "Vanilla");
  data.set("items", JSON.stringify(over.items ?? ITEMS));
  data.set("time", over.time ?? "");
  data.set("hourlyRate", over.hourlyRate ?? "");
  data.set("overhead", over.overhead ?? "");
  data.set("marginPct", over.marginPct ?? "");
  return data;
}

describe("saveTemplateAction", () => {
  it("creates the template when no id is provided and revalidates the catalog", async () => {
    mocks.createTemplate.mockResolvedValue({
      template: {
        id: "server-template-1",
        name: "Vanilla",
        unitCost: "10",
        archivedAt: null,
        time: "0",
        hourlyRate: "0",
        overhead: "0",
        marginPct: "30",
      },
      items: [],
    });

    const result = await saveTemplateAction(
      saveForm({
        name: "Vanilla",
        time: "60",
        hourlyRate: "1500",
        overhead: "200",
        marginPct: "35",
      }),
    );

    expect(result).toEqual({
      status: "success",
      template: {
        id: "server-template-1",
        name: "Vanilla",
        unitCost: "10",
        archivedAt: null,
        time: "0",
        hourlyRate: "0",
        overhead: "0",
        marginPct: "30",
      },
      meta: {
        unitCost: "10",
        time: "0",
        hourlyRate: "0",
        overhead: "0",
        marginPct: "30",
      },
    });
    expect(mocks.createTemplate).toHaveBeenCalledWith(
      OWNER.id,
      expect.objectContaining({
        name: "Vanilla",
        time: "60",
        hourlyRate: "1500",
        overhead: "200",
        marginPct: "35",
      }),
    );
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("updates the template when an id is provided and revalidates the catalog", async () => {
    mocks.updateTemplate.mockResolvedValue({
      template: {
        id: "template-1",
        name: "Renamed",
        unitCost: "20",
        archivedAt: null,
        time: "30",
        hourlyRate: "1500",
        overhead: "100",
        marginPct: "40",
      },
      items: [],
    });

    const result = await saveTemplateAction(saveForm({ id: "template-1", name: "Renamed" }));

    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("expected success");
    expect(result.template.id).toBe("template-1");
    expect(result.template.time).toBe("30");
    expect(mocks.updateTemplate).toHaveBeenCalledWith(
      OWNER.id,
      "template-1",
      expect.objectContaining({ name: "Renamed" }),
    );
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("maps DUPLICATE_NAME to a friendly Spanish message without leaking the name", async () => {
    mocks.createTemplate.mockRejectedValue(
      new mocks.RepositoryError("DUPLICATE_NAME", 'Template name "X" is already used'),
    );

    const result = await saveTemplateAction(saveForm({ name: "Duplicado" }));

    expect(result).toEqual({
      status: "error",
      message: "Ya existe una plantilla con ese nombre.",
    });
    if (result.status === "error") {
      expect(result.message).not.toContain("Duplicado");
      expect(result.message).not.toContain("X");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps MATERIAL_UNAVAILABLE to a friendly Spanish message", async () => {
    mocks.updateTemplate.mockRejectedValue(
      new mocks.RepositoryError("MATERIAL_UNAVAILABLE", "ghost material id"),
    );

    const result = await saveTemplateAction(saveForm({ id: "template-1" }));

    expect(result).toEqual({
      status: "error",
      message: "La plantilla referencia un material archivado o inexistente.",
    });
    if (result.status === "error") {
      expect(result.message).not.toContain("ghost");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps NOT_FOUND to a friendly Spanish message when the row vanished", async () => {
    mocks.updateTemplate.mockRejectedValue(
      new mocks.RepositoryError("NOT_FOUND", 'Template "ghost-id" was not found'),
    );

    const result = await saveTemplateAction(saveForm({ id: "ghost-id" }));

    expect(result).toEqual({
      status: "error",
      message: "No se encontró la plantilla para guardar.",
    });
    if (result.status === "error") {
      expect(result.message).not.toContain("ghost-id");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects malformed items payload without calling the repository", async () => {
    const data = new FormData();
    data.set("name", "Vanilla");
    data.set("items", "not-json");

    const result = await saveTemplateAction(data);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toBeDefined();
    }
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns schema field errors when name is empty or items are missing", async () => {
    const result = await saveTemplateAction(saveForm({ name: "", items: [] }));

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.fieldErrors?.name).toEqual(["Name is required"]);
      expect(result.fieldErrors?.items).toBeDefined();
    }
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps unknown repository errors to a safe fallback Spanish message", async () => {
    mocks.createTemplate.mockRejectedValue(new Error("connection refused"));

    const result = await saveTemplateAction(saveForm());

    expect(result).toEqual({
      status: "error",
      message: "No se pudo guardar la plantilla.",
    });
    if (result.status === "error") {
      expect(result.message).not.toContain("connection");
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves unauthenticated denial before validation or mutation", async () => {
    const error = Object.assign(new Error("__redirect:/sign-in"), {
      __redirect: "/sign-in",
    });
    mocks.requireUser.mockRejectedValue(error);

    await expect(saveTemplateAction(saveForm())).rejects.toMatchObject({
      __redirect: "/sign-in",
    });
    expect(mocks.createTemplate).not.toHaveBeenCalled();
    expect(mocks.updateTemplate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
