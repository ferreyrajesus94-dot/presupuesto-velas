"use client";

/*
 * Theme foundation — ThemeProvider / useTheme / ThemeToggle
 * ---------------------------------------------------------------------------
 * Three-state cycle (light → dark → auto → light), persisted under the
 * `localStorage` key `pv-theme` only when the choice is NOT `auto`. The
 * anti-flash inline `<script>` in `app/layout.tsx` runs before paint to set
 * `document.documentElement.dataset.theme` from the same key, so first frame
 * already matches the user's saved preference.
 *
 * `useTheme()` is intentionally defensive: if the calling tree was rendered
 * without a `<ThemeProvider>` (e.g. a unit test that mounts `<AppNav />` in
 * isolation), it falls back to a no-op context that reads the current theme
 * directly from `localStorage` and `matchMedia`. This keeps tests and any
 * future isolated usages of `<ThemeToggle />` from crashing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  theme: Theme;
  resolved: ResolvedTheme;
  cycle: () => void;
  setTheme: (t: Theme) => void;
}

export const THEME_STORAGE_KEY = "pv-theme";
const THEME_ORDER: Theme[] = ["light", "dark", "auto"];

const FALLBACK_VALUE: ThemeContextValue = {
  theme: "auto",
  resolved: "light",
  cycle: () => undefined,
  setTheme: () => undefined,
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "auto";
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

function persistTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    if (theme === "auto") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // localStorage can be unavailable (private mode, locked-down browsers);
    // we keep the in-memory cycle and move on.
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "auto") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

function applyResolvedToDocument(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
}

function nextTheme(current: Theme): Theme {
  const idx = THEME_ORDER.indexOf(current);
  if (idx === -1) return "light";
  return THEME_ORDER[(idx + 1) % THEME_ORDER.length];
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("auto");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const initial = readStoredTheme();
    const r = resolveTheme(initial);
    setThemeState(initial);
    setResolved(r);
    applyResolvedToDocument(r);
  }, []);

  useEffect(() => {
    if (theme !== "auto" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolveTheme("auto");
      setResolved(r);
      applyResolvedToDocument(r);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const applyTheme = useCallback((next: Theme) => {
    const r = resolveTheme(next);
    setThemeState(next);
    setResolved(r);
    applyResolvedToDocument(r);
    persistTheme(next);
  }, []);

  const cycle = useCallback(() => {
    setThemeState((current) => {
      const next = nextTheme(current);
      const r = resolveTheme(next);
      setResolved(r);
      applyResolvedToDocument(r);
      persistTheme(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, cycle, setTheme: applyTheme }),
    [theme, resolved, cycle, applyTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  if (typeof window === "undefined") return FALLBACK_VALUE;
  const stored = readStoredTheme();
  return {
    theme: stored,
    resolved: resolveTheme(stored),
    cycle: () => undefined,
    setTheme: () => undefined,
  };
}

function ariaLabelFor(theme: Theme): string {
  switch (theme) {
    case "light":
      return "Cambiar a tema oscuro";
    case "dark":
      return "Cambiar a tema automático";
    case "auto":
      return "Cambiar a tema claro";
  }
}

export function ThemeToggle() {
  const { theme, resolved, cycle } = useTheme();
  const label = ariaLabelFor(theme);
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      data-theme-state={theme}
      data-theme-resolved={resolved}
      className="theme-toggle"
    >
      <span aria-hidden="true" className="theme-toggle__icon">
        {resolved === "dark" ? "🌙" : "☀️"}
      </span>
    </button>
  );
}
