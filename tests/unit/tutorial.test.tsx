import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Tutorial, TOUR_DISABLED_KEY, TOUR_STORAGE_KEY } from "../../src/components/tour/Tutorial";

// Mock `next/navigation` so `usePathname()` returns a non-public path. The
// Tour component gates its trigger + dialog on `!isPublicPath(pathname)`;
// without a mock, jsdom leaves pathname undefined and the test would
// surprise-mount the gating rather than the dialog.
vi.mock("next/navigation", () => ({
  usePathname: (): string => "/materials",
}));

// Seed the opt-out preference. Passing `null` clears the key (first-time
// visitor), `"1"` simulates a user who already disabled the tour.
function setTourDisabled(value: "1" | null): void {
  if (typeof window === "undefined") return;
  const ls = window.localStorage;
  if (!ls) return;
  if (value === null) ls.removeItem(TOUR_DISABLED_KEY);
  else ls.setItem(TOUR_DISABLED_KEY, value);
}

// Seed the legacy one-shot key for migration coverage.
function setLegacyTourDone(value: "1" | null): void {
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

  it("auto-starts on first visit (no opt-out flag)", async () => {
    setTourDisabled(null);
    render(<Tutorial />);
    expect(await screen.findByTestId("tour-root")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /Bienvenida/ })).toBeInTheDocument();
  });

  it("does not auto-start when pv-tour-disabled is already set", async () => {
    setTourDisabled("1");
    render(<Tutorial />);
    // Trigger button is still rendered for manual re-launch.
    expect(screen.getByTestId("tour-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("honors the legacy one-shot pv-tour-done key on read", async () => {
    setLegacyTourDone("1");
    render(<Tutorial />);
    // Users who completed the old one-shot tour should keep their
    // opt-in to the new toggle's default-ON behavior — i.e. the legacy
    // key is treated as "do not auto-show" until the user re-enables.
    expect(screen.getByTestId("tour-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("renders the 'Mostrar este tour al iniciar sesión' checkbox, tildado por default", async () => {
    setTourDisabled(null);
    render(<Tutorial />);
    await screen.findByTestId("tour-root");
    const checkbox = screen.getByTestId("tour-auto-show") as HTMLInputElement;
    expect(checkbox).toBeInTheDocument();
    expect(checkbox.checked).toBe(true);
  });

  it("Siguiente advances to the next step and the final step says ¡Listo!", async () => {
    const user = userEvent.setup();
    setTourDisabled(null);
    render(<Tutorial />);
    await screen.findByTestId("tour-root");
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByTestId("tour-next"));
    }
    expect(screen.getByTestId("tour-next")).toHaveTextContent("¡Listo! 🎉");
  });

  it("¡Listo! with the toggle ON clears any opt-out key and removes pv-tour-disabled", async () => {
    const user = userEvent.setup();
    setTourDisabled(null);
    // Seed the legacy key — closing with the toggle ON should clear it
    // (so a returning user is no longer treated as opted-out).
    setLegacyTourDone("1");
    render(<Tutorial />);
    // The legacy key suppresses auto-show, so open the tour manually.
    await user.click(screen.getByTestId("tour-trigger"));
    await screen.findByTestId("tour-root");
    // The toggle is ON by default for manual opens.
    expect(screen.getByTestId("tour-auto-show")).toBeChecked();
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByTestId("tour-next"));
    }
    await user.click(screen.getByTestId("tour-next"));
    await waitFor(() =>
      expect(window.localStorage.getItem(TOUR_DISABLED_KEY)).toBeNull(),
    );
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("¡Listo! with the toggle OFF persists pv-tour-disabled = '1'", async () => {
    const user = userEvent.setup();
    setTourDisabled(null);
    render(<Tutorial />);
    await screen.findByTestId("tour-root");
    // Uncheck the toggle so the user opts out.
    await user.click(screen.getByTestId("tour-auto-show"));
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByTestId("tour-next"));
    }
    await user.click(screen.getByTestId("tour-next"));
    await waitFor(() =>
      expect(window.localStorage.getItem(TOUR_DISABLED_KEY)).toBe("1"),
    );
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("Saltar tour with the toggle ON does not persist pv-tour-disabled", async () => {
    const user = userEvent.setup();
    setTourDisabled("1");
    render(<Tutorial />);
    // The tour doesn't auto-open (legacy opt-out preserved), so click the
    // trigger to open manually. The toggle starts ON (optimistic default
    // for manual opens) so the test just verifies the resulting storage.
    await user.click(screen.getByTestId("tour-trigger"));
    await screen.findByTestId("tour-root");
    expect(screen.getByTestId("tour-auto-show")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Saltar tour" }));
    await waitFor(() =>
      expect(window.localStorage.getItem(TOUR_DISABLED_KEY)).toBeNull(),
    );
  });

  it("Saltar tour with the toggle OFF persists pv-tour-disabled = '1'", async () => {
    const user = userEvent.setup();
    setTourDisabled(null);
    render(<Tutorial />);
    await screen.findByTestId("tour-root");
    // Default is ON; the user unchecks before skipping.
    await user.click(screen.getByTestId("tour-auto-show"));
    await user.click(screen.getByRole("button", { name: "Saltar tour" }));
    expect(window.localStorage.getItem(TOUR_DISABLED_KEY)).toBe("1");
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
  });

  it("Escape with the toggle ON clears any opt-out key", async () => {
    const user = userEvent.setup();
    setTourDisabled("1");
    render(<Tutorial />);
    await user.click(screen.getByTestId("tour-trigger"));
    await screen.findByTestId("tour-root");
    // The toggle is ON by default when the user opens the tour manually.
    expect(screen.getByTestId("tour-auto-show")).toBeChecked();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(window.localStorage.getItem(TOUR_DISABLED_KEY)).toBeNull(),
    );
  });

  it("manual trigger reopens the tour even when the user opted out", async () => {
    const user = userEvent.setup();
    setTourDisabled("1");
    render(<Tutorial />);
    expect(screen.queryByTestId("tour-root")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("tour-trigger"));
    expect(screen.getByTestId("tour-root")).toBeInTheDocument();
  });

  it("traps Tab focus inside the dialog while it is open", async () => {
    const user = userEvent.setup();
    setTourDisabled(null);
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
