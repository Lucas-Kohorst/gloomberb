import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import {
  LLM_STATS_API_BASE,
  LLM_STATS_CONNECTION_ID,
  LLM_STATS_SITE_BASE,
  type LlmStatsData,
  type LlmStatsModel,
  type LlmStatsModelMetrics,
  type LlmStatsRow,
} from "./types";

const CLIENT = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: 12_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-llm-stats",
  },
  transport: httpFetch,
});

function isModel(value: unknown): value is LlmStatsModel {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.display_name === "string";
}

function isMetrics(value: unknown): value is LlmStatsModelMetrics {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.model_id === "string" && typeof record.total_calls === "number";
}

function parseModels(body: unknown): LlmStatsModel[] {
  if (!Array.isArray(body)) return [];
  return body.filter(isModel);
}

function parseMetrics(body: unknown): LlmStatsModelMetrics[] {
  if (!Array.isArray(body)) return [];
  return body.filter(isMetrics);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function joinRows(
  models: LlmStatsModel[],
  metrics: LlmStatsModelMetrics[],
): LlmStatsRow[] {
  const metricsById = new Map<string, LlmStatsModelMetrics>();
  for (const m of metrics) metricsById.set(m.model_id, m);

  return models.map((model): LlmStatsRow => {
    const m = metricsById.get(model.id);
    return {
      id: model.id,
      displayName: model.display_name,
      organization: str(model.organization_name) ?? str(model.organization_id) ?? "—",
      provider: str(model.provider_name) ?? "—",
      releaseDate: str(model.release_date),
      contextLength: num(model.context_length),
      inputPrice: num(model.input_price),
      outputPrice: num(model.output_price),
      inputModalities: stringArray(model.input_modalities),
      outputModalities: stringArray(model.output_modalities),
      tier: str(model.tier),
      totalCalls: m?.total_calls ?? 0,
      failedCalls: m?.failed_calls ?? 0,
      failureRate: m?.failure_rate ?? 0,
      avgThroughput: m?.avg_throughput ?? 0,
      p5Throughput: m?.p5_throughput ?? 0,
      avgLatency: m?.avg_latency ?? 0,
      p95Latency: m?.p95_latency ?? 0,
      avgTtft: m?.avg_ttft ?? 0,
      url: `${LLM_STATS_SITE_BASE}/models/${model.id}`,
    };
  });
}

/**
 * Fetch model metadata and live runtime metrics in parallel, then join them
 * into the rows the pane renders. Both endpoints are public (keyless).
 */
export async function fetchLlmStatsData(): Promise<LlmStatsData> {
  return withConnectionRequest(LLM_STATS_CONNECTION_ID, "stats", async () => {
    const [modelsRes, metricsRes] = await Promise.all([
      CLIENT.fetch(`${LLM_STATS_API_BASE}/v1/models`),
      CLIENT.fetch(`${LLM_STATS_API_BASE}/v1/models/metrics`),
    ]);
    if (!modelsRes.ok) {
      throw new Error(`llm-stats models request failed (${modelsRes.status})`);
    }
    if (!metricsRes.ok) {
      throw new Error(`llm-stats metrics request failed (${metricsRes.status})`);
    }
    const [models, metrics] = await Promise.all([
      modelsRes.json().then(parseModels),
      metricsRes.json().then(parseMetrics),
    ]);
    return {
      rows: joinRows(models, metrics),
      fetchedAt: Date.now(),
    };
  });
}
