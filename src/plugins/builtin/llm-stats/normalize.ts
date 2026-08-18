import type { StackSortPreference } from "../../../components";
import {
  ARTIFICIAL_ANALYSIS_SITE,
  type AaCatalogMetric,
  type AaModelRow,
  type AaSortColumnId,
  type AaTab,
} from "./types";

export const DEFAULT_AA_SORT: StackSortPreference<AaSortColumnId> = {
  columnId: "intelligence",
  direction: "desc",
};

export const AA_LANGUAGE_METRICS: readonly AaCatalogMetric[] = [
  { code: "intelligence", label: "Intelligence Index", kind: "Benchmark", unit: "index", unitGroup: "intelligence" },
  { code: "coding", label: "Coding Index", kind: "Benchmark", unit: "index", unitGroup: "coding" },
  { code: "agentic", label: "Agentic Index", kind: "Benchmark", unit: "index", unitGroup: "agentic" },
  { code: "speed", label: "Output Speed", kind: "Benchmark", unit: "tok/s", unitGroup: "throughput" },
  { code: "ttft", label: "Time to First Token", kind: "Benchmark", unit: "s", unitGroup: "latency" },
  { code: "e2e", label: "End-to-end Latency", kind: "Benchmark", unit: "s", unitGroup: "latency" },
  { code: "input", label: "Input Price", kind: "Benchmark", unit: "$/1M", unitGroup: "price" },
  { code: "output", label: "Output Price", kind: "Benchmark", unit: "$/1M", unitGroup: "price" },
];

const AA_MEDIA_METRICS: readonly AaCatalogMetric[] = [
  { code: "elo", label: "Arena Elo", kind: "Benchmark", unit: "elo", unitGroup: "elo" },
  { code: "wer", label: "WER Index", kind: "Benchmark", unit: "wer", unitGroup: "wer" },
  { code: "bba", label: "Big Bench Audio", kind: "Benchmark", unit: "score", unitGroup: "score" },
  { code: "fdb", label: "Full Duplex Bench", kind: "Benchmark", unit: "score", unitGroup: "score" },
  { code: "tau", label: "τ-Voice", kind: "Benchmark", unit: "score", unitGroup: "score" },
];

const METRIC_ALIASES: Readonly<Record<string, string>> = {
  tps: "speed",
  throughput: "speed",
  latency: "e2e",
  p95: "e2e",
  int: "intelligence",
  code: "coding",
  agent: "agentic",
  input_price: "input",
  output_price: "output",
};

export function canonicalAaMetric(code: string): string {
  const lower = code.trim().toLowerCase();
  return METRIC_ALIASES[lower] ?? lower;
}

export function aaMetricValue(row: AaModelRow, code: string): number | null {
  switch (canonicalAaMetric(code)) {
    case "intelligence":
      return row.intelligence;
    case "coding":
      return row.coding;
    case "agentic":
      return row.agentic;
    case "speed":
      return row.speed;
    case "ttft":
      return row.ttftSeconds;
    case "e2e":
      return row.e2eSeconds;
    case "input":
      return row.inputPrice;
    case "output":
      return row.outputPrice;
    case "elo":
      return row.elo;
    case "wer":
      return row.wer;
    case "bba":
      return row.bba;
    case "fdb":
      return row.fdb;
    case "tau":
      return row.tau;
    default:
      return null;
  }
}

export function aaCatalogMetricsForRow(row: AaModelRow): Array<AaCatalogMetric & { value: number }> {
  const metrics = row.family === "language" ? AA_LANGUAGE_METRICS : AA_MEDIA_METRICS;
  return metrics.flatMap((metric) => {
    const value = aaMetricValue(row, metric.code);
    return value == null ? [] : [{ ...metric, value }];
  });
}

export function aaModelUrl(row: AaModelRow): string {
  return row.url || ARTIFICIAL_ANALYSIS_SITE;
}

export function aaChartExpression(row: AaModelRow, metricCode: string): string {
  return `BENCH:${row.slug}:${canonicalAaMetric(metricCode)}`;
}

export function defaultMetricForTab(tab: AaTab, row: AaModelRow): string {
  if (tab === "coding") return "coding";
  if (tab === "agentic") return "agentic";
  if (tab === "price-speed") return row.speed != null ? "speed" : "input";
  if (tab === "image" || tab === "video") return row.elo != null ? "elo" : "intelligence";
  if (tab === "audio") {
    if (row.elo != null) return "elo";
    if (row.wer != null) return "wer";
    if (row.bba != null) return "bba";
    return "tau";
  }
  return row.intelligence != null ? "intelligence" : (aaCatalogMetricsForRow(row)[0]?.code ?? "intelligence");
}

export function filterAaRows(rows: readonly AaModelRow[], tab: AaTab, query: string): AaModelRow[] {
  const familyFiltered = rows.filter((row) => {
    if (tab === "image") return row.family === "image";
    if (tab === "video") return row.family === "video";
    if (tab === "audio") return row.family === "speech" || row.family === "music";
    if (tab === "models" || tab === "intelligence" || tab === "coding" || tab === "agentic" || tab === "price-speed") {
      return row.family === "language";
    }
    return true;
  });
  const needle = query.trim().toLowerCase();
  if (!needle) return familyFiltered;
  return familyFiltered.filter((row) => (
    row.name.toLowerCase().includes(needle)
    || row.creator.toLowerCase().includes(needle)
    || row.slug.toLowerCase().includes(needle)
    || row.category.toLowerCase().includes(needle)
  ));
}

export function aaSortValue(row: AaModelRow, columnId: AaSortColumnId): string | number {
  switch (columnId) {
    case "model":
      return row.name.toLowerCase();
    case "org":
      return row.creator.toLowerCase();
    case "intelligence":
      return row.intelligence ?? -Infinity;
    case "coding":
      return row.coding ?? -Infinity;
    case "agentic":
      return row.agentic ?? -Infinity;
    case "speed":
      return row.speed ?? -Infinity;
    case "ttft":
      return row.ttftSeconds ?? Infinity;
    case "e2e":
      return row.e2eSeconds ?? Infinity;
    case "input":
      return row.inputPrice ?? Infinity;
    case "output":
      return row.outputPrice ?? Infinity;
    case "elo":
      return row.elo ?? -Infinity;
    case "wer":
      return row.wer ?? Infinity;
  }
}

export function compareAaRows(
  left: AaModelRow,
  right: AaModelRow,
  columnId: AaSortColumnId,
): number {
  const a = aaSortValue(left, columnId);
  const b = aaSortValue(right, columnId);
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b));
  }
  return a - b;
}

export function defaultAaSortDirection(columnId: AaSortColumnId): "asc" | "desc" {
  switch (columnId) {
    case "model":
    case "org":
    case "ttft":
    case "e2e":
    case "input":
    case "output":
    case "wer":
      return "asc";
    default:
      return "desc";
  }
}

export function blendedPrice(row: AaModelRow): number | null {
  if (row.inputPrice == null || row.outputPrice == null) return null;
  const price = (row.inputPrice + row.outputPrice) / 2;
  return price > 0 ? price : null;
}

export function costAdjustedScore(score: number, row: AaModelRow): number | null {
  const price = blendedPrice(row);
  return price == null || score <= 0 ? null : score / price;
}

export function matchingAaRows(rows: readonly AaModelRow[], selector: string): AaModelRow[] {
  const needle = selector.trim().toLowerCase();
  if (!needle) return [];
  return rows.filter((row) => (
    row.slug.toLowerCase() === needle
    || row.id.toLowerCase() === needle
    || row.name.toLowerCase() === needle
    || row.creator.toLowerCase() === needle
    || row.creatorSlug.toLowerCase() === needle
  ));
}
