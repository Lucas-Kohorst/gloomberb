import { afterEach, describe, expect, mock, test } from "bun:test";
import { VOTEHUB_POLL_TYPES } from "./catalog-inventory";

let benchCalls = 0;
let benchEmpty = false;
let pollCalls = 0;
let indexCalls = 0;

mock.module("../llm-stats/client", () => ({
  fetchLlmStatsData: async () => {
    benchCalls += 1;
    if (benchEmpty) return { rows: [] };
    return {
      rows: [{
        id: "gpt-4o",
        displayName: "GPT-4o",
        organization: "OpenAI",
        provider: "OpenAI",
        releaseDate: "2024-05-13",
        contextLength: 128000,
        inputPrice: 2.5,
        outputPrice: 10,
        inputModalities: ["text"],
        outputModalities: ["text"],
        tier: null,
        totalCalls: 100,
        failedCalls: 1,
        failureRate: 0.01,
        avgThroughput: 80,
        p5Throughput: 60,
        avgLatency: 2100,
        p95Latency: 3000,
        avgTtft: 400,
        url: "https://llm-stats.com/models/gpt-4o",
      }],
    };
  },
}));

mock.module("../polls/client", () => ({
  fetchVoteHubPolls: async () => {
    pollCalls += 1;
    return [{
      id: "1",
      subject: "Donald Trump",
      answers: [{ choice: "Approve", pct: 50 }],
    }];
  },
}));

mock.module("../adjacent/client", () => ({
  getSharedAdjacentClient: () => ({
    getIndices: async () => {
      indexCalls += 1;
      return { data: [{ index_id: "red", name: "RED Index", ticker: "RED" }] };
    },
  }),
}));

const {
  loadCatalogAdjacentIndices,
  loadCatalogBenchRows,
  loadCatalogPollRows,
  peekCatalogBenchRows,
  resetCatalogPrefetchCaches,
} = await import("./catalog-prefetch");

describe("catalog live-source prefetch cache", () => {
  afterEach(() => {
    resetCatalogPrefetchCaches();
    benchCalls = 0;
    benchEmpty = false;
    pollCalls = 0;
    indexCalls = 0;
  });

  test("loads llm-stats, polls, and Adjacent once and reuses the in-memory snapshot", async () => {
    const benchFirst = await loadCatalogBenchRows();
    const benchSecond = await loadCatalogBenchRows();
    expect(benchFirst.some((row) => row.expression === "BENCH:gpt-4o:tps")).toBe(true);
    expect(benchSecond).toBe(benchFirst);
    expect(benchCalls).toBe(1);

    const pollsFirst = await loadCatalogPollRows();
    const pollsSecond = await loadCatalogPollRows();
    expect(pollsFirst.some((row) => row.expression === "POLL:Donald Trump:Approve")).toBe(true);
    expect(pollsSecond).toBe(pollsFirst);
    expect(pollCalls).toBe(VOTEHUB_POLL_TYPES.length);

    const indicesFirst = await loadCatalogAdjacentIndices();
    const indicesSecond = await loadCatalogAdjacentIndices();
    expect(indicesFirst).toEqual([{ indexId: "red", name: "RED Index", ticker: "RED" }]);
    expect(indicesSecond).toBe(indicesFirst);
    expect(indexCalls).toBe(1);
  });

  test("does not cache empty llm-stats results so the next load retries", async () => {
    benchEmpty = true;
    const first = await loadCatalogBenchRows();
    expect(first).toEqual([]);
    expect(peekCatalogBenchRows()).toBeNull();

    benchEmpty = false;
    const second = await loadCatalogBenchRows();
    expect(second.length).toBeGreaterThan(0);
    expect(benchCalls).toBe(2);
  });
});
