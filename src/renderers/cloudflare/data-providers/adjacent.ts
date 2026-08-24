import type { KeyedDataProvider, ProviderPlan, ProviderResolveContext } from "./types";

const ADJACENT_ORIGIN = "https://api.adjacent.markets";
const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_:.-]*$/;
const PUBLIC_PREFIXES = ["markets", "indices", "rates", "events"] as const;

function adjacentSecret(env: ProviderResolveContext["env"] | undefined): string | undefined {
  const value = (env as { ADJACENT_API_KEY?: string } | undefined)?.ADJACENT_API_KEY?.trim();
  return value || undefined;
}

/** Auth list/detail paths have a delayed public twin; news and similar do not. */
function publicAdjacentPath(keyPath: string, env: ProviderResolveContext["env"] | undefined): string {
  if (adjacentSecret(env) || keyPath.startsWith("public/")) return keyPath;
  const head = keyPath.split("/")[0] ?? "";
  if ((PUBLIC_PREFIXES as readonly string[]).includes(head)) return `public/${keyPath}`;
  return keyPath;
}

export const adjacentProvider: KeyedDataProvider = {
  id: "adjacent",
  name: "Adjacent",
  ttlSeconds: 30,
  userAgent: "gloomberb-adjacent",
  secret: {
    envKey: "ADJACENT_API_KEY",
    headerName: "Authorization",
    headerValue: (secret) => `Bearer ${secret}`,
  },
  resolve({ keyPath, search, env }): ProviderPlan {
    // `PATH_RE` has to allow ":" for venue ids like `markets/kalshi:KXNBA-26`,
    // which also admits `http://evil.example`. Empty segments are never valid.
    if (
      !keyPath
      || keyPath.includes("..")
      || keyPath.includes("//")
      || !PATH_RE.test(keyPath)
    ) {
      return { kind: "error", status: 400, error: "Invalid Adjacent path" };
    }
    const upstreamPath = publicAdjacentPath(keyPath, env);
    const query = search.size ? `?${search.toString()}` : "";
    return {
      kind: "proxy",
      url: `${ADJACENT_ORIGIN}/api/v1/${upstreamPath}${query}`,
    };
  },
};
