import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function hex(role: string) {
  const match = css.match(new RegExp(`--pv-${role}:\\s*(#[0-9a-f]{3,6})`, "i"));
  return match?.[1];
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

describe("rosa crema visual tokens", () => {
  it("defines the approved semantic palette without automatic dark mode", () => {
    expect(hex("canvas")).toBe("#fff8f8");
    expect(hex("surface-raised")).toBe("#ffffff");
    expect(css).not.toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toContain("--color-brand: var(--pv-brand)");
  });

  it("keeps text and actions at AA contrast", () => {
    expect(contrast(hex("ink")!, hex("canvas")!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("on-brand")!, hex("brand")!)).toBeGreaterThanOrEqual(4.5);
  });

  it("provides visible focus and minimum touch-target support", () => {
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline:/);
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("min-width: 44px");
  });
});
