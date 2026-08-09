"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { signOutAction, type SignOutState } from "@/server/actions/signOut";

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: string;
};

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Inicio", shortLabel: "Inicio", icon: "🏠" },
  { href: "/materials", label: "Materiales", shortLabel: "Insumos", icon: "📦" },
  { href: "/templates", label: "Plantillas", shortLabel: "Plantillas", icon: "📋" },
  { href: "/quotes", label: "Presupuestos", shortLabel: "Presupuestos", icon: "💬" },
] as const;

const SETTINGS_ITEM: NavItem = {
  href: "/settings",
  label: "Configuración",
  shortLabel: "Config",
  icon: "⚙",
} as const;

const BOTTOM_NAV_ITEMS: readonly NavItem[] = [...NAV_ITEMS, SETTINGS_ITEM];

const HIDDEN_PREFIXES = ["/sign-in", "/sign-up", "/verify-email", "/403"];

const SIGN_OUT_INITIAL: SignOutState = {};

export function AppNav() {
  const pathname = usePathname() ?? "/";
  const hidden = HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const [signOutState, signOutFormAction, signOutPending] = useActionState(
    signOutAction,
    SIGN_OUT_INITIAL,
  );
  if (hidden) return null;
  return (
    <>
      {/*
       * Desktop top nav (≥md). Hides entirely on small screens — the
       * bottom nav takes over there. Sign-out + theme live on /settings
       * so the bottom bar stays at 5 items.
       */}
      <nav
        aria-label="Navegación principal"
        className="hidden border-b border-border-subtle bg-surface md:block"
      >
        <ul className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={navPill(active)}
                  data-tour-target={navTourTarget(item.href)}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li className="ml-auto flex shrink-0 items-center gap-2">
            <Link
              href={SETTINGS_ITEM.href}
              aria-current={pathname === "/settings" ? "page" : undefined}
              aria-label={SETTINGS_ITEM.label}
              data-tour-target="settings"
              className="inline-flex min-h-11 items-center rounded-md px-3 text-ink hover:bg-surface-soft"
            >
              {SETTINGS_ITEM.label}
            </Link>
            <form action={signOutFormAction} aria-busy={signOutPending}>
              <button
                type="submit"
                disabled={signOutPending}
                aria-label="Cerrar sesión"
                className="inline-flex min-h-11 items-center rounded-md px-3 text-ink hover:bg-surface-soft disabled:opacity-60"
              >
                {signOutPending ? "Cerrando…" : "Cerrar sesión"}
              </button>
            </form>
            {signOutState.errors?._form?.map((m) => (
              <p key={m} role="alert" className="ml-2 text-xs text-status-danger">
                {m}
              </p>
            ))}
            <ThemeToggle />
          </li>
        </ul>
      </nav>

      {/*
       * Mobile bottom nav (<md). Fixed to the viewport bottom, respects
       * the iOS safe-area inset, and stacks an emoji + tiny label per
       * item. `flex-1` on each <li> gives 5 equal columns.
       */}
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.04)] md:hidden"
      >
        <ul className="mx-auto grid max-w-5xl grid-cols-5">
          {BOTTOM_NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  data-tour-target={navTourTarget(item.href)}
                  className={
                    active
                      ? "flex min-h-12 flex-col items-center justify-center gap-0.5 text-xs font-semibold text-brand"
                      : "flex min-h-12 flex-col items-center justify-center gap-0.5 text-xs text-ink-muted hover:text-ink"
                  }
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    {item.icon}
                  </span>
                  <span className="leading-none">{item.shortLabel}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function navPill(active: boolean): string {
  return active
    ? "inline-flex min-h-11 items-center rounded-md bg-brand px-3 text-on-brand"
    : "inline-flex min-h-11 items-center rounded-md px-3 text-ink hover:bg-surface-soft";
}

function navTourTarget(href: string): string | undefined {
  switch (href) {
    case "/materials":
      return "materials";
    case "/templates":
      return "templates";
    case "/":
      return "config";
    case "/quotes":
      return "quotes";
    default:
      return undefined;
  }
}

// Re-export the theme toggle for the desktop top nav.
import { ThemeToggle } from "@/components/theme/ThemeProvider";
