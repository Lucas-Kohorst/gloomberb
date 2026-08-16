import type {
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
    case "released":
      return row.releaseDate ?? "";
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
    case "released":
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
