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

export function findBenchmarkMetric(token: string): BenchmarkMetricEntry | undefined {
  const lower = token.trim().toLowerCase();
  return BENCHMARK_METRICS.find((entry) => entry.code === lower);
}
