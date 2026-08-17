import type {
  LlmStatsBenchmarkRow,
  LlmStatsRow,
  LlmStatsSortColumnId,
} from "./types";
import type { StackSortPreference } from "../../../components";

export const DEFAULT_LLM_STATS_SORT: StackSortPreference<LlmStatsSortColumnId> = {
  columnId: "calls",
  direction: "desc",
};

export function llmStatsSortValue(
  row: LlmStatsRow,
  columnId: LlmStatsSortColumnId,
): string | number {
  switch (columnId) {
    case "model":
      return row.displayName.toLowerCase();
    case "org":
      return row.organization.toLowerCase();
    case "tps":
      return row.avgThroughput;
    case "p95":
      return row.p95Latency;
    case "fail":
      return row.failureRate;
    case "calls":
      return row.totalCalls;
    case "ttft":
      return row.avgTtft;
  }
}

export function compareLlmStatsRows(
  left: LlmStatsRow,
  right: LlmStatsRow,
  columnId: LlmStatsSortColumnId,
): number {
  const a = llmStatsSortValue(left, columnId);
  const b = llmStatsSortValue(right, columnId);
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b));
  }
  return a - b;
}

export function filterLlmStatsRows(
  rows: LlmStatsRow[],
  query: string,
): LlmStatsRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    row.displayName.toLowerCase().includes(needle)
    || row.organization.toLowerCase().includes(needle)
    || row.provider.toLowerCase().includes(needle)
    || row.id.toLowerCase().includes(needle)
    || (row.tier ?? "").toLowerCase().includes(needle),
  );
}

/** Default sort direction when a column header is first clicked. */
export function defaultSortDirection(
  columnId: LlmStatsSortColumnId,
): "asc" | "desc" {
  // Text columns default to asc; numeric "good is high" columns default to desc;
  // latency/failure (good is low) default to asc.
  switch (columnId) {
    case "model":
    case "org":
      return "asc";
    case "tps":
    case "calls":
      return "desc";
    case "p95":
    case "fail":
    case "ttft":
      return "asc";
  }
}

/** Blended dollars per 1M tokens, assuming an equal input/output mix. */
export function blendedPrice(row: LlmStatsRow): number | null {
  if (row.inputPrice == null || row.outputPrice == null) return null;
  const price = (row.inputPrice + row.outputPrice) / 2;
  return price > 0 ? price : null;
}

/** Cost-adjusted score: score units per dollar per 1M blended tokens. */
export function costAdjustedScore(score: number, row: LlmStatsRow): number | null {
  const price = blendedPrice(row);
  return price == null || score <= 0 ? null : score / price;
}

export function bestOverall(rows: LlmStatsRow[], score: (row: LlmStatsRow) => number): LlmStatsRow | null {
  return rows.filter((row) => score(row) > 0).reduce<LlmStatsRow | null>(
    (best, row) => !best || score(row) > score(best) ? row : best,
    null,
  );
}

export function bestCostAdjusted(rows: LlmStatsRow[], score: (row: LlmStatsRow) => number): LlmStatsRow | null {
  return rows.reduce<LlmStatsRow | null>((best, row) => {
    const candidate = costAdjustedScore(score(row), row);
    if (candidate == null) return best;
    const current = best == null ? null : costAdjustedScore(score(best), best);
    return current == null || candidate > current ? row : best;
  }, null);
}

export function biggestImprovement(): null {
  // The live API exposes no previous score or change field; never fabricate a delta.
  return null;
}

export function buildBenchmarkRows(rows: LlmStatsRow[]): LlmStatsBenchmarkRow[] {
  const definitions = [
    { id: "throughput", name: "Throughput", unit: "tokens/sec", score: (r: LlmStatsRow) => r.avgThroughput },
    { id: "latency", name: "Latency", unit: "ms (lower is better)", score: (r: LlmStatsRow) => r.p95Latency > 0 ? 1 / r.p95Latency : 0 },
    { id: "reliability", name: "Reliability", unit: "success rate", score: (r: LlmStatsRow) => r.totalCalls > 0 ? 1 - r.failureRate : 0 },
    { id: "usage", name: "Usage", unit: "calls", score: (r: LlmStatsRow) => r.totalCalls },
  ];
  return definitions.map(({ id, name, unit, score }) => ({
    id,
    name,
    unit,
    bestOverall: bestOverall(rows, score),
    bestCostAdjusted: bestCostAdjusted(rows, score),
    biggestImprovement: biggestImprovement(),
  }));
}
