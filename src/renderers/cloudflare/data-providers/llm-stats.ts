import type { KeyedDataProvider, ProviderPlan } from "./types";

const LLM_STATS_ORIGIN = "https://api.llm-stats.com";
const ALLOWED_PATHS = new Set(["v1/models", "v1/models/metrics"]);

export const llmStatsProvider: KeyedDataProvider = {
  id: "llm-stats",
  name: "llm-stats",
  ttlSeconds: 120,
  userAgent: "gloomberb-llm-stats",
  resolve({ keyPath, search }): ProviderPlan {
    if (!ALLOWED_PATHS.has(keyPath)) {
      return { kind: "error", status: 404, error: "Unknown llm-stats path" };
    }
    const query = search.size ? `?${search.toString()}` : "";
    return { kind: "proxy", url: `${LLM_STATS_ORIGIN}/${keyPath}${query}` };
  },
};
