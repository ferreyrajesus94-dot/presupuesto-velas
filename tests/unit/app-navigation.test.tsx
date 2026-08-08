import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mocks = { pathname: "/" };
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

import { AppNav } from "@/components/layout/AppNav";

describe("AppNav", () => {
  beforeEach(() => {
    mocks.pathname = "/";
  });

  it("renders exactly the four canonical Spanish links in order with exact hrefs", () => {
    render(<AppNav />);
    const links = screen.getAllByRole("link");
    const pairs = links.map((a) => [a.textContent, a.getAttribute("href")]);
    expect(pairs).toEqual([
      ["Inicio", "/"],
      ["Materiales", "/materials"],
      ["Plantillas", "/templates"],
      ["Cotizaciones", "/quotes"],
    ]);
  });

  it("marks the active section including nested routes with aria-current=page", () => {
    mocks.pathname = "/quotes/abc/edit";
    render(<AppNav />);
    const links = screen.getAllByRole("link");
    expect(links[3]).toHaveAttribute("aria-current", "page");
    expect(links[0]).not.toHaveAttribute("aria-current");
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
