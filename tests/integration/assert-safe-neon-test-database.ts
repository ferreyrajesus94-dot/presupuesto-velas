import { execFileSync } from "node:child_process";

// The safe branch name can be overridden by the NEON_INTEGRATION_REQUIRED_BRANCH_NAME
// environment variable for isolated test runs (for example, a temporary branch cloned
// from the canonical integration parent). When the env var is unset, empty, or
// whitespace-only, the canonical parent name remains the required target so the
// production-style integration suite still proves it cannot accidentally run against
// production or default branches.
const REQUIRED_BRANCH_NAME =
  process.env.NEON_INTEGRATION_REQUIRED_BRANCH_NAME?.trim() || "dev-pr2-auth-schema";
const SAFETY_ERROR = "Integration database safety check failed: target branch could not be proven";

type NeonBranch = {
  id: string;
  project_id: string;
  name: string;
  default: boolean;
  primary: boolean;
};

type NeonEndpoint = {
  branch_id: string;
  project_id: string;
  host: string;
  hosts?: Record<string, string>;
};

function runNeonJson(args: string[]): unknown {
  const output = execFileSync("npx", ["--yes", "neon@latest", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output) as unknown;
}

function endpointIdentity(host: string): string {
  const labels = host.toLowerCase().split(".");
  if (labels[0].endsWith("-pooler")) labels[0] = labels[0].slice(0, -"-pooler".length);
  return labels.join(".");
}

function isBranch(value: unknown): value is NeonBranch {
  if (!value || typeof value !== "object") return false;
  const branch = value as Record<string, unknown>;
  return (
    typeof branch.id === "string" &&
    typeof branch.project_id === "string" &&
    typeof branch.name === "string" &&
    typeof branch.default === "boolean" &&
    typeof branch.primary === "boolean"
  );
}

function isEndpoint(value: unknown): value is NeonEndpoint {
  if (!value || typeof value !== "object") return false;
  const endpoint = value as Record<string, unknown>;
  return (
    typeof endpoint.branch_id === "string" &&
    typeof endpoint.project_id === "string" &&
    typeof endpoint.host === "string" &&
    (endpoint.hosts === undefined ||
      (typeof endpoint.hosts === "object" &&
        endpoint.hosts !== null &&
        Object.values(endpoint.hosts).every((host) => typeof host === "string")))
  );
}

export function assertSafeNeonTestDatabase(databaseUrl = process.env.DATABASE_URL): void {
  try {
    if (!databaseUrl) throw new Error(SAFETY_ERROR);
    const configuredEndpoint = endpointIdentity(new URL(databaseUrl).hostname);
    const branches = runNeonJson(["branches", "list", "--output", "json"]);
    if (!Array.isArray(branches)) throw new Error(SAFETY_ERROR);
    const target = branches.find(
      (branch): branch is NeonBranch => isBranch(branch) && branch.name === REQUIRED_BRANCH_NAME,
    );
    if (!target || target.default || target.primary) throw new Error(SAFETY_ERROR);

    const response = runNeonJson(["api", `/projects/${target.project_id}/endpoints`]);
    const endpoints = Array.isArray(response)
      ? response
      : response && typeof response === "object" && "endpoints" in response
        ? (response as { endpoints: unknown }).endpoints
        : null;
    if (!Array.isArray(endpoints)) throw new Error(SAFETY_ERROR);
    const matchesTarget = endpoints.some((value) => {
      if (!isEndpoint(value)) return false;
      if (value.branch_id !== target.id || value.project_id !== target.project_id) return false;
      return [value.host, ...Object.values(value.hosts ?? {})].some(
        (host) => endpointIdentity(host) === configuredEndpoint,
      );
    });
    if (!matchesTarget) throw new Error(SAFETY_ERROR);
  } catch {
    throw new Error(SAFETY_ERROR);
  }
}
