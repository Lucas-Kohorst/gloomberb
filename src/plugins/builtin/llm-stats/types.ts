export const LLM_STATS_PLUGIN_ID = "llm-stats";
export const LLM_STATS_PANE_ID = "llm-stats";
export const LLM_STATS_CONNECTION_ID = "llm-stats";

/** Base URL for the ZeroEval / llm-stats public API. */
export const LLM_STATS_API_BASE = "https://api.llm-stats.com";
/** Base URL for the public website (per-model pages). */
export const LLM_STATS_SITE_BASE = "https://llm-stats.com";

/**
 * Raw model metadata row from GET /v1/models.
 */
export interface LlmStatsModel {
  id: string;
  display_name: string;
  provider_name: string | null;
  organization_name: string | null;
  organization_id: string | null;
  model_name: string | null;
  release_date: string | null;
  context_length: number | null;
  input_price: number | null;
  output_price: number | null;
  quantization_type: string | null;
  input_modalities: string[] | null;
  output_modalities: string[] | null;
  routing_providers: string[] | null;
  is_fallback: boolean | null;
  fallback_providers: string[] | null;
  tier: string | null;
}

/**
 * Raw runtime metrics row from GET /v1/models/metrics.
 */
export interface LlmStatsModelMetrics {
  model_id: string;
  total_calls: number;
  failed_calls: number;
  failure_rate: number;
  avg_throughput: number;
  p5_throughput: number;
  avg_latency: number;
  p95_latency: number;
  avg_ttft: number;
}

/**
 * Joined row shown in the pane: model metadata plus live runtime benchmarks.
 */
export interface LlmStatsRow {
  id: string;
  displayName: string;
  organization: string;
  provider: string;
  releaseDate: string | null;
  contextLength: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  inputModalities: string[];
  outputModalities: string[];
  tier: string | null;
  totalCalls: number;
  failedCalls: number;
  failureRate: number;
  avgThroughput: number;
  p5Throughput: number;
  avgLatency: number;
  p95Latency: number;
  avgTtft: number;
  url: string;
}

export type LlmStatsSortColumnId =
  | "model"
  | "org"
  | "tps"
  | "p95"
  | "fail"
  | "calls"
  | "ttft";

export interface LlmStatsData {
  rows: LlmStatsRow[];
  fetchedAt: number;
}
