import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  archiveRecipeAction: vi.fn(),
  restoreRecipeAction: vi.fn(),
  reportLifecycle: vi.fn(),
}));

vi.mock("../../src/server/actions/recipes", () => ({
  archiveRecipeAction: mocks.archiveRecipeAction,
  restoreRecipeAction: mocks.restoreRecipeAction,
}));

vi.mock("../../src/app/recipes/RecipesArchiveFeedback", () => ({
  useRecipeArchiveFeedback: () => ({ reportLifecycle: mocks.reportLifecycle }),
}));

import { RecipeArchiveControl } from "../../src/app/recipes/RecipeArchiveControl";

const ARCHIVED = { id: "recipe-1", name: "Citrus candle", archived: true } as const;
const ACTIVE = { id: "recipe-2", name: "Vanilla candle", archived: false } as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.archiveRecipeAction.mockResolvedValue({ status: "success", recipeId: "recipe-2" });
  mocks.restoreRecipeAction.mockResolvedValue({ status: "success", recipeId: "recipe-1" });
});

function mockConfirm(value: boolean) {
  return vi.spyOn(window, "confirm").mockReturnValue(value);
}

describe("RecipeArchiveControl", () => {
  it.each([
    ["active", ACTIVE, "Archive Vanilla candle"],
    ["archived", ARCHIVED, "Restore Citrus candle"],
  ])("%s card renders the %s button with an accessible name", (_label, recipe, accessibleName) => {
    render(<RecipeArchiveControl recipe={recipe} />);
    expect(screen.getByRole("button", { name: accessibleName })).toBeInTheDocument();
  });

  it("confirms before archiving and skips dispatch on cancel", async () => {
    const user = userEvent.setup();
    const accepted = mockConfirm(true);
    render(<RecipeArchiveControl recipe={ACTIVE} />);
    await user.click(screen.getByRole("button", { name: "Archive Vanilla candle" }));
    expect(accepted).toHaveBeenCalledWith("Archive Vanilla candle? You can restore it later.");
    expect(mocks.archiveRecipeAction).toHaveBeenCalledTimes(1);
    expect((mocks.archiveRecipeAction.mock.calls[0][1] as FormData).get("id")).toBe("recipe-2");
    accepted.mockRestore();
    mocks.reportLifecycle.mockClear();
    const cancelled = mockConfirm(false);
    await user.click(screen.getByRole("button", { name: "Archive Vanilla candle" }));
    expect(cancelled).toHaveBeenCalled();
    expect(mocks.archiveRecipeAction).toHaveBeenCalledTimes(1);
    expect(mocks.reportLifecycle).not.toHaveBeenCalled();
    cancelled.mockRestore();
  });

  it("restores without confirmation when the recipe is archived", async () => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(false);
    render(<RecipeArchiveControl recipe={ARCHIVED} />);
    await user.click(screen.getByRole("button", { name: "Restore Citrus candle" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mocks.restoreRecipeAction).toHaveBeenCalledTimes(1);
    expect((mocks.restoreRecipeAction.mock.calls[0][1] as FormData).get("id")).toBe("recipe-1");
    confirmSpy.mockRestore();
  });

  it("delegates successful lifecycle feedback to the parent provider", async () => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    render(<RecipeArchiveControl recipe={ACTIVE} />);
    await user.click(screen.getByRole("button", { name: "Archive Vanilla candle" }));
    await waitFor(() =>
      expect(mocks.reportLifecycle).toHaveBeenCalledWith({
        operation: "archive",
        recipeId: "recipe-2",
        recipeName: "Vanilla candle",
      }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("discards a failed archive intent before reporting a successful restore", async () => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    mocks.archiveRecipeAction.mockResolvedValueOnce({ status: "error", message: "not found" });
    const { rerender } = render(<RecipeArchiveControl recipe={ACTIVE} />);
    await user.click(screen.getByRole("button", { name: "Archive Vanilla candle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not found");
    rerender(<RecipeArchiveControl recipe={{ ...ACTIVE, archived: true }} />);
    await user.click(screen.getByRole("button", { name: "Restore Vanilla candle" }));
    await waitFor(() =>
      expect(mocks.reportLifecycle).toHaveBeenCalledWith({
        operation: "restore",
        recipeId: "recipe-2",
        recipeName: "Vanilla candle",
      }),
    );
    expect(mocks.reportLifecycle).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it("disables the button and shows pending copy while the action is in flight", async () => {
    const user = userEvent.setup();
    let resolveAction!: (value: unknown) => void;
    mocks.archiveRecipeAction.mockImplementation(
      () => new Promise((resolve) => (resolveAction = resolve)),
    );
    const confirmSpy = mockConfirm(true);
    render(<RecipeArchiveControl recipe={ACTIVE} />);
    await user.click(screen.getByRole("button", { name: "Archive Vanilla candle" }));
    expect(await screen.findByRole("button", { name: "Archiving Vanilla candle…" })).toBeDisabled();
    resolveAction({ status: "success", recipeId: "recipe-2" });
    await waitFor(() => expect(mocks.archiveRecipeAction).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });

  it.each([
    [
      "archive",
      ACTIVE,
      "Archive Vanilla candle",
      mocks.archiveRecipeAction,
      "Recipe could not be found.",
    ],
    [
      "restore",
      ARCHIVED,
      "Restore Citrus candle",
      mocks.restoreRecipeAction,
      "Unable to restore recipe.",
    ],
  ])("surfaces a server error returned by the %s action", async (_op, recipe, btn, fn, message) => {
    const user = userEvent.setup();
    const confirmSpy = mockConfirm(true);
    fn.mockResolvedValue({ status: "error", message });
    render(<RecipeArchiveControl recipe={recipe} />);
    await user.click(screen.getByRole("button", { name: btn }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    confirmSpy.mockRestore();
  });
});
