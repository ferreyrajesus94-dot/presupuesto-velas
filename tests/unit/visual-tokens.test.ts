import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function hex(role: string) {
  const match = css.match(new RegExp(`--pv-${role}:\\s*(#[0-9a-f]{3,6})`, "i"));
  return match?.[1];
}

function hexInScope(role: string, scopeRegex: RegExp) {
  // Extract the first declaration of `--pv-<role>` that lives INSIDE the
  // matching block (e.g. `[data-theme="dark"]` or `:root:not([data-theme])`
  // under `prefers-color-scheme: dark`).
  const blocks = [...css.matchAll(scopeRegex)];
  for (const block of blocks) {
    const re = new RegExp(`--pv-${role}:\\s*(#[0-9a-f]{3,6})`, "i");
    const match = block[0].match(re);
    if (match) return match[1];
  }
  return undefined;
}

function luminance(value: string) {
  const channels = value
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("rosa paleta visual tokens (theme foundation)", () => {
  it("defines the light rosa paleta, dark override, and prefers-color-scheme auto", () => {
    // Light defaults
    expect(hex("canvas")).toBe("#fff7fa");
    expect(hex("brand")).toBe("#d6336c");
    expect(hex("surface-raised")).toBe("#ffffff");

    // Dark override block
    expect(hexInScope("canvas", /\[data-theme=["']dark["']\][^{]*\{[^}]*\}/g)).toBe("#1a0d14");
    expect(hexInScope("brand", /\[data-theme=["']dark["']\][^{]*\{[^}]*\}/g)).toBe("#ff7ba6");

    // Auto mode via prefers-color-scheme
    expect(css).toMatch(/@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);
    expect(
      hexInScope("canvas", /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{[\s\S]*?\}/g),
    ).toBe("#1a0d14");

    // Tailwind v4 bridge still wires brand → var(--pv-brand)
    expect(css).toContain("--color-brand: var(--pv-brand)");
  });

  it("keeps text and actions at AA contrast in both light and dark", () => {
    // Light
    expect(contrast(hex("ink")!, hex("canvas")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("on-brand")!, hex("brand")!)).toBeGreaterThanOrEqual(4.5);
    // Dark — pull from the [data-theme="dark"] block
    const darkCanvas = hexInScope("canvas", /\[data-theme=["']dark["']\][^{]*\{[^}]*\}/g)!;
    const darkInk = hexInScope("ink", /\[data-theme=["']dark["']\][^{]*\{[^}]*\}/g)!;
    const darkOnBrand = hexInScope("on-brand", /\[data-theme=["']dark["']\][^{]*\{[^}]*\}/g)!;
    const darkBrand = hexInScope("brand", /\[data-theme=["']dark["']\][^{]*\{[^}]*\}/g)!;
    expect(contrast(darkInk, darkCanvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkOnBrand, darkBrand)).toBeGreaterThanOrEqual(4.5);
  });

  it("animates only color-related properties and respects reduced motion", () => {
    // The body rule must declare a transition list restricted to color props.
    expect(css).toMatch(
      /body\s*\{[^}]*transition:[^}]*background-color[^}]*color[^}]*border-color[^}]*\}/,
    );
    // Reduced-motion media query collapses all transitions to 0ms.
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?transition-duration:\s*0ms[\s\S]*?\}/,
    );
  });

  it("provides visible focus and minimum touch-target support", () => {
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline:/);
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("min-width: 44px");
  });

  it("ships a 44x44 circular theme toggle with hover rotation and reduced-motion guard", () => {
    expect(css).toMatch(/\.theme-toggle\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*\}/);
    expect(css).toMatch(/\.theme-toggle\s*\{[^}]*border-radius:\s*9999px[^}]*\}/);
    expect(css).toMatch(
      /@media\s*\(\s*hover:\s*hover\s*\)\s*\{[^}]*\.theme-toggle:hover\s+\.theme-toggle__icon\s*\{[^}]*transform:\s*rotate\(20deg\)/,
    );
    expect(css).toMatch(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?\.theme-toggle:hover\s+\.theme-toggle__icon\s*\{[^}]*transform:\s*none/,
    );
  });
});
