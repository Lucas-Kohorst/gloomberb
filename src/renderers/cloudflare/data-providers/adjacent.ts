import type { KeyedDataProvider, ProviderPlan } from "./types";

const ADJACENT_ORIGIN = "https://api.adjacent.markets";
const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9/_:.-]*$/;

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
  resolve({ keyPath, search }): ProviderPlan {
    if (!keyPath || keyPath.includes("..") || !PATH_RE.test(keyPath)) {
      return { kind: "error", status: 400, error: "Invalid Adjacent path" };
    }
    const query = search.size ? `?${search.toString()}` : "";
    return {
      kind: "proxy",
      url: `${ADJACENT_ORIGIN}/api/v1/${keyPath}${query}`,
    };
  },
};
