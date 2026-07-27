import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  RecipesArchiveFeedback,
  useRecipeArchiveFeedback,
} from "../../src/app/recipes/RecipesArchiveFeedback";

function Reporter({ op, name }: { op: "archive" | "restore"; name: string }) {
  const { reportLifecycle } = useRecipeArchiveFeedback();
  return (
    <button onClick={() => reportLifecycle({ operation: op, recipeId: name, recipeName: name })}>
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
        <RecipesArchiveFeedback>
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
      <RecipesArchiveFeedback>
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
