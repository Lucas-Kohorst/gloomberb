/**
 * Static catalog data and prefix conventions for the non-security series kinds
 * chartable from `G`.  Each prefix maps to a {@link ParsedSeriesExpression}
 * kind that {@link parseSeriesExpression} recognises and
 * {@link buildSeriesCatalogSuggestions} surfaces in the command bar.
 *
 * Prefixes:
 * - `ADJ:indexId`       — Adjacent prediction-market index (50–150 scale)
 * - `FUT:code`          — Yahoo front-month futures contract (resolves as a security)
 * - `UST:maturity`      — US Treasury constant-rate yield (backed by FRED)
 * - `BENCH:selector:metric` — AI model benchmark metric at release date (scatter)
 * - `POLL:subject:choice`   — VoteHub poll percentage for a choice over time
 */

export const SERIES_PREFIX = {
  adjacentIndex: "ADJ",
  future: "FUT",
  treasury: "UST",
  benchmark: "BENCH",
  poll: "POLL",
} as const;

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
