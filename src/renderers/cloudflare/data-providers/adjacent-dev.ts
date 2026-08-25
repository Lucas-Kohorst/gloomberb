import type { KeyedDataProvider, ProviderPlan, ProviderResolveContext } from "./types";

const ADJACENT_DEV_ORIGIN = "https://api.dev.adjacent.markets";
const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_:.-]*$/;
const PUBLIC_PREFIXES = ["filings"] as const;

function adjacentDevSecret(env: ProviderResolveContext["env"] | undefined): string | undefined {
  const value = (env as { ADJACENT_DEV_API_KEY?: string } | undefined)?.ADJACENT_DEV_API_KEY?.trim();
  return value || undefined;
}

/** Filings have a 90-day public twin; without a Worker key, fall back to it. */
function publicAdjacentDevPath(
  keyPath: string,
  env: ProviderResolveContext["env"] | undefined,
): string {
  if (adjacentDevSecret(env) || keyPath.startsWith("public/")) return keyPath;
  const head = keyPath.split("/")[0] ?? "";
  if ((PUBLIC_PREFIXES as readonly string[]).includes(head)) return `public/${keyPath}`;
  return keyPath;
}

export const adjacentDevProvider: KeyedDataProvider = {
  id: "adjacent-dev",
  name: "Adjacent Dev (CFTC)",
  ttlSeconds: 60,
  userAgent: "gloomberb-adjacent-dev",
  secret: {
    envKey: "ADJACENT_DEV_API_KEY",
    headerName: "Authorization",
    headerValue: (secret) => `Bearer ${secret}`,
  },
  resolve({ keyPath, search, env }): ProviderPlan {
    if (
      !keyPath
      || keyPath.includes("..")
      || keyPath.includes("//")
      || !PATH_RE.test(keyPath)
    ) {
      return { kind: "error", status: 400, error: "Invalid Adjacent Dev path" };
    }
    const upstreamPath = publicAdjacentDevPath(keyPath, env);
    const query = search.size ? `?${search.toString()}` : "";
    return {
      kind: "proxy",
      url: `${ADJACENT_DEV_ORIGIN}/api/v1/${upstreamPath}${query}`,
    };
  },
};
