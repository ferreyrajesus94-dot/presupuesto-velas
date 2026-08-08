/** PR4e — Server Actions for quotes. Mocks `requireOwner`, the repository, `buildQuoteSnapshot`, and `revalidatePath`. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class QuoteRepositoryError extends Error {
    constructor(
      readonly code:
        | "NOT_FOUND"
        | "INVALID_INPUT"
        | "LOCK_VERSION_MISMATCH"
        | "TERMINAL_STATUS"
        | "INVALID_STATUS"
        | "EXPIRED_SENT_CANNOT_ACCEPT",
      message: string,
    ) {
      super(message);
      this.name = "QuoteRepositoryError";
    }
  }
  return {
    QuoteRepositoryError,
    requireUser: vi.fn(),
    createQuoteDraft: vi.fn(),
    appendQuoteVersion: vi.fn(),
    transitionQuoteStatus: vi.fn(),
    buildQuoteSnapshot: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("../../src/server/auth/requireUser", () => ({ requireUser: mocks.requireUser }));
vi.mock("../../src/server/repositories/quotes", () => ({
  QuoteRepositoryError: mocks.QuoteRepositoryError,
  createQuoteDraft: mocks.createQuoteDraft,
  appendQuoteVersion: mocks.appendQuoteVersion,
  transitionQuoteStatus: mocks.transitionQuoteStatus,
}));
vi.mock("../../src/domain/quote", () => ({ buildQuoteSnapshot: mocks.buildQuoteSnapshot }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
  appendQuoteVersionAction,
  createQuoteDraftAction,
  transitionQuoteStatusAction,
} from "../../src/server/actions/quotes";

const OWNER = { id: "user-1", email: "user@example.com" };
const RECIPE_ID = "11111111-2222-4333-8444-555555555555";
const QUOTE_ID = "quote-uuid-1";
const REPO_ERR = (code: string, msg: string) => new mocks.QuoteRepositoryError(code as never, msg);

const FAKE_QUOTE_RECORD = {
  quote: { id: QUOTE_ID, ownerId: OWNER.id, status: "draft", lockVersion: 0 },
  versions: [],
  models: [],
  materials: [],
  indirectCosts: [],
};
const FAKE_SNAPSHOT = { id: "snapshot-1", total: "1500.00", models: [] };
const FAKE_VERSION = { quoteId: QUOTE_ID, versionNo: 1 };
const FAKE_EVENT = { id: "e1", quoteId: QUOTE_ID, fromStatus: "draft", toStatus: "sent" };

type Draft = Parameters<typeof createQuoteDraftAction>[0];
const VALID_DRAFT: Draft = {
  expirationDate: "2026-12-31",
  profit: { mode: "percentage", percent: "30" },
  depositPercent: "50",
  indirectCosts: [],
  models: [{ recipeId: RECIPE_ID, quantity: "10" }],
  visibility: { internalCost: true, profitMargin: true },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireUser.mockResolvedValue(OWNER);
  mocks.buildQuoteSnapshot.mockReturnValue(FAKE_SNAPSHOT);
});

const expectInvalidInput = (result: unknown) =>
  expect(result).toEqual({
    ok: false,
    error: { code: "INVALID_INPUT", message: expect.any(String) },
  });

describe("createQuoteDraftAction", () => {
  it("creates a draft for the owner and revalidates /quotes", async () => {
    mocks.createQuoteDraft.mockResolvedValue(FAKE_QUOTE_RECORD);
    const result = await createQuoteDraftAction({ ...VALID_DRAFT, customerName: "Acme" });
    expect(result).toEqual({ ok: true, value: FAKE_QUOTE_RECORD });
    expect(mocks.createQuoteDraft).toHaveBeenCalledWith(OWNER.id, {
      expirationDate: "2026-12-31",
      customerName: "Acme",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/quotes");
  });

  it("returns INVALID_INPUT without calling the repository when Zod validation fails", async () => {
    const result = await createQuoteDraftAction({ ...VALID_DRAFT, expirationDate: "not-a-date" });
    expectInvalidInput(result);
    expect(mocks.createQuoteDraft).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps QuoteRepositoryError codes 1:1 to the result envelope", async () => {
    mocks.createQuoteDraft.mockRejectedValue(REPO_ERR("NOT_FOUND", 'Quote "x" was not found'));
    const result = await createQuoteDraftAction(VALID_DRAFT);
    expect(result).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: expect.stringContaining("x") },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "__redirect:/sign-in"],
    ["non-owner", "__redirect:/403"],
  ])("preserves %s denial before validation or mutation", async (_label, redirect) => {
    const error = Object.assign(new Error(redirect), { __redirect: redirect.slice(11) });
    mocks.requireUser.mockRejectedValue(error);
    await expect(createQuoteDraftAction(VALID_DRAFT)).rejects.toMatchObject({
      __redirect: error.__redirect,
    });
    expect(mocks.createQuoteDraft).not.toHaveBeenCalled();
  });
});

describe("appendQuoteVersionAction", () => {
  it("builds the snapshot then calls the repository with the owner + lock version", async () => {
    mocks.appendQuoteVersion.mockResolvedValue({
      quote: { id: QUOTE_ID, status: "draft", lockVersion: 1 },
      version: FAKE_VERSION,
    });
    const result = await appendQuoteVersionAction(QUOTE_ID, VALID_DRAFT, 0);
    expect(result).toEqual({
      ok: true,
      value: { quote: { id: QUOTE_ID, status: "draft", lockVersion: 1 }, version: FAKE_VERSION },
    });
    expect(mocks.buildQuoteSnapshot).toHaveBeenCalledWith(VALID_DRAFT);
    expect(mocks.appendQuoteVersion).toHaveBeenCalledWith(OWNER.id, QUOTE_ID, FAKE_SNAPSHOT, 0);
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/quotes");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, `/quotes/${QUOTE_ID}`);
  });

  it.each([
    ["LOCK_VERSION_MISMATCH", "expected lockVersion 0 but found 2"],
    ["TERMINAL_STATUS", 'quote status "accepted" is terminal; duplicate to create a new version'],
    ["NOT_FOUND", 'Quote "missing" was not found'],
  ])("returns %s without revalidating when the repo rejects", async (code, message) => {
    mocks.appendQuoteVersion.mockRejectedValue(REPO_ERR(code, message));
    const result = await appendQuoteVersionAction(QUOTE_ID, VALID_DRAFT, 0);
    expect(result).toEqual({
      ok: false,
      error: { code, message: expect.any(String) },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns INVALID_INPUT without calling the repository when expectedLockVersion is negative", async () => {
    const result = await appendQuoteVersionAction(QUOTE_ID, VALID_DRAFT, -1);
    expectInvalidInput(result);
    expect(mocks.buildQuoteSnapshot).not.toHaveBeenCalled();
    expect(mocks.appendQuoteVersion).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "__redirect:/sign-in"],
    ["non-owner", "__redirect:/403"],
  ])("preserves %s denial before validation or mutation", async (_label, redirect) => {
    const error = Object.assign(new Error(redirect), { __redirect: redirect.slice(11) });
    mocks.requireUser.mockRejectedValue(error);
    await expect(appendQuoteVersionAction(QUOTE_ID, VALID_DRAFT, 0)).rejects.toMatchObject({
      __redirect: error.__redirect,
    });
    expect(mocks.buildQuoteSnapshot).not.toHaveBeenCalled();
  });
});

describe("transitionQuoteStatusAction", () => {
  it("calls transitionQuoteStatus for the owner and revalidates both paths", async () => {
    mocks.transitionQuoteStatus.mockResolvedValue({
      quote: { id: QUOTE_ID, status: "sent", lockVersion: 1 },
      event: FAKE_EVENT,
    });
    const result = await transitionQuoteStatusAction(QUOTE_ID, "draft", "sent", 0);
    expect(result).toEqual({
      ok: true,
      value: { quote: { id: QUOTE_ID, status: "sent", lockVersion: 1 }, event: FAKE_EVENT },
    });
    expect(mocks.transitionQuoteStatus).toHaveBeenCalledWith(
      OWNER.id,
      QUOTE_ID,
      "draft",
      "sent",
      0,
    );
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/quotes");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, `/quotes/${QUOTE_ID}`);
  });

  it("returns INVALID_STATUS when the FSM rejects the transition", async () => {
    const result = await transitionQuoteStatusAction(QUOTE_ID, "draft", "accepted", 0);
    expect(result).toEqual({
      ok: false,
      error: { code: "INVALID_STATUS", message: expect.any(String) },
    });
    expect(mocks.transitionQuoteStatus).not.toHaveBeenCalled();
  });

  it("returns EXPIRED_SENT_CANNOT_ACCEPT without revalidating when the repo rejects", async () => {
    mocks.transitionQuoteStatus.mockRejectedValue(
      REPO_ERR(
        "EXPIRED_SENT_CANNOT_ACCEPT",
        "an expired sent quote cannot transition directly to accepted",
      ),
    );
    const result = await transitionQuoteStatusAction(QUOTE_ID, "sent", "accepted", 1);
    expect(result).toEqual({
      ok: false,
      error: { code: "EXPIRED_SENT_CANNOT_ACCEPT", message: expect.any(String) },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", "__redirect:/sign-in"],
    ["non-owner", "__redirect:/403"],
  ])("preserves %s denial before validation or mutation", async (_label, redirect) => {
    const error = Object.assign(new Error(redirect), { __redirect: redirect.slice(11) });
    mocks.requireUser.mockRejectedValue(error);
    await expect(transitionQuoteStatusAction(QUOTE_ID, "draft", "sent", 0)).rejects.toMatchObject({
      __redirect: error.__redirect,
    });
    expect(mocks.transitionQuoteStatus).not.toHaveBeenCalled();
  });
});
