import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  RecipesArchiveFeedback,
  useRecipeArchiveFeedback,
} from "../../src/app/recipes/RecipesArchiveFeedback";
import type { RecipeView } from "../../src/app/recipes/RecipeViewFilter";

function Reporter({ op, name }: { op: "archive" | "restore"; name: string }) {
  const { reportLifecycle } = useRecipeArchiveFeedback();
  return (
    <button onClick={() => reportLifecycle({ operation: op, recipeId: name, recipeName: name })}>
      {op} {name}
    </button>
  );
}

// PR3z.focus: reporters that mirror the real RecipeArchiveControl markers so
// the focus effect can find them by [data-archive-focus="next-row"] and
// filter the source by [data-archive-source]. The "restored" reporter uses
// the same markers but a restore op so the restore branch is exercised.
function FocusReporter({
  op,
  id,
  name,
  archived,
}: {
  op: "archive" | "restore";
  id: string;
  name: string;
  archived: boolean;
}) {
  const { reportLifecycle } = useRecipeArchiveFeedback();
  return (
    <button
      data-archive-focus={archived ? undefined : "next-row"}
      data-archive-source={id}
      onClick={() => reportLifecycle({ operation: op, recipeId: id, recipeName: name })}
    >
      {op} {name}
    </button>
  );
}

describe("RecipesArchiveFeedback", () => {
  it("keeps the announcement after the source row unmounts", async () => {
    const user = userEvent.setup();
    function Harness(): ReactNode {
      const [showRow, setShowRow] = useState(true);
      return (
        <RecipesArchiveFeedback view={"active" satisfies RecipeView}>
          {showRow ? <Reporter op="archive" name="Citrus candle" /> : null}
          <button onClick={() => setShowRow(false)}>Revalidate</button>
        </RecipesArchiveFeedback>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "archive Citrus candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Citrus candle archived.");
    await user.click(screen.getByRole("button", { name: "Revalidate" }));
    expect(screen.queryByRole("button", { name: "archive Citrus candle" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Citrus candle archived.");
  });

  it("replaces the previous announcement on a later operation", async () => {
    const user = userEvent.setup();
    render(
      <RecipesArchiveFeedback view={"active" satisfies RecipeView}>
        <Reporter op="archive" name="Citrus candle" />
        <Reporter op="restore" name="Vanilla candle" />
      </RecipesArchiveFeedback>,
    );
    await user.click(screen.getByRole("button", { name: "archive Citrus candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Citrus candle archived.");
    await user.click(screen.getByRole("button", { name: "restore Vanilla candle" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Vanilla candle restored."),
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("Citrus candle archived.");
  });
});

// PR3z.focus: deterministic focus management after a successful lifecycle
// operation. The provider must move focus to a stable, predictable destination
// so keyboard and screen-reader users do not lose their place across the
// revalidation transition. Active view archive has two valid destinations
// (next-row / show-archived) and one hard rule (never focus the source
// button that is about to unmount). The all view and the restore operation
// must leave focus untouched — restore keeps the row mounted, so moving
// focus would be jarring.
describe("RecipesArchiveFeedback focus", () => {
  function ShowArchived() {
    // Mirrors the pre-slice data-archive-focus="show-archived" seam that
    // already lives in RecipesList and RecipeViewFilter.
    return (
      <a href="/recipes?view=all" data-archive-focus="show-archived">
        Show archived
      </a>
    );
  }

  it("moves focus to the next row's archive button when one of two active rows is archived", async () => {
    // Active view, two reporters, archive the first. The source button is
    // still in the DOM (it unmounts only when the parent re-renders), so the
    // effect must filter the source by data-archive-source and land focus
    // on the surviving sibling — never the source itself.
    const user = userEvent.setup();
    render(
      <RecipesArchiveFeedback view={"active" satisfies RecipeView}>
        <FocusReporter op="archive" id="recipe-citrus" name="Citrus candle" archived={false} />
        <FocusReporter op="archive" id="recipe-vanilla" name="Vanilla candle" archived={false} />
      </RecipesArchiveFeedback>,
    );
    await user.click(screen.getByRole("button", { name: "archive Citrus candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Citrus candle archived.");
    const surviving = screen.getByRole("button", { name: "archive Vanilla candle" });
    await waitFor(() => expect(surviving).toHaveFocus());
    // The source button must never receive focus — it is the one that
    // unmounts on the post-revalidation render.
    const source = screen.getByRole("button", { name: "archive Citrus candle" });
    expect(source).not.toHaveFocus();
  });

  it("moves focus to the first surviving row when the middle of three active rows is archived", async () => {
    // Triangulation: with three rows, archiving the middle one must land
    // focus on the first DOM-sorted surviving button (the one rendered
    // BEFORE the source), not on the row that comes after. This pins down
    // the "first surviving" deterministic behavior — the `find` over
    // [data-archive-focus="next-row"] returns the first match in DOM
    // order, which is the row that occupies the source's prior position.
    const user = userEvent.setup();
    render(
      <RecipesArchiveFeedback view={"active" satisfies RecipeView}>
        <FocusReporter op="archive" id="recipe-citrus" name="Citrus candle" archived={false} />
        <FocusReporter op="archive" id="recipe-vanilla" name="Vanilla candle" archived={false} />
        <FocusReporter op="archive" id="recipe-cinnamon" name="Cinnamon candle" archived={false} />
      </RecipesArchiveFeedback>,
    );
    await user.click(screen.getByRole("button", { name: "archive Vanilla candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Vanilla candle archived.");
    const first = screen.getByRole("button", { name: "archive Citrus candle" });
    await waitFor(() => expect(first).toHaveFocus());
    const source = screen.getByRole("button", { name: "archive Vanilla candle" });
    expect(source).not.toHaveFocus();
  });

  it("moves focus to the Show archived affordance when the last active row is archived", async () => {
    // Active view, single reporter: after archive the only row unmounts, the
    // next-row destination does not exist, so the effect must fall back to
    // the pre-slice data-archive-focus="show-archived" seam. Without the
    // fallback, focus would land on body and keyboard users would lose
    // context.
    const user = userEvent.setup();
    render(
      <RecipesArchiveFeedback view={"active" satisfies RecipeView}>
        <FocusReporter op="archive" id="recipe-citrus" name="Citrus candle" archived={false} />
        <ShowArchived />
      </RecipesArchiveFeedback>,
    );
    await user.click(screen.getByRole("button", { name: "archive Citrus candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Citrus candle archived.");
    const showArchived = screen.getByRole("link", { name: "Show archived" });
    await waitFor(() => expect(showArchived).toHaveFocus());
  });

  it("leaves focus untouched when a row is restored in the all view", async () => {
    // Triangulation: restore keeps the row mounted, so the effect must
    // early-return on operation !== "archive". Moving focus to "Show
    // archived" after a restore would be wrong both semantically (the
    // restored row is now active) and ergonomically (the user just acted
    // on it). Same applies to the all view: the focus gate is
    // view === "active".
    const user = userEvent.setup();
    render(
      <RecipesArchiveFeedback view={"all" satisfies RecipeView}>
        <FocusReporter op="restore" id="recipe-citrus" name="Citrus candle" archived={true} />
        <ShowArchived />
      </RecipesArchiveFeedback>,
    );
    await user.click(screen.getByRole("button", { name: "restore Citrus candle" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Citrus candle restored.");
    // Focus must NOT be on a "Show archived" affordance — the focus effect
    // early-returns on restore AND on view !== "active".
    const showArchived = screen.getByRole("link", { name: "Show archived" });
    expect(showArchived).not.toHaveFocus();
  });
});
