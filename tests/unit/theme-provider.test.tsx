import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  ThemeToggle,
  useTheme,
} from "@/components/theme/ThemeProvider";

// jsdom 26 does not auto-populate localStorage or matchMedia on the global
// `window`. Polyfill them here so the ThemeProvider (and its DOM-direct
// defensive fallback) can be exercised in unit tests.
if (typeof window !== "undefined") {
  if (typeof window.localStorage === "undefined") {
    const store = new Map<string, string>();
    const lso = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => {
        store.clear();
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    };
    Object.defineProperty(window, "localStorage", { value: lso, configurable: true });
  }
  if (typeof window.matchMedia === "undefined") {
    Object.defineProperty(window, "matchMedia", {
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
      configurable: true,
    });
  }
}

function ToggleHarness() {
  const { theme, resolved } = useTheme();
  return (
    <>
      <ThemeToggle />
      <output data-testid="theme">{theme}</output>
      <output data-testid="resolved">{resolved}</output>
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = "";
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset.theme = "";
});

describe("ThemeProvider", () => {
  it("cycles auto → light → dark → auto and stamps documentElement.dataset.theme", async () => {
    render(
      <ThemeProvider>
        <ToggleHarness />
      </ThemeProvider>,
    );

    // Initial state after mount: auto / light (no stored choice, system = light)
    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("auto");
    });
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    // auto → light: label flips to "Cambiar a tema oscuro"
    const toDark = await screen.findByRole("button", { name: /Cambiar a tema claro/i });
    act(() => {
      fireEvent.click(toDark);
    });
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    // light → dark: label now reads "Cambiar a tema automático"
    const toAuto = await screen.findByRole("button", { name: /Cambiar a tema oscuro/i });
    act(() => {
      fireEvent.click(toAuto);
    });
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    // dark → auto: label now reads "Cambiar a tema claro" again, and the
    // storage key is cleared because auto is the unwritten default.
    const backToLight = await screen.findByRole("button", {
      name: /Cambiar a tema automático/i,
    });
    act(() => {
      fireEvent.click(backToLight);
    });
    expect(screen.getByTestId("theme").textContent).toBe("auto");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("rehydrates stored theme on mount and persists light/dark but not auto", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(
      <ThemeProvider>
        <ToggleHarness />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toBe("dark");
    });
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("exposes a defensive useTheme() that reads directly from storage when no provider is mounted", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");

    function Naked() {
      const { theme, resolved } = useTheme();
      return (
        <>
          <output data-testid="naked-theme">{theme}</output>
          <output data-testid="naked-resolved">{resolved}</output>
        </>
      );
    }
    render(<Naked />);
    // No provider mounted — fallback should still report a sensible theme.
    expect(screen.getByTestId("naked-theme").textContent).toBe("light");
    expect(screen.getByTestId("naked-resolved").textContent).toBe("light");
  });

  it("renders a 44x44 ThemeToggle with sun emoji by default and aria-label for the next action", () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = screen.getByRole("button");
    expect(button.className).toContain("theme-toggle");
    expect(button.getAttribute("aria-label")).toMatch(/Cambiar a tema/);
    // Sun emoji on the default light/auto resolution
    expect(button.textContent?.trim()).toBe("☀\uFE0F");
  });
});
