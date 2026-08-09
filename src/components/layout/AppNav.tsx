"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import { ThemeToggle } from "@/components/theme/ThemeProvider";
import { signOutAction, type SignOutState } from "@/server/actions/signOut";

const NAV_ITEMS = [
  { href: "/", label: "Inicio" },
  { href: "/materials", label: "Materiales" },
  { href: "/templates", label: "Plantillas" },
  { href: "/quotes", label: "Presupuestos" },
];

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
    <nav aria-label="Navegación principal" className="border-b border-border-subtle bg-surface">
      <ul className="mx-auto flex max-w-5xl items-center gap-2 overflow-x-auto px-4 py-2">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const cls = active
              ? "inline-flex min-h-11 items-center rounded-md bg-brand px-3 text-on-brand"
              : "inline-flex min-h-11 items-center rounded-md px-3 text-ink hover:bg-surface-soft";
          const tourTarget = navTourTarget(item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cls}
                data-tour-target={tourTarget}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
        <li className="ml-auto flex shrink-0 items-center gap-2">
          <Link
            href="/settings"
            aria-current={pathname === "/settings" ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-md px-3 text-ink hover:bg-surface-soft"
            data-tour-target="settings"
          >
            Configuración
          </Link>
          <form action={signOutFormAction} aria-busy={signOutPending}>
            <button
              type="submit"
              disabled={signOutPending}
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
  );
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
