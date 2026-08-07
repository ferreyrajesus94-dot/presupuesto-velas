import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tutorial, TOUR_STORAGE_KEY } from "../../src/components/tour/Tutorial";

function setTourDone(value: "1" | null): void {
  if (typeof window === "undefined") return;
  const ls = window.localStorage;
  if (!ls) return;
  if (value === null) ls.removeItem(TOUR_STORAGE_KEY);
  else ls.setItem(TOUR_STORAGE_KEY, value);
}

function setMatchMedia(reduced: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("reduce"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
});

describe("Tutorial overlay (Phase 4.1)", () => {
  beforeEach(() => {
    setMatchMedia(false);
  });

  it("auto-starts on first visit (no pv-tour-done)", async () => {
    setTourDone(null);
    render(<Tutorial />);
    expect(await screen.findByTestId("tour-root")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Bienvenida/ })).toBeInTheDocument();
  });

  it("does not auto-start when pv-tour-done is already set", async () => {
    setTourDone("1");
    render(<Tutorial />);
    // Trigger button is still rendered for manual re-launch.
    expect(screen.getByTestId("tour-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("Siguiente advances to the next step and the final step says ¡Listo!", async () => {
    const user = userEvent.setup();
    setTourDone(null);
    render(<Tutorial />);
    await screen.findByTestId("tour-root");
    // Click through to the last step.
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByTestId("tour-next"));
    }
    expect(screen.getByTestId("tour-next")).toHaveTextContent("¡Listo! 🎉");
  });

  it("¡Listo! closes the tour and persists pv-tour-done", async () => {
    const user = userEvent.setup();
    setTourDone(null);
    render(<Tutorial />);
    await screen.findByTestId("tour-root");
    // 4 advances to reach the final step.
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByTestId("tour-next"));
    }
    await user.click(screen.getByTestId("tour-next"));
    await waitFor(() => expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("1"));
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("Saltar tour closes the tour and persists pv-tour-done", async () => {
    const user = userEvent.setup();
    setTourDone(null);
    render(<Tutorial />);
    await screen.findByTestId("tour-root");
    await user.click(screen.getByRole("button", { name: "Saltar tour" }));
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("1");
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("Escape closes the tour and persists pv-tour-done", async () => {
    const user = userEvent.setup();
    setTourDone(null);
    render(<Tutorial />);
    await screen.findByTestId("tour-root");
    await user.keyboard("{Escape}");
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("1");
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("manual trigger reopens the tour after completion", async () => {
    const user = userEvent.setup();
    setTourDone("1");
    render(<Tutorial />);
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("tour-trigger"));
    expect(screen.getByTestId("tour-root")).toBeInTheDocument();
  });

  it("traps Tab focus inside the dialog while it is open", async () => {
    const user = userEvent.setup();
    setTourDone(null);
    render(<Tutorial />);
    const dialog = await screen.findByRole("dialog", { name: /Bienvenida/ });
    const nextButton = within(dialog).getByTestId("tour-next");
    const closeButton = within(dialog).getByRole("button", { name: "Cerrar tour" });

    // The last focusable is the Siguiente button on the first step; Tab
    // should wrap back to the close button (the first focusable in DOM
    // order) instead of escaping into the page below.
    nextButton.focus();
    await user.tab();
    expect(document.activeElement).toBe(closeButton);

    // Shift+Tab from the close button should wrap to the last focusable.
    closeButton.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(nextButton);
  });
});
