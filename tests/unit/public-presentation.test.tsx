import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/ownerEnv", () => ({
  getNeonAuthBaseUrl: () => "https://auth.example.test",
  getOwnerId: () => "owner-1",
  getOwnerEmail: () => "owner@example.com",
}));
vi.mock("@/server/auth/session", () => ({
  NEON_SESSION_COOKIE_NAMES: ["better-auth.session_token"],
  setSessionCookie: vi.fn(),
}));
vi.mock("@/server/repositories/owner", () => ({ upsertOwner: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import ForbiddenPage from "@/app/403/page";
import SignInPage from "@/app/sign-in/page";

describe("/sign-in public presentation (U3)", () => {
  it("does not nest a <main> element so the root layout keeps a single skip-link target", () => {
    const view = render(<SignInPage />);
    expect(view.container.querySelector("main")).toBeNull();
  });

  it("renders the Spanish heading and the brand identity mark", () => {
    render(<SignInPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /iniciar sesi(?:ó|o)n/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/calculadora flor/i)).toBeInTheDocument();
  });

  it("preserves the sign-in form field contract (names, types, autocomplete, required)", () => {
    render(<SignInPage />);
    const email = screen.getByLabelText(/^email$/i);
    expect(email).toHaveAttribute("name", "email");
    expect(email).toHaveAttribute("type", "email");
    expect(email).toBeRequired();
    expect(email).toHaveAttribute("autocomplete", "email");
    const password = screen.getByLabelText(/contrase(?:ñ|&)a/i);
    expect(password).toHaveAttribute("name", "password");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toBeRequired();
    expect(password).toHaveAttribute("autocomplete", "current-password");
  });

  it("renders a translated Spanish submit button bound to the sign-in form", () => {
    render(<SignInPage />);
    const submit = screen.getByRole("button", { name: /iniciar sesi(?:ó|o)n/i });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).not.toHaveAttribute("disabled");
  });

  it("keeps the public page free of the authenticated nav and sign-out/settings entries", () => {
    const view = render(<SignInPage />);
    expect(view.container.querySelector("nav")).toBeNull();
    expect(
      screen.queryByRole("link", {
        name: /^(inicio|materiales|recetas|cotizaciones)$/i,
      }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /cerrar sesi(?:ó|o)n/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /configuraci(?:ó|o)n/i })).toBeNull();
  });

  it("uses rosa-crema semantic tokens only (no raw zinc/red/rose/amber utilities)", () => {
    const view = render(<SignInPage />);
    const html = view.container.innerHTML;
    expect(html).toMatch(/\bbg-brand\b/);
    expect(html).toMatch(/\btext-on-brand\b/);
    expect(html).toMatch(/\bborder-border-subtle\b/);
    for (const forbidden of [
      "bg-zinc-",
      "text-zinc-",
      "text-red-",
      "bg-red-",
      "bg-rose-",
      "text-rose-",
      "bg-pink-",
      "text-pink-",
      "bg-amber-",
      "text-amber-",
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

describe("/403 forbidden public presentation (U3)", () => {
  it("does not nest a <main> element so the root layout keeps a single skip-link target", () => {
    const view = render(<ForbiddenPage />);
    expect(view.container.querySelector("main")).toBeNull();
  });

  it("renders the Spanish forbidden heading and the brand identity mark", () => {
    render(<ForbiddenPage />);
    expect(screen.getByRole("heading", { level: 1, name: /acceso denegado/i })).toBeInTheDocument();
    expect(screen.getByText(/calculadora flor/i)).toBeInTheDocument();
  });

  it("preserves forbidden semantics with a Spanish link back to /sign-in", () => {
    render(<ForbiddenPage />);
    const link = screen.getByRole("link", { name: /(volver a )?iniciar sesi(?:ó|o)n/i });
    expect(link).toHaveAttribute("href", "/sign-in");
  });

  it("keeps the forbidden page free of the authenticated nav and sign-out/settings entries", () => {
    const view = render(<ForbiddenPage />);
    expect(view.container.querySelector("nav")).toBeNull();
    expect(
      screen.queryByRole("link", {
        name: /^(inicio|materiales|recetas|cotizaciones)$/i,
      }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /cerrar sesi(?:ó|o)n/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /configuraci(?:ó|o)n/i })).toBeNull();
  });

  it("uses rosa-crema semantic tokens only (no raw zinc/red/rose/amber utilities)", () => {
    const view = render(<ForbiddenPage />);
    const html = view.container.innerHTML;
    expect(html).toMatch(/\bbg-brand\b/);
    expect(html).toMatch(/\btext-on-brand\b/);
    expect(html).not.toContain("bg-zinc-");
    expect(html).not.toContain("text-zinc-");
    expect(html).not.toContain("text-red-");
    expect(html).not.toContain("bg-rose-");
    expect(html).not.toContain("bg-pink-");
    expect(html).not.toContain("bg-amber-");
  });
});
