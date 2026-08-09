import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mocks = { pathname: "/" };
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

import { AppNav } from "@/components/layout/AppNav";

describe("AppNav", () => {
  beforeEach(() => {
    mocks.pathname = "/";
  });

  it("renders the five canonical Spanish links in order with exact hrefs (v0.4.4 added Configuración)", () => {
    render(<AppNav />);
    const links = screen.getAllByRole("link");
    const pairs = links.map((a) => [a.textContent, a.getAttribute("href")]);
    expect(pairs).toEqual([
      ["Inicio", "/"],
      ["Materiales", "/materials"],
      ["Plantillas", "/templates"],
      ["Cotizaciones", "/quotes"],
      ["Configuración", "/settings"],
    ]);
  });

  it("marks the active section including nested routes with aria-current=page", () => {
    mocks.pathname = "/quotes/abc/edit";
    render(<AppNav />);
    const links = screen.getAllByRole("link");
    expect(links[3]).toHaveAttribute("aria-current", "page");
    expect(links[0]).not.toHaveAttribute("aria-current");
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
