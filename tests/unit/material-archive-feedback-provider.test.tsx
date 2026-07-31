import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, it } from "vitest";
import {
  MaterialsArchiveFeedback,
  useMaterialArchiveFeedback,
} from "../../src/app/materials/MaterialsArchiveFeedback";
import type { MaterialLifecycleResult } from "../../src/app/materials/materialLifecycle";

function ChildReporter({ archived }: { archived: boolean }) {
  const { reportLifecycle } = useMaterialArchiveFeedback();
  // Report once on mount to drive deterministic provider state.
  useEffect(() => {
    const result: MaterialLifecycleResult = {
      operation: archived ? "restore" : "archive",
      materialName: archived ? "Soy wax" : "Coconut wax",
    };
    reportLifecycle(result);
  }, [archived, reportLifecycle]);
  return <button data-testid="child">child</button>;
}

function FocusMarker({ showArchived = false }: { showArchived?: boolean }) {
  if (showArchived) {
    return (
      <a href="/materials?view=all" data-archive-focus="show-archived">
        Mostrar archivados
      </a>
    );
  }
  return (
    <button type="button" data-archive-focus="next-row">
      Next row archive
    </button>
  );
}

describe("MaterialsArchiveFeedback provider", () => {
  it("renders a persistent role=status announcement built from the captured operation", async () => {
    render(
      <MaterialsArchiveFeedback view="active" hasRemainingRows>
        <ChildReporter archived={false} />
      </MaterialsArchiveFeedback>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Coconut wax archivado.");
  });

  it("uses the restore copy when the captured operation is restore", async () => {
    render(
      <MaterialsArchiveFeedback view="all" hasRemainingRows>
        <ChildReporter archived={true} />
      </MaterialsArchiveFeedback>,
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Soy wax restaurado.");
  });

  it("survives a child unmount so the status is not lost when the archived row is removed", async () => {
    function Harness() {
      const [hasChild, setHasChild] = useState(true);
      return (
        <MaterialsArchiveFeedback view="active" hasRemainingRows={false}>
          {hasChild ? <ChildReporter archived={false} /> : null}
          <button data-testid="drop-child" type="button" onClick={() => setHasChild(false)}>
            drop
          </button>
        </MaterialsArchiveFeedback>
      );
    }

    render(<Harness />);
    expect(await screen.findByRole("status")).toHaveTextContent("Coconut wax archivado.");

    await act(async () => {
      screen.getByTestId("drop-child").click();
    });

    expect(screen.getByRole("status")).toHaveTextContent("Coconut wax archivado.");
  });

  it("moves focus to the next archive row after a successful archive in active view with remaining rows", async () => {
    render(
      <MaterialsArchiveFeedback view="active" hasRemainingRows>
        <ChildReporter archived={false} />
        <FocusMarker />
      </MaterialsArchiveFeedback>,
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Coconut wax archivado."),
    );
    await waitFor(() =>
      expect(screen.getByTestId("child").ownerDocument.activeElement).toBe(
        screen.getByRole("button", { name: "Next row archive" }),
      ),
    );
  });

  it("moves focus to the Mostrar archivados link after a successful archive in active view with no remaining rows", async () => {
    render(
      <MaterialsArchiveFeedback view="active" hasRemainingRows={false}>
        <ChildReporter archived={false} />
        <FocusMarker showArchived />
      </MaterialsArchiveFeedback>,
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Coconut wax archivado."),
    );
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Mostrar archivados" })).toHaveFocus(),
    );
  });

  it("does not move focus on restore in the all view (the row stays mounted)", async () => {
    render(
      <MaterialsArchiveFeedback view="all" hasRemainingRows>
        <ChildReporter archived={true} />
        <FocusMarker />
      </MaterialsArchiveFeedback>,
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Soy wax restaurado."),
    );
    // The status is announced but focus is not moved.
    expect(screen.getByRole("button", { name: "Next row archive" })).not.toHaveFocus();
  });
});
