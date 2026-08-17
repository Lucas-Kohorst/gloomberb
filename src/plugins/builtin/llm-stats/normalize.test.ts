import { describe, expect, test } from "bun:test";
import {
  bestCostAdjusted,
  bestOverall,
  biggestImprovement,
  costAdjustedScore,
} from "./normalize";
import type { LlmStatsRow } from "./types";

function row(id: string, throughput: number, inputPrice: number | null, outputPrice: number | null): LlmStatsRow {
  return {
    id, displayName: id, organization: id, provider: "test", releaseDate: null,
    contextLength: null, inputPrice, outputPrice, inputModalities: [], outputModalities: [],
    tier: null, totalCalls: 1, failedCalls: 0, failureRate: 0, avgThroughput: throughput,
    p5Throughput: 0, avgLatency: 0, p95Latency: 0, avgTtft: 0, url: "",
  };
}

describe("llm-stats ranking math", () => {
  test("selects the highest overall score", () => {
    const rows = [row("slow", 10, 1, 1), row("fast", 20, 1, 1)];
    expect(bestOverall(rows, (item) => item.avgThroughput)?.id).toBe("fast");
  });

  test("selects score per dollar using equal input/output blend", () => {
    const cheap = row("cheap", 10, 1, 1);
    const expensive = row("expensive", 20, 5, 5);
    expect(costAdjustedScore(cheap.avgThroughput, cheap)).toBe(10);
    expect(bestCostAdjusted([cheap, expensive], (item) => item.avgThroughput)?.id).toBe("cheap");
  });

  test("does not invent biggest-improvement data without history", () => {
    expect(biggestImprovement()).toBeNull();
  });
});
