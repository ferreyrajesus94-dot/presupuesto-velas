import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR4.per-user-isolation (Task 4.4) — Cross-user negative tests at every
 * server action. Proves the design contract from spec §4 ISOLATION:
 * "Action layer SHALL source `userId` only from `requireUser()` and SHALL
 * ignore any caller-supplied id."
 *
 * Pattern: mock `requireUser()` to return User B, include a caller-
 * supplied `__impersonatedUserId` field holding User A, invoke the
 * action, assert the repository was called with `userB.id`. If a future
 * change starts reading userId from form data, these tests fail — the
 * contract is enforceable, not just aspirational.
 */

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  buildQuoteSnapshot: vi.fn(),
  // materials
  createMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  archiveMaterial: vi.fn(),
  unarchiveMaterial: vi.fn(),
  // templates
  createTemplate: vi.fn(),
  createBlankTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  archiveTemplate: vi.fn(),
  restoreTemplate: vi.fn(),
  deleteTemplateRow: vi.fn(),
  // quotes
  createQuoteDraft: vi.fn(),
  appendQuoteVersion: vi.fn(),
  transitionQuoteStatus: vi.fn(),
  deleteQuoteDraft: vi.fn(),
}));

vi.mock("../../src/server/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("../../src/server/repositories/materials", () => ({
  createMaterial: mocks.createMaterial,
  updateMaterial: mocks.updateMaterial,
  archiveMaterial: mocks.archiveMaterial,
  unarchiveMaterial: mocks.unarchiveMaterial,
}));
vi.mock("../../src/server/repositories/templates", () => ({
  createTemplate: mocks.createTemplate,
  createBlankTemplate: mocks.createBlankTemplate,
  updateTemplate: mocks.updateTemplate,
  archiveTemplate: mocks.archiveTemplate,
  restoreTemplate: mocks.restoreTemplate,
  deleteTemplateRow: mocks.deleteTemplateRow,
}));
vi.mock("../../src/server/repositories/quotes", () => ({
  createQuoteDraft: mocks.createQuoteDraft,
  appendQuoteVersion: mocks.appendQuoteVersion,
  transitionQuoteStatus: mocks.transitionQuoteStatus,
  deleteQuoteDraft: mocks.deleteQuoteDraft,
}));
vi.mock("../../src/domain/quote", () => ({ buildQuoteSnapshot: mocks.buildQuoteSnapshot }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  archiveMaterialAction,
  createMaterialAction,
  unarchiveMaterialAction,
  updateMaterialAction,
} from "../../src/server/actions/materials";
import {
  archiveTemplateAction,
  createBlankTemplateAction,
  createTemplateAction,
  deleteTemplateAction,
  restoreTemplateAction,
  updateTemplateAction,
} from "../../src/server/actions/templates";
import {
  appendQuoteVersionAction,
  createQuoteDraftAction,
  transitionQuoteStatusAction,
} from "../../src/server/actions/quotes";
import { deleteQuoteDraftAction } from "../../src/server/actions/quotes-delete";

const USER_A = "user-A-impostor";
const USER_B = "user-B-authenticated";
const IMP = "__impersonatedUserId";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}
const INITIAL = { status: "idle" as const };
const TEMPLATE_ITEMS = JSON.stringify([{ materialId: "m-1", quantity: "1", unit: "g" }]);
const RECIPE_UUID = "11111111-2222-4333-8444-555555555555";
const DRAFT_INPUT = {
  expirationDate: "2099-12-31",
  profit: { mode: "percentage" as const, percent: "30" },
  depositPercent: "50",
  indirectCosts: [],
  models: [{ recipeId: RECIPE_UUID, quantity: "10" }],
  visibility: { internalCost: true, profitMargin: true },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue({ id: USER_B, email: `${USER_B}@e.com`, role: "user" });
});

describe("actions ignore caller-supplied userId", () => {
  it("createMaterialAction", async () => {
    mocks.createMaterial.mockResolvedValue({ id: "m" });
    await createMaterialAction(
      INITIAL,
      form({
        name: "Wax",
        dimension: "mass",
        baseUnit: "g",
        purchaseUnit: "kg",
        purchaseQuantity: "1",
        purchasePrice: "10000",
        [IMP]: USER_A,
      }),
    );
    expect(mocks.createMaterial.mock.calls[0][0]).toBe(USER_B);
  });

  it("updateMaterialAction", async () => {
    mocks.updateMaterial.mockResolvedValue({ id: "m" });
    await updateMaterialAction(
      INITIAL,
      form({
        id: "m",
        name: "Wax",
        dimension: "mass",
        baseUnit: "g",
        purchaseUnit: "kg",
        purchaseQuantity: "1",
        purchasePrice: "10000",
        [IMP]: USER_A,
      }),
    );
    expect(mocks.updateMaterial.mock.calls[0][0]).toBe(USER_B);
  });

  it("archiveMaterialAction", async () => {
    mocks.archiveMaterial.mockResolvedValue({ id: "m" });
    await archiveMaterialAction(INITIAL, form({ id: "m", [IMP]: USER_A }));
    expect(mocks.archiveMaterial.mock.calls[0][0]).toBe(USER_B);
  });

  it("unarchiveMaterialAction", async () => {
    mocks.unarchiveMaterial.mockResolvedValue({ id: "m" });
    await unarchiveMaterialAction(INITIAL, form({ id: "m", [IMP]: USER_A }));
    expect(mocks.unarchiveMaterial.mock.calls[0][0]).toBe(USER_B);
  });

  it("createTemplateAction", async () => {
    mocks.createTemplate.mockResolvedValue({ template: { id: "t" }, items: [] });
    await createTemplateAction(
      INITIAL,
      form({ name: "Tpl", items: TEMPLATE_ITEMS, [IMP]: USER_A }),
    );
    expect(mocks.createTemplate.mock.calls[0][0]).toBe(USER_B);
  });

  it("createBlankTemplateAction", async () => {
    mocks.createBlankTemplate.mockResolvedValue({ id: "t", name: "Tpl" });
    await createBlankTemplateAction(form({ name: "Tpl", [IMP]: USER_A }));
    expect(mocks.createBlankTemplate.mock.calls[0][0]).toBe(USER_B);
  });

  it("updateTemplateAction", async () => {
    mocks.updateTemplate.mockResolvedValue({ template: { id: "t" }, items: [] });
    await updateTemplateAction(
      INITIAL,
      form({ id: "t", name: "Tpl", items: TEMPLATE_ITEMS, [IMP]: USER_A }),
    );
    expect(mocks.updateTemplate.mock.calls[0][0]).toBe(USER_B);
  });

  it("archiveTemplateAction", async () => {
    mocks.archiveTemplate.mockResolvedValue({ id: "t" });
    await archiveTemplateAction(INITIAL, form({ id: "t", [IMP]: USER_A }));
    expect(mocks.archiveTemplate.mock.calls[0][0]).toBe(USER_B);
  });

  it("restoreTemplateAction", async () => {
    mocks.restoreTemplate.mockResolvedValue({ id: "t" });
    await restoreTemplateAction(INITIAL, form({ id: "t", [IMP]: USER_A }));
    expect(mocks.restoreTemplate.mock.calls[0][0]).toBe(USER_B);
  });

  it("deleteTemplateAction", async () => {
    await deleteTemplateAction(form({ id: "t", [IMP]: USER_A }));
    expect(mocks.deleteTemplateRow.mock.calls[0][0]).toBe(USER_B);
  });

  it("createQuoteDraftAction", async () => {
    mocks.createQuoteDraft.mockResolvedValue({
      quote: { id: "q" },
      versions: [],
      models: [],
      materials: [],
      indirectCosts: [],
    });
    await createQuoteDraftAction(DRAFT_INPUT);
    expect(mocks.createQuoteDraft.mock.calls[0][0]).toBe(USER_B);
  });

  it("appendQuoteVersionAction", async () => {
    mocks.buildQuoteSnapshot.mockReturnValue({ id: "s" });
    mocks.appendQuoteVersion.mockResolvedValue({ quote: { id: "q" }, version: {} });
    await appendQuoteVersionAction("q", DRAFT_INPUT, 0);
    expect(mocks.appendQuoteVersion.mock.calls[0][0]).toBe(USER_B);
  });

  it("transitionQuoteStatusAction", async () => {
    mocks.transitionQuoteStatus.mockResolvedValue({ quote: { id: "q" }, event: {} });
    await transitionQuoteStatusAction("q", "draft", "sent", 0);
    expect(mocks.transitionQuoteStatus.mock.calls[0][0]).toBe(USER_B);
  });

  it("deleteQuoteDraftAction", async () => {
    mocks.deleteQuoteDraft.mockResolvedValue({ ok: true });
    await deleteQuoteDraftAction("q");
    expect(mocks.deleteQuoteDraft.mock.calls[0][0]).toBe(USER_B);
  });
});
