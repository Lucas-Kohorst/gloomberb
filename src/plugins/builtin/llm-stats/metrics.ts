import type { ChartSeriesCatalogProvider } from "../../../types/plugin";

export interface BenchmarkMetricEntry {
  code: string;
  label: string;
  unit: string;
  unitGroup: string;
}

export const BENCHMARK_METRICS: readonly BenchmarkMetricEntry[] = [
  { code: "tps", label: "Throughput", unit: "tok/s", unitGroup: "throughput" },
  { code: "p95", label: "P95 Latency", unit: "ms", unitGroup: "latency" },
  { code: "ttft", label: "Time to First Token", unit: "ms", unitGroup: "latency" },
  { code: "latency", label: "Avg Latency", unit: "ms", unitGroup: "latency" },
  { code: "fail", label: "Failure Rate", unit: "%", unitGroup: "percent" },
  { code: "calls", label: "Total Calls", unit: "calls", unitGroup: "calls" },
];

export const BENCHMARK_ORGANIZATIONS: readonly string[] = [
  "OpenAI", "Anthropic", "Google", "Meta", "Mistral", "Amazon", "Cohere", "Microsoft",
];

export const llmStatsSeriesCatalog: ChartSeriesCatalogProvider = {
  id: "llm-stats",
  name: "AI Benchmarks",
  sourceId: "llm-stats",
  entries: BENCHMARK_ORGANIZATIONS.flatMap((organization) => BENCHMARK_METRICS.map((metric) => ({
    id: `${organization}:${metric.code}`,
    expression: `BENCH:${organization}:${metric.code}`,
    label: `${organization} ${metric.label}`,
    source: "llm-stats",
    searchText: `${organization} ${metric.label} ${metric.code} ai llm model benchmark`.toLowerCase(),
    description: `${metric.label} for ${organization} models at release date`,
    detail: "AI Benchmark",
    unit: metric.unit,
  }))),
  assist: {
    keywords: ["ai benchmarks", "model throughput", "latency", "time to first token"],
    examples: ["OpenAI throughput", "Anthropic latency"],
  },
};

export function findBenchmarkMetric(token: string): BenchmarkMetricEntry | undefined {
  const lower = token.trim().toLowerCase();
  return BENCHMARK_METRICS.find((entry) => entry.code === lower);
}
