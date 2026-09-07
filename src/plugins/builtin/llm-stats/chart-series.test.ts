import { expect, test } from "bun:test";
import { loadBenchmarkSeries } from "./chart-series";
import type { LlmStatsRow } from "./types";

test("benchmark loading filters unusable observations and keeps release-date provenance", async () => {
  const model: LlmStatsRow = {
    id: "model", displayName: "Model", organization: "Example", provider: "Example",
    releaseDate: "2024-05-13", contextLength: 128000, inputPrice: 5, outputPrice: 15,
    inputModalities: [], outputModalities: [], tier: "frontier",
    totalCalls: 1000, failedCalls: 10, failureRate: 1, avgThroughput: 85.5,
    p5Throughput: 50, avgLatency: 1200, p95Latency: 2000, avgTtft: 500, url: "",
  };
  const result = await loadBenchmarkSeries("example", "tps", async () => ({
    fetchedAt: 0,
    rows: [
      model,
      { ...model, id: "missing", releaseDate: null },
      { ...model, id: "invalid", releaseDate: "not-a-date" },
      { ...model, id: "nan", avgThroughput: NaN },
      { ...model, id: "unrelated", organization: "Elsewhere" },
    ],
  }));
  expect(result.points).toEqual([{
    date: new Date("2024-05-13"), observedAt: new Date("2024-05-13"), value: 85.5,
    provenance: { providerId: "llm-stats", quality: "reported" },
  }]);
  expect(result).toMatchObject({ unit: "tok/s", unitGroup: "benchmark:tps", label: "example Throughput" });
});
