/**
 * Static catalog data and prefix conventions for the non-security series kinds
 * chartable from `G`.  Each prefix maps to a {@link ParsedSeriesExpression}
 * kind that {@link parseSeriesExpression} recognises and
 * {@link buildSeriesCatalogSuggestions} surfaces in the command bar.
 *
 * Prefixes:
 * - `ADJ:indexId`       — Adjacent prediction-market index (50–150 scale)
 * - `KALSHI:ticker`     — Kalshi market yes-price
 * - `POLY:marketId`     — Polymarket market yes-price
 * - `FUT:code`          — Yahoo front-month futures contract (resolves as a security)
 * - `UST:maturity`      — US Treasury constant-rate yield (backed by FRED)
 * - `BENCH:selector:metric` — AI model benchmark metric at release date (scatter)
 * - `POLL:subject:choice`   — VoteHub poll percentage for a choice over time
 * - `WX:station:metric`     — Weather Company settlement obs (high/low/precip/hourly)
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
} as const;

export type PredictionMarketVenue = "kalshi" | "polymarket";

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

export function findTreasuryCatalogEntry(
  token: string,
): TreasuryCatalogEntry | undefined {
  const upper = token.trim().toUpperCase();
  return TREASURY_CATALOG.find((entry) => entry.maturity.toUpperCase() === upper);
}

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
  { code: "intelligence", label: "Intelligence Index", unit: "index", unitGroup: "intelligence" },
  { code: "coding", label: "Coding Index", unit: "index", unitGroup: "coding" },
  { code: "agentic", label: "Agentic Index", unit: "index", unitGroup: "agentic" },
  { code: "speed", label: "Output Speed", unit: "tok/s", unitGroup: "throughput" },
  { code: "ttft", label: "Time to First Token", unit: "s", unitGroup: "latency" },
  { code: "e2e", label: "End-to-end Latency", unit: "s", unitGroup: "latency" },
  { code: "input", label: "Input Price", unit: "$/1M", unitGroup: "price" },
  { code: "output", label: "Output Price", unit: "$/1M", unitGroup: "price" },
  { code: "elo", label: "Arena Elo", unit: "elo", unitGroup: "elo" },
];

const BENCHMARK_METRIC_ALIASES: Readonly<Record<string, string>> = {
  tps: "speed",
  p95: "e2e",
};

export function findBenchmarkMetric(token: string): BenchmarkMetricEntry | undefined {
  const lower = token.trim().toLowerCase();
  const code = BENCHMARK_METRIC_ALIASES[lower] ?? lower;
  return BENCHMARK_METRICS.find((entry) => entry.code === code);
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
