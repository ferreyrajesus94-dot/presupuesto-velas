import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mocks = { pathname: "/" };
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

import { AppNav } from "@/components/layout/AppNav";

describe("AppNav", () => {
  beforeEach(() => {
    mocks.pathname = "/";
  });

  it("renders the desktop top nav with the five canonical Spanish links in order (v0.4.4 added Configuración)", () => {
    render(<AppNav />);
    // The desktop top nav has `hidden md:block`; the mobile bottom nav
    // has `md:hidden`. In jsdom both are present in the DOM but only one
    // is visible at runtime. Scope to the top nav by querying the nav
    // whose label is "Navegación principal" AND whose container is the
    // `hidden md:block` element. Easiest path: take the nav that owns
    // a /settings anchor WITH the visible "Configuración" text label
    // (the bottom nav uses shortLabel "Config" + emoji).
    const topNav = document.querySelector("nav.hidden") as HTMLElement | null;
    expect(topNav).not.toBeNull();
    const links = Array.from(topNav!.querySelectorAll("a"));
    const pairs = links.map((a) => [
      a.getAttribute("aria-label") ?? a.textContent,
      a.getAttribute("href"),
    ]);
    expect(pairs).toEqual([
      ["Inicio", "/"],
      ["Materiales", "/materials"],
      ["Plantillas", "/templates"],
      ["Presupuestos", "/quotes"],
      ["Configuración", "/settings"],
    ]);
  });

  it("renders the mobile bottom nav with 5 icon items (4 main + settings)", () => {
    render(<AppNav />);
    // The bottom nav is the one with `fixed inset-x-0 bottom-0`.
    const bottomNav = document.querySelector("nav.fixed") as HTMLElement | null;
    expect(bottomNav).not.toBeNull();
    const links = Array.from(bottomNav!.querySelectorAll("a"));
    expect(links).toHaveLength(5);
    const items = links.map((a) => ({
      href: a.getAttribute("href"),
      label: a.getAttribute("aria-label"),
    }));
    expect(items).toEqual([
      { href: "/", label: "Inicio" },
      { href: "/materials", label: "Materiales" },
      { href: "/templates", label: "Plantillas" },
      { href: "/quotes", label: "Presupuestos" },
      { href: "/settings", label: "Configuración" },
    ]);
  });

  it("marks the active section including nested routes with aria-current=page", () => {
    mocks.pathname = "/quotes/abc/edit";
    render(<AppNav />);
    // Pick the link to /quotes from either nav — they should both
    // surface the active state because the nav component is rendered
    // for both.
    const links = screen.getAllByRole("link", { name: /presupuestos/i });
    for (const link of links) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });

  it("marks /settings as active when on the settings page", () => {
    mocks.pathname = "/settings";
    render(<AppNav />);
    const links = screen.getAllByRole("link");
    const settingsLink = links.find((a) => a.getAttribute("href") === "/settings");
    expect(settingsLink).toHaveAttribute("aria-current", "page");
  });

  it("renders a sign-out button with the localized label", () => {
    render(<AppNav />);
    const button = screen.getByRole("button", { name: /cerrar sesión/i });
    expect(button).toBeInTheDocument();
    expect(button.closest("form")).not.toBeNull();
  });

  it("renders no nav on /sign-in and /403", () => {
    for (const path of ["/sign-in", "/403"]) {
      mocks.pathname = path;
      const { container } = render(<AppNav />);
      expect(container.querySelector("nav")).toBeNull();
    }
  });

  it("renders no nav on /sign-up and /verify-email (auth pages)", () => {
    for (const path of ["/sign-up", "/verify-email", "/sign-up/extra", "/verify-email/something"]) {
      mocks.pathname = path;
      const { container } = render(<AppNav />);
      expect(container.querySelector("nav"), `nav should be hidden on ${path}`).toBeNull();
    }
  });
});
