import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "../../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
  scripts?: Record<string, string>;
};

describe("e2e setup contract", () => {
  it("exposes e2e:install script that runs playwright install for chromium", () => {
    const scripts = pkg.scripts ?? {};
    const script = scripts["e2e:install"];

    expect(script).toBeDefined();
    expect(script).toContain("playwright");
    expect(script).toContain("install");
    expect(script).toContain("chromium");
  });
});
