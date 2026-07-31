import "server-only";

const LOCAL_APP_BASE_URL = "http://localhost:3000";

export function getAppBaseUrl(): string {
  const configuredUrl = process.env.APP_BASE_URL?.trim();
  if (!configuredUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("APP_BASE_URL is required in production");
    }
    return LOCAL_APP_BASE_URL;
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error("APP_BASE_URL must be a valid HTTP(S) URL");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("APP_BASE_URL must be a valid HTTP(S) URL");
  }

  return url.origin;
}
