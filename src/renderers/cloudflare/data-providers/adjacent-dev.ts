import type { KeyedDataProvider, ProviderPlan, ProviderResolveContext } from "./types";

const ADJACENT_DEV_ORIGIN = "https://api.dev.adjacent.markets";
const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_:.-]*$/;

function adjacentDevSecret(env: ProviderResolveContext["env"] | undefined): string | undefined {
  const value = (env as { ADJACENT_DEV_API_KEY?: string } | undefined)?.ADJACENT_DEV_API_KEY?.trim();
  return value || undefined;
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
    const query = search.size ? `?${search.toString()}` : "";
    return {
      kind: "proxy",
      url: `${ADJACENT_DEV_ORIGIN}/${keyPath}${query}`,
    };
  },
};
