import { afterEach, describe, expect, it, vi } from "vitest";
import { getAppBaseUrl } from "../../src/server/auth/appBaseUrl";

describe("getAppBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the safe localhost fallback in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_BASE_URL", "");

    expect(getAppBaseUrl()).toBe("http://localhost:3000");
  });

  it("normalizes the configured production URL to its origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "https://app.example.com/");

    expect(getAppBaseUrl()).toBe("https://app.example.com");
  });

  it("rejects a missing production URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "");

    expect(() => getAppBaseUrl()).toThrow("APP_BASE_URL is required in production");
  });

  it("rejects an invalid production URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_BASE_URL", "not-a-url");

    expect(() => getAppBaseUrl()).toThrow("APP_BASE_URL must be a valid HTTP(S) URL");
  });
});
