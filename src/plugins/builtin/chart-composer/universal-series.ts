/**
 * Static catalog data and prefix conventions for the non-security series kinds
 * chartable from `G`.  Each prefix maps to a {@link ParsedSeriesExpression}
 * kind that {@link parseSeriesExpression} recognises and
 * {@link buildSeriesCatalogSuggestions} surfaces in the command bar.
 *
 * Default measures: assets/futures → price, FRED/UST/OWID/WX → level,
 * prediction markets → probability (0–100), polls → percent (0–100).
 *
 * Prefixes:
 * - `ADJ:indexId`       — Adjacent prediction-market index (50–150 scale)
 * - `KALSHI:ticker`     — Kalshi market yes-price
 * - `POLY:marketId`     — Polymarket market yes-price
 * - `FUT:code`          — Yahoo front-month futures contract (resolves as a security)
 * - `UST:maturity`      — US Treasury constant-rate yield (backed by FRED)
 * - `BENCH:selector:metric` — AI model benchmark metric at release date (scatter)
 * - `POLL:subject:choice`   — VoteHub poll percentage for a choice over time
 * - `WX:station:metric`     — Weather Company Kalshi climate / hourly (LAX, high)
 * - `NWS:icao:metric`       — NWS Daily Climate Report first-final print (KNYC, high)
 * - `OWID:slug:entity`      — Our World in Data grapher series (life-expectancy, USA)
 */

export const SERIES_PREFIX = {
  adjacentIndex: "ADJ",
  kalshi: "KALSHI",
  polymarket: "POLY",
  predictionMarket: "PM",
  future: "FUT",
  treasury: "UST",
  benchmark: "BENCH",
  poll: "POLL",
  weather: "WX",
  nwsCli: "NWS",
  owid: "OWID",
  indicator: "IND",
} as const;

export type PredictionMarketVenue = "kalshi" | "polymarket";

import type { ChartStudyKind } from "../../../time-series/types";

// ---------------------------------------------------------------------------
// Futures — static catalogue of Yahoo front-month contracts.
// ---------------------------------------------------------------------------

export interface FuturesCatalogEntry {
  code: string;
  symbol: string;
  name: string;
  sector: string;
  sectorLabel: string;
}

import {
  FUTURES_CONTRACTS,
  FUTURES_SECTOR_LABELS,
} from "../futures/contracts";

export const FUTURES_CATALOG: readonly FuturesCatalogEntry[] = FUTURES_CONTRACTS.map(
  (contract) => ({
    code: contract.code,
    symbol: contract.symbol,
    name: contract.name,
    sector: contract.sector,
    sectorLabel: FUTURES_SECTOR_LABELS[contract.sector],
  }),
);

export function findFuturesCatalogEntry(
  token: string,
): FuturesCatalogEntry | undefined {
  const upper = token.trim().toUpperCase();
  return FUTURES_CATALOG.find(
    (entry) =>
      entry.code === upper
      || entry.symbol === upper
      || entry.symbol === `${upper}=F`,
  );
}

// ---------------------------------------------------------------------------
// US Treasury yields — maps a maturity label to a FRED series ID.
// ---------------------------------------------------------------------------

export interface TreasuryCatalogEntry {
  maturity: string;
  years: number;
  seriesId: string;
  label: string;
}

import { TREASURY_MATURITIES } from "../yield-curve/treasury-data";

export const TREASURY_CATALOG: readonly TreasuryCatalogEntry[] =
  TREASURY_MATURITIES.map((entry) => ({
    maturity: entry.maturity,
    years: entry.years,
    seriesId: entry.seriesId,
    label: `${entry.maturity} Treasury Yield`,
  }));

/** Yahoo / street aliases that should chart as FRED constant-maturity yields, not as a stock. */
const TREASURY_ALIASES: Readonly<Record<string, string>> = {
  TNX: "10Y",
  "^TNX": "10Y",
  US10Y: "10Y",
  DGS10: "10Y",
  TYX: "30Y",
  "^TYX": "30Y",
  US30Y: "30Y",
  DGS30: "30Y",
  FVX: "5Y",
  "^FVX": "5Y",
  US5Y: "5Y",
  DGS5: "5Y",
  IRX: "3M",
  "^IRX": "3M",
  US13W: "3M",
  DGS3MO: "3M",
  US2Y: "2Y",
  DGS2: "2Y",
  US7Y: "7Y",
  DGS7: "7Y",
  US20Y: "20Y",
  DGS20: "20Y",
  US1Y: "1Y",
  DGS1: "1Y",
  US6M: "6M",
  DGS6MO: "6M",
  US1M: "1M",
  DGS1MO: "1M",
};

export function findTreasuryCatalogEntry(
  token: string,
): TreasuryCatalogEntry | undefined {
  const upper = token.trim().toUpperCase();
  const aliased = TREASURY_ALIASES[upper] ?? upper;
  return TREASURY_CATALOG.find((entry) => (
    entry.maturity.toUpperCase() === aliased
    || entry.seriesId.toUpperCase() === upper
  ));
}

export interface VolCatalogEntry {
  token: string;
  seriesId: string;
  label: string;
}

export const VOL_CATALOG: readonly VolCatalogEntry[] = [
  { token: "VIX", seriesId: "VIXCLS", label: "VIX" },
  { token: "VXV", seriesId: "VXVCLS", label: "VXV (3M VIX)" },
];

const VOL_ALIASES: Readonly<Record<string, string>> = {
  VIX: "VIX",
  "^VIX": "VIX",
  VIXCLS: "VIX",
  VXV: "VXV",
  "^VIX3M": "VXV",
  VIX3M: "VXV",
  VXVCLS: "VXV",
};

export function findVolCatalogEntry(token: string): VolCatalogEntry | undefined {
  const upper = token.trim().toUpperCase();
  const aliased = VOL_ALIASES[upper];
  if (!aliased) return undefined;
  return VOL_CATALOG.find((entry) => entry.token === aliased);
}

export interface CorporateYieldCatalogEntry {
  seriesId: string;
  label: string;
}

export const CORPORATE_YIELD_CATALOG: readonly CorporateYieldCatalogEntry[] = [
  { seriesId: "BAMLC0A0CMEY", label: "IG Corporate Yield" },
  { seriesId: "BAMLC0A1CAAAEY", label: "AAA Corporate Yield" },
  { seriesId: "BAMLC0A2CAAEY", label: "AA Corporate Yield" },
  { seriesId: "BAMLC0A3CAEY", label: "A Corporate Yield" },
  { seriesId: "BAMLC0A4CBBBEY", label: "BBB Corporate Yield" },
  { seriesId: "BAMLH0A0HYM2EY", label: "High Yield Corporate" },
  { seriesId: "BAMLC1A0C13YEY", label: "IG 1-3Y Corporate Yield" },
  { seriesId: "BAMLC4A0C710YEY", label: "IG 7-10Y Corporate Yield" },
];

export const CREDIT_SPREAD_CATALOG: readonly CorporateYieldCatalogEntry[] = [
  { seriesId: "BAMLC0A0CM", label: "US IG OAS" },
  { seriesId: "BAMLC0A1CAAA", label: "AAA OAS" },
  { seriesId: "BAMLC0A2CAA", label: "AA OAS" },
  { seriesId: "BAMLC0A3CA", label: "A OAS" },
  { seriesId: "BAMLC0A4CBBB", label: "BBB OAS" },
  { seriesId: "BAMLH0A0HYM2", label: "US HY OAS" },
];

// ---------------------------------------------------------------------------
// AI benchmark metrics — maps a short metric code to a display label + unit.
// ---------------------------------------------------------------------------

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

/** Well-known organizations for benchmark suggestion discoverability. */
export const BENCHMARK_ORGS: readonly string[] = [
  "OpenAI",
  "Anthropic",
  "Google",
  "Meta",
  "Mistral",
  "Amazon",
  "Cohere",
  "Microsoft",
];

// ---------------------------------------------------------------------------
// Poll subjects — common VoteHub subjects for suggestion discoverability.
// ---------------------------------------------------------------------------

export interface PollSubjectEntry {
  subject: string;
  choices: string[];
}

export const POLL_SUBJECTS: readonly PollSubjectEntry[] = [
  { subject: "Donald Trump", choices: ["Approve", "Disapprove"] },
  { subject: "Joe Biden", choices: ["Approve", "Disapprove"] },
  { subject: "Kamala Harris", choices: ["Favorable", "Unfavorable"] },
  { subject: "Donald Trump", choices: ["Favorable", "Unfavorable"] },
  { subject: "Congress", choices: ["Approve", "Disapprove"] },
];

export function findPollSubject(token: string): PollSubjectEntry | undefined {
  const lower = token.trim().toLowerCase();
  return POLL_SUBJECTS.find((entry) => entry.subject.toLowerCase() === lower);
}

// ---------------------------------------------------------------------------
// Adjacent prediction-market indices — stable IDs for suggestion + NL mapping.
// ---------------------------------------------------------------------------

export interface AdjacentIndexCatalogEntry {
  indexId: string;
  ticker: string;
  name: string;
  aliases: readonly string[];
}

export const ADJACENT_INDEX_CATALOG: readonly AdjacentIndexCatalogEntry[] = [
  {
    indexId: "red",
    ticker: "RED",
    name: "RED Index",
    aliases: ["red", "republican", "gop", "red index", "adjacent red"],
  },
  {
    indexId: "blue",
    ticker: "BLUE",
    name: "BLUE Index",
    aliases: ["blue", "democrat", "dem", "blue index", "adjacent blue"],
  },
  {
    indexId: "red-tr",
    ticker: "RED-TR",
    name: "RED Total Return",
    aliases: ["red-tr", "redtr", "red total return", "adjacent red-tr"],
  },
];

export function findAdjacentIndexCatalogEntry(
  token: string,
): AdjacentIndexCatalogEntry | undefined {
  const compact = token.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!compact) return undefined;
  return ADJACENT_INDEX_CATALOG.find((entry) => {
    if (entry.indexId.replace(/[^a-z0-9]+/g, "") === compact) return true;
    if (entry.ticker.toLowerCase().replace(/[^a-z0-9]+/g, "") === compact) return true;
    return entry.aliases.some((alias) => alias.replace(/[^a-z0-9]+/g, "") === compact);
  });
}

// ---------------------------------------------------------------------------
// Technical indicators — `IND:<id>:<param values...>:<source expression>`.
// The indicator math lives in `./indicators/`; this catalog maps each indicator
// onto a chart study kind, panel placement, and the canonical parameter order
// used to (de)serialize the `IND:` expression.
// ---------------------------------------------------------------------------

export interface IndicatorCatalogEntry {
  /** Stable lowercase id used in `IND:` expressions. */
  id: string;
  label: string;
  /** Chart study kind the indicator resolves as. */
  studyKind: ChartStudyKind;
  /** Panel the indicator draws on (`main` for overlays, a sub-panel otherwise). */
  panelId: string;
  pane: "overlay" | "sub";
  /** Canonical parameter order for positional `IND:` serialization. */
  paramOrder: readonly string[];
  defaultParams: Readonly<Record<string, number>>;
  /** Output names, in display order. */
  outputs: readonly string[];
}

export const INDICATOR_CATALOG: readonly IndicatorCatalogEntry[] = [
  {
    id: "sma",
    label: "Simple Moving Average",
    studyKind: "sma",
    panelId: "main",
    pane: "overlay",
    paramOrder: ["period"],
    defaultParams: { period: 20 },
    outputs: ["sma"],
  },
  {
    id: "ema",
    label: "Exponential Moving Average",
    studyKind: "ema",
    panelId: "main",
    pane: "overlay",
    paramOrder: ["period"],
    defaultParams: { period: 20 },
    outputs: ["ema"],
  },
  {
    id: "rsi",
    label: "Relative Strength Index",
    studyKind: "rsi",
    panelId: "rsi",
    pane: "sub",
    paramOrder: ["period"],
    defaultParams: { period: 14 },
    outputs: ["rsi"],
  },
  {
    id: "macd",
    label: "MACD",
    studyKind: "macd",
    panelId: "macd",
    pane: "sub",
    paramOrder: ["fast", "slow", "signal"],
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    outputs: ["macd", "signal", "histogram"],
  },
  {
    id: "bollinger",
    label: "Bollinger Bands",
    studyKind: "bollinger",
    panelId: "main",
    pane: "overlay",
    paramOrder: ["period", "stdDev"],
    defaultParams: { period: 20, stdDev: 2 },
    outputs: ["upper", "middle", "lower"],
  },
  {
    id: "vwap",
    label: "VWAP",
    studyKind: "vwap",
    panelId: "main",
    pane: "overlay",
    paramOrder: [],
    defaultParams: {},
    outputs: ["vwap"],
  },
  {
    id: "atr",
    label: "Average True Range",
    studyKind: "atr",
    panelId: "atr",
    pane: "sub",
    paramOrder: ["period"],
    defaultParams: { period: 14 },
    outputs: ["atr"],
  },
  {
    id: "stochastic",
    label: "Stochastic Oscillator",
    studyKind: "stochastic",
    panelId: "stochastic",
    pane: "sub",
    paramOrder: ["period", "smooth"],
    defaultParams: { period: 14, smooth: 3 },
    outputs: ["k", "d"],
  },
  {
    id: "adx",
    label: "Average Directional Index",
    studyKind: "adx",
    panelId: "adx",
    pane: "sub",
    paramOrder: ["period"],
    defaultParams: { period: 14 },
    outputs: ["adx", "plusDI", "minusDI"],
  },
];

export function findIndicatorCatalogEntry(
  id: string,
): IndicatorCatalogEntry | undefined {
  const normalized = id.trim().toLowerCase();
  return INDICATOR_CATALOG.find((entry) => entry.id === normalized);
}

export interface ParsedIndicatorExpression {
  indicatorId: string;
  params: Record<string, number>;
  /** Unparsed source expression; empty when the indicator has no source. */
  sourceExpression: string;
}

/**
 * Parse an `IND:<id>:<param values...>:<source expression>` string into its
 * indicator id, positional parameters (mapped via the catalog's canonical
 * `paramOrder`), and the remaining source expression. The source is returned
 * unparsed so {@link parseSeriesExpression} can resolve it with the full
 * series-expression grammar (security, FRED, OWID, …) without a circular
 * import. Returns `null` for an unknown indicator id.
 */
export function parseIndicatorExpression(
  value: string,
): ParsedIndicatorExpression | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts[0]?.trim().toUpperCase() !== SERIES_PREFIX.indicator) return null;
  const id = parts[1]?.trim().toLowerCase() ?? "";
  const entry = findIndicatorCatalogEntry(id);
  if (!entry) return null;
  const tail = parts.slice(2);
  const paramCount = entry.paramOrder.length;
  const paramTokens = tail.slice(0, paramCount);
  const sourceTokens = tail.slice(paramCount);
  const params: Record<string, number> = {};
  for (let index = 0; index < paramCount; index += 1) {
    const token = paramTokens[index];
    const name = entry.paramOrder[index]!;
    const parsed = token === undefined ? Number.NaN : Number(token);
    params[name] = Number.isFinite(parsed) && parsed > 0 ? parsed : entry.defaultParams[name]!;
  }
  return {
    indicatorId: entry.id,
    params,
    sourceExpression: sourceTokens.join(":").trim(),
  };
}

/**
 * Serialize an indicator expression: `IND:<id>:<param values in canonical
 * order>:<source>`. Parameter values fall back to the catalog defaults when
 * absent so the form is stable. Re-exported from the indicator library.
 */
export function buildIndicatorCatalogExpression(
  id: string,
  params: Readonly<Record<string, number>> = {},
  sourceExpression = "",
): string {
  const entry = findIndicatorCatalogEntry(id);
  if (!entry) return `IND:${id.toLowerCase()}`;
  const values = entry.paramOrder.map((name) => {
    const value = params[name];
    return Number.isFinite(value) && value! > 0 ? value : entry.defaultParams[name]!;
  });
  const head = `IND:${entry.id}${values.length > 0 ? `:${values.join(":")}` : ""}`;
  const source = sourceExpression.trim();
  return source ? `${head}:${source}` : head;
}
