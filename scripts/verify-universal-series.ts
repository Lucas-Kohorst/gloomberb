// Verification script: parse and build specs for each universal series kind,
// then verify the loader wiring produces correct TimeSeriesPoint shapes.
// Run with: bun scripts/verify-universal-series.ts

import {
  parseSeriesExpression,
  buildSeriesSpec,
  buildCustomChartPreset,
  formatSeriesExpression,
  chartSeriesLabel,
} from "../src/plugins/builtin/chart-composer/presets";
import {
  formatParsedSeriesExpression,
  buildSeriesCatalogSuggestions,
  buildChartSeriesAssistContext,
} from "../src/plugins/builtin/chart-composer/series-catalog";
import { resolveChartSpecData, type UniversalSeriesLoadResult } from "../src/time-series/resolve";
import type { TimeSeriesPoint } from "../src/time-series/types";

const AAPL = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };

console.log("=== Expression Parsing ===\n");

const expressions = [
  "ADJ:adjacent-djt",
  "FUT:ES",
  "FUT:GC",
  "FUT:CL",
  "UST:10Y",
  "UST:2Y",
  "UST:30Y",
  "BENCH:OpenAI:tps",
  "BENCH:Anthropic:p95",
  "POLL:Donald Trump:Approve",
  "AAPL:price",
  "FRED:CPIAUCSL",
];

for (const expr of expressions) {
  const parsed = parseSeriesExpression(expr);
  if (!parsed) {
    console.log(`  ${expr} → FAILED TO PARSE`);
    continue;
  }
  const spec = buildSeriesSpec(parsed, 0);
  const formatted = formatSeriesExpression(spec);
  const label = chartSeriesLabel(spec);
  console.log(`  ${expr}`);
  console.log(`    parsed kind: ${parsed.kind}`);
  console.log(`    stored source kind: ${spec.source.kind}`);
  console.log(`    formatted: ${formatted}`);
  console.log(`    label: ${label}`);
  console.log();
}

console.log("=== Catalog Suggestions ===\n");

const queries = ["futures", "gold", "treasury yield", "10Y", "benchmark openai", "poll approval", "FUT:ES", "UST:10Y"];
for (const q of queries) {
  const suggestions = buildSeriesCatalogSuggestions(q, AAPL, [], 10);
  console.log(`  Query "${q}": ${suggestions.length} suggestions`);
  for (const s of suggestions.slice(0, 5)) {
    console.log(`    - ${s.label} → ${formatParsedSeriesExpression(s.expression)}`);
  }
  console.log();
}

console.log("=== Assist Context ===\n");
console.log(buildChartSeriesAssistContext());
console.log();

console.log("=== Resolution (stub loaders) ===\n");

// Simulate loaders to verify the pipeline end-to-end
const stubSources = {
  dataProvider: null,
  loadFredSeries: async () => ({
    data: { observations: [], info: null },
    fetchedAt: Date.now(),
    stale: false,
    source: "cache" as const,
  }),
  loadAdjacentIndexSeries: async (indexId: string): Promise<UniversalSeriesLoadResult> => ({
    points: [
      { date: new Date("2024-01-01T00:00:00Z"), observedAt: new Date("2024-01-01T00:00:00Z"), value: 55, provenance: { providerId: "adjacent", quality: "reported" as const } },
      { date: new Date("2024-06-01T00:00:00Z"), observedAt: new Date("2024-06-01T00:00:00Z"), value: 62, provenance: { providerId: "adjacent", quality: "reported" as const } },
    ],
    unit: "index",
    unitGroup: `adjacent-index:${indexId}`,
  }),
  loadBenchmarkSeries: async (selector: string, metric: string): Promise<UniversalSeriesLoadResult> => ({
    points: [
      { date: new Date("2024-05-13T00:00:00Z"), observedAt: new Date("2024-05-13T00:00:00Z"), value: 85.5, provenance: { providerId: "llm-stats", quality: "reported" as const } },
    ],
    unit: "tok/s",
    unitGroup: `benchmark:${metric}`,
    label: `${selector} Throughput`,
    warning: "Point-in-time snapshot at model release date; no historical time series available.",
  }),
  loadPollSeries: async (subject: string, choice: string): Promise<UniversalSeriesLoadResult> => ({
    points: [
      { date: new Date("2024-01-05T00:00:00Z"), observedAt: new Date("2024-01-05T00:00:00Z"), value: 52, provenance: { providerId: "votehub", quality: "reported" as const } },
      { date: new Date("2024-06-05T00:00:00Z"), observedAt: new Date("2024-06-05T00:00:00Z"), value: 48, provenance: { providerId: "votehub", quality: "reported" as const } },
    ],
    unit: "%",
    unitGroup: `poll:${subject}`,
    label: `${subject} ${choice}`,
  }),
};

async function verifyResolution(expr: string) {
  const spec = buildCustomChartPreset(expr);
  const result = await resolveChartSpecData(spec, stubSources);
  const series = result.series[0];
  console.log(`  ${expr}:`);
  console.log(`    errors: ${result.errors.length > 0 ? result.errors : "none"}`);
  if (series) {
    console.log(`    label: ${series.label}`);
    console.log(`    unit: ${series.unit}`);
    console.log(`    style: ${series.style}`);
    console.log(`    points: ${series.points.length}`);
    if (series.warning) console.log(`    warning: ${series.warning}`);
    for (const p of series.points.slice(0, 3)) {
      console.log(`      ${p.date.toISOString().slice(0, 10)} = ${p.value}`);
    }
  }
  console.log();
}

await verifyResolution("ADJ:adjacent-djt");
await verifyResolution("BENCH:OpenAI:tps");
await verifyResolution("POLL:Donald Trump:Approve");
await verifyResolution("FUT:ES");
await verifyResolution("UST:10Y");

console.log("=== Done ===\n");
