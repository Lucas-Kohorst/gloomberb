import { listTimeSeriesFields } from "../../../time-series/field-catalog";
import { publicTickerKey } from "../../../utils/exchanges";
import { listKnownFredSeries } from "../econ/fred-series-map";
import {
  type SeriesCatalogInstrument,
} from "./series-catalog";
import {
  formatPredictionSeriesExpression,
  type PredictionMarketSearchHit,
} from "./prediction-series";
import { shortChartFieldToken } from "./presets";
import {
  ADJACENT_INDEX_CATALOG,
  BENCHMARK_METRICS,
  BENCHMARK_ORGS,
  FUTURES_CATALOG,
  POLL_SUBJECTS,
  TREASURY_CATALOG,
} from "./universal-series";

export const DATA_CATALOG_PANE_ID = "data-catalog";
export const DATA_CATALOG_TEMPLATE_ID = "data-catalog-pane";

export type CatalogSourceId =
  | "security"
  | "fred"
  | "adjacent"
  | "kalshi"
  | "polymarket"
  | "futures"
  | "treasury"
  | "poll"
  | "benchmark";

export type CatalogFilterId =
  | "all"
  | "securities"
  | "fred"
  | "prediction"
  | "futures"
  | "other";

export interface CatalogSeriesRow {
  id: string;
  label: string;
  source: string;
  sourceId: CatalogSourceId;
  kind: string;
  expression: string;
  url?: string;
  searchText: string;
}

export const CATALOG_FILTERS: ReadonlyArray<{ id: CatalogFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "securities", label: "Securities" },
  { id: "fred", label: "FRED" },
  { id: "prediction", label: "Prediction" },
  { id: "futures", label: "Futures" },
  { id: "other", label: "Other" },
];

const FILTER_SOURCES: Record<CatalogFilterId, ReadonlySet<CatalogSourceId> | null> = {
  all: null,
  securities: new Set(["security"]),
  fred: new Set(["fred", "treasury"]),
  prediction: new Set(["adjacent", "kalshi", "polymarket"]),
  futures: new Set(["futures"]),
  other: new Set(["poll", "benchmark"]),
};

function fieldKind(fieldId: string): string {
  if (fieldId.startsWith("market.")) return "Market";
  if (fieldId.startsWith("valuation.")) return "Valuation";
  return "Fundamentals";
}

function row(entry: {
  id: string;
  label: string;
  source: string;
  sourceId: CatalogSourceId;
  kind: string;
  expression: string;
  url?: string;
}): CatalogSeriesRow {
  return {
    ...entry,
    searchText: [
      entry.label,
      entry.source,
      entry.kind,
      entry.expression,
      entry.sourceId,
    ].join(" ").toLowerCase(),
  };
}

export function catalogRowUrl(row: CatalogSeriesRow): string | null {
  return row.url ?? null;
}

export function catalogRowsFromPredictionHits(
  hits: readonly PredictionMarketSearchHit[],
): CatalogSeriesRow[] {
  return hits.flatMap((hit) => {
    const expression = formatPredictionSeriesExpression({
      kind: "prediction-market",
      venue: hit.venue,
      marketId: hit.marketId,
      label: hit.title,
    });
    return [row({
      id: `pm:${hit.venue}:${hit.marketId}`,
      label: `${hit.venue === "kalshi" ? "Kalshi" : "Polymarket"} · ${hit.title}`,
      source: hit.venue === "kalshi" ? "Kalshi" : "Polymarket",
      sourceId: hit.venue,
      kind: hit.eventLabel || "Yes price",
      expression,
      url: hit.venue === "kalshi"
        ? `https://kalshi.com/markets/${hit.marketId}`
        : `https://polymarket.com/event/${hit.marketId}`,
    })];
  });
}

export function listStaticCatalogInventory(
  instrument: SeriesCatalogInstrument,
): CatalogSeriesRow[] {
  const ticker = publicTickerKey(instrument.symbol, instrument.exchange);
  const securities = listTimeSeriesFields().map((field) => {
    const token = shortChartFieldToken(field.id);
    return row({
      id: `${ticker}:${field.id}`,
      label: `${ticker} · ${field.label}`,
      source: "Security",
      sourceId: "security",
      kind: fieldKind(field.id),
      expression: `${ticker}:${token}`,
    });
  });

  const fred = listKnownFredSeries().map((entry) => row({
    id: `fred:${entry.seriesId}`,
    label: `FRED · ${entry.label}`,
    source: "FRED",
    sourceId: "fred",
    kind: "Economic",
    expression: `FRED:${entry.seriesId}`,
    url: `https://fred.stlouisfed.org/series/${entry.seriesId}`,
  }));

  const treasuries = TREASURY_CATALOG.map((entry) => row({
    id: `ust:${entry.maturity}`,
    label: entry.label,
    source: "Treasury",
    sourceId: "treasury",
    kind: "Yield",
    expression: `UST:${entry.maturity}`,
    url: `https://fred.stlouisfed.org/series/${entry.seriesId}`,
  }));

  const futures = FUTURES_CATALOG.map((entry) => row({
    id: `fut:${entry.code}`,
    label: `${entry.name} (${entry.code})`,
    source: "Futures",
    sourceId: "futures",
    kind: entry.sectorLabel,
    expression: `FUT:${entry.code}`,
  }));

  const adjacent = ADJACENT_INDEX_CATALOG.map((entry) => row({
    id: `adj:${entry.indexId}`,
    label: `ADJ · ${entry.name}`,
    source: "Adjacent",
    sourceId: "adjacent",
    kind: "Index",
    expression: `ADJ:${entry.indexId}`,
    url: "https://adjacent.markets",
  }));

  const polls = POLL_SUBJECTS.flatMap((subject) => (
    subject.choices.map((choice) => row({
      id: `poll:${subject.subject}:${choice}`,
      label: `${subject.subject} · ${choice}`,
      source: "VoteHub",
      sourceId: "poll",
      kind: "Poll",
      expression: `POLL:${subject.subject}:${choice}`,
    }))
  ));

  const benchmarks = BENCHMARK_ORGS.flatMap((org) => (
    BENCHMARK_METRICS.map((metric) => row({
      id: `bench:${org}:${metric.code}`,
      label: `${org} · ${metric.label}`,
      source: "Benchmark",
      sourceId: "benchmark",
      kind: "AI",
      expression: `BENCH:${org}:${metric.code}`,
    }))
  ));

  return [
    ...securities,
    ...fred,
    ...treasuries,
    ...futures,
    ...adjacent,
    ...polls,
    ...benchmarks,
  ];
}

export function matchesCatalogQuery(entry: CatalogSeriesRow, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return normalized.split(/\s+/).every((token) => entry.searchText.includes(token));
}

export function filterCatalogRows(
  rows: readonly CatalogSeriesRow[],
  filter: CatalogFilterId,
  query: string,
): CatalogSeriesRow[] {
  const sources = FILTER_SOURCES[filter];
  return rows.filter((entry) => (
    (sources ? sources.has(entry.sourceId) : true)
    && matchesCatalogQuery(entry, query)
  ));
}
