import { isDividendFieldId, isMarketFieldId, listTimeSeriesFields } from "../../../time-series/field-catalog";
import { parseOptionSymbol } from "../../../utils/options";
import { listKnownFredSeries } from "../econ/fred-series-map";
import {
  ARTIFICIAL_ANALYSIS_ATTRIBUTION,
  ARTIFICIAL_ANALYSIS_SITE,
  type AaModelRow,
} from "../llm-stats/types";
import { aaCatalogMetricsForRow, aaChartExpression } from "../llm-stats/normalize";
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
  type PollSubjectEntry,
} from "./universal-series";

export const DATA_CATALOG_PANE_ID = "data-catalog";
export const DATA_CATALOG_TEMPLATE_ID = "data-catalog-pane";

export type CatalogSourceId =
  | "security"
  | "option"
  | "crypto"
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
  | "options"
  | "crypto"
  | "fred"
  | "prediction"
  | "futures"
  | "ai"
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
  needsTicker?: boolean;
  fieldToken?: string;
}

export const CATALOG_FILTERS: ReadonlyArray<{ id: CatalogFilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "securities", label: "Securities" },
  { id: "options", label: "Options" },
  { id: "crypto", label: "Crypto" },
  { id: "fred", label: "FRED" },
  { id: "prediction", label: "Prediction" },
  { id: "futures", label: "Futures" },
  { id: "ai", label: "AI" },
  { id: "other", label: "Other" },
];

const FILTER_SOURCES: Record<CatalogFilterId, ReadonlySet<CatalogSourceId> | null> = {
  all: null,
  securities: new Set(["security"]),
  options: new Set(["option"]),
  crypto: new Set(["crypto"]),
  fred: new Set(["fred", "treasury"]),
  prediction: new Set(["kalshi", "polymarket"]),
  futures: new Set(["futures"]),
  ai: new Set(["benchmark"]),
  other: new Set(["adjacent", "poll"]),
};

const CRYPTO_CATALOG: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: "BTC-USD", name: "Bitcoin" },
  { symbol: "ETH-USD", name: "Ethereum" },
  { symbol: "SOL-USD", name: "Solana" },
  { symbol: "XRP-USD", name: "XRP" },
  { symbol: "BNB-USD", name: "BNB" },
  { symbol: "DOGE-USD", name: "Dogecoin" },
  { symbol: "ADA-USD", name: "Cardano" },
  { symbol: "AVAX-USD", name: "Avalanche" },
  { symbol: "LINK-USD", name: "Chainlink" },
  { symbol: "DOT-USD", name: "Polkadot" },
  { symbol: "LTC-USD", name: "Litecoin" },
  { symbol: "UNI-USD", name: "Uniswap" },
  { symbol: "ATOM-USD", name: "Cosmos" },
  { symbol: "NEAR-USD", name: "NEAR" },
  { symbol: "APT-USD", name: "Aptos" },
  { symbol: "SUI-USD", name: "Sui" },
  { symbol: "TON-USD", name: "Toncoin" },
  { symbol: "SHIB-USD", name: "Shiba Inu" },
];

export const VOTEHUB_POLL_TYPES = [
  "approval",
  "favorability",
  "generic-ballot",
  "us-senator",
  "governor",
  "us-representative",
  "mayor",
  "attorney-general",
  "presidential-primary",
  "proposition-50",
] as const;

function isOptionInstrument(instrument: SeriesCatalogInstrument): boolean {
  const category = instrument.assetCategory?.trim().toUpperCase();
  return category === "OPT" || parseOptionSymbol(instrument.symbol) != null;
}

function fieldKind(fieldId: string, option = false): string {
  if (option) return "Options";
  if (isDividendFieldId(fieldId)) return "Dividends";
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
  searchExtra?: string;
  needsTicker?: boolean;
  fieldToken?: string;
}): CatalogSeriesRow {
  const { searchExtra, ...fields } = entry;
  return {
    ...fields,
    searchText: [
      entry.label,
      entry.source,
      entry.kind,
      entry.expression,
      entry.sourceId,
      searchExtra,
    ].filter(Boolean).join(" ").toLowerCase(),
  };
}

export function isCatalogCryptoInstrument(instrument: SeriesCatalogInstrument): boolean {
  if (isOptionInstrument(instrument)) return false;
  const exchange = instrument.exchange?.trim().toUpperCase();
  if (exchange === "CCC") return true;
  const category = instrument.assetCategory?.trim().toUpperCase() ?? "";
  if (category.includes("CRYPTO") || category === "COIN" || category === "TOKEN") return true;
  return /^[A-Z0-9]{2,10}[-/]USD$/i.test(instrument.symbol.trim());
}

const COMPACT_OCC_RE = /^([A-Z]{1,6})(\d{6}[CP]\d{8})$/;

function compactOccSymbol(value: string): string | null {
  const upper = value.trim().toUpperCase();
  const compact = COMPACT_OCC_RE.exec(upper.replace(/\s+/g, ""));
  if (compact) return `${compact[1]}${compact[2]}`;
  const spaced = parseOptionSymbol(upper);
  if (!spaced) return null;
  const expiry = new Date(spaced.expTs * 1000);
  const yy = String(expiry.getUTCFullYear()).slice(2);
  const mm = String(expiry.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiry.getUTCDate()).padStart(2, "0");
  const strike = String(Math.round(spaced.strike * 1000)).padStart(8, "0");
  return `${spaced.underlying}${yy}${mm}${dd}${spaced.side}${strike}`;
}

export function catalogTickerFromInput(value: string): string | null {
  const option = compactOccSymbol(value);
  if (option) return option;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.^_/-]{0,31}$/.test(symbol) ? symbol : null;
}

export function catalogExpressionForRow(entry: CatalogSeriesRow, ticker?: string): string | null {
  if (!entry.needsTicker) return entry.expression;
  const symbol = ticker ? catalogTickerFromInput(ticker) : null;
  if (!symbol || !entry.fieldToken) return null;
  return `${symbol}:${entry.fieldToken}`;
}

function catalogSecuritySymbol(instrument: SeriesCatalogInstrument): string {
  return instrument.symbol.trim();
}

export function catalogRowUrl(row: CatalogSeriesRow): string | null {
  return row.url ?? null;
}

function isPlaceholderPredictionLabel(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^-?no qualifying event-?$/i.test(trimmed);
}

function catalogPredictionPrimaryTitle(hit: PredictionMarketSearchHit): string {
  const title = hit.title.trim();
  const event = hit.eventLabel?.trim() ?? "";
  if (!isPlaceholderPredictionLabel(event) && event) {
    if (!title || isPlaceholderPredictionLabel(title)) return event;
    if (event.toLowerCase().includes(title.toLowerCase())) return event;
    if (title.toLowerCase().includes(event.toLowerCase())) return title;
    return event.length >= title.length ? event : title;
  }
  return title || event || hit.marketId;
}

export function catalogPredictionSeriesLabel(hit: PredictionMarketSearchHit): string {
  const primary = catalogPredictionPrimaryTitle(hit);
  const outcome = hit.marketLabel?.trim() ?? "";
  if (!outcome || isPlaceholderPredictionLabel(outcome)) return primary;
  if (primary.toLowerCase().includes(outcome.toLowerCase())) return primary;
  if (/^(yes|no)$/i.test(outcome)) return primary;
  return `${primary} · ${outcome}`;
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
    const label = catalogPredictionSeriesLabel(hit);
    if (isPlaceholderPredictionLabel(label)) return [];
    return [row({
      id: `pm:${hit.venue}:${hit.marketId}`,
      label,
      source: hit.venue === "kalshi" ? "Kalshi" : "Polymarket",
      sourceId: hit.venue,
      kind: "Prediction",
      expression,
      url: hit.url ?? (hit.venue === "kalshi"
        ? `https://kalshi.com/markets/${hit.marketId}`
        : `https://polymarket.com/event/${hit.marketId}`),
      searchExtra: [hit.title, hit.eventLabel, hit.marketLabel].filter(Boolean).join(" "),
    })];
  });
}

export function catalogRowsFromAaModels(models: readonly AaModelRow[]): CatalogSeriesRow[] {
  return models.flatMap((model) => (
    aaCatalogMetricsForRow(model).map((metric) => row({
      id: `bench:${model.slug}:${metric.code}`,
      label: `${model.name} · ${metric.label}`,
      source: "Artificial Analysis",
      sourceId: "benchmark",
      kind: "Benchmark",
      expression: aaChartExpression(model, metric.code),
      url: model.url || ARTIFICIAL_ANALYSIS_SITE,
    }))
  )).map((entry) => ({
    ...entry,
    searchText: `${entry.searchText} ${ARTIFICIAL_ANALYSIS_ATTRIBUTION}`.toLowerCase(),
  }));
}

function securityFieldRows(): CatalogSeriesRow[] {
  return listTimeSeriesFields().map((field) => {
    const token = shortChartFieldToken(field.id);
    return row({
      id: `field:${field.id}`,
      label: field.label,
      source: "Yahoo",
      sourceId: "security",
      kind: fieldKind(field.id),
      expression: `TICKER:${token}`,
      needsTicker: true,
      fieldToken: token,
      searchExtra: field.shortLabel,
    });
  });
}

function optionFieldRows(): CatalogSeriesRow[] {
  return listTimeSeriesFields().flatMap((field) => {
    if (!isMarketFieldId(field.id)) return [];
    const token = shortChartFieldToken(field.id);
    return [row({
      id: `option:${field.id}`,
      label: field.label,
      source: "Yahoo",
      sourceId: "option",
      kind: "Options",
      expression: `TICKER:${token}`,
      needsTicker: true,
      fieldToken: token,
      searchExtra: `option ${field.shortLabel}`,
    })];
  });
}

function cryptoPairRow(symbol: string, name?: string): CatalogSeriesRow {
  return row({
    id: `crypto:${symbol.toUpperCase()}`,
    label: name ? `${symbol} · ${name}` : symbol,
    source: "Yahoo",
    sourceId: "crypto",
    kind: "Crypto",
    expression: `${symbol}:price`,
    searchExtra: name,
  });
}

function cryptoRows(instruments: readonly SeriesCatalogInstrument[]): CatalogSeriesRow[] {
  const seen = new Set<string>();
  const rows: CatalogSeriesRow[] = [];
  const add = (symbol: string, name?: string) => {
    const key = symbol.trim().toUpperCase().replace("/", "-");
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(cryptoPairRow(key, name));
  };
  for (const instrument of instruments) {
    if (!isCatalogCryptoInstrument(instrument)) continue;
    add(catalogSecuritySymbol(instrument), instrument.name);
  }
  for (const entry of CRYPTO_CATALOG) add(entry.symbol, entry.name);
  return rows;
}

export function catalogRowsFromAdjacentIndices(
  indices: readonly { indexId: string; name: string; ticker?: string }[],
): CatalogSeriesRow[] {
  return indices.flatMap((index) => {
    const indexId = index.indexId.trim();
    if (!indexId) return [];
    return [row({
      id: `adj:${indexId}`,
      label: `ADJ · ${index.name.trim() || index.ticker?.trim() || indexId}`,
      source: "Adjacent",
      sourceId: "adjacent",
      kind: "Index",
      expression: `ADJ:${indexId}`,
      url: "https://adjacent.markets",
      searchExtra: index.ticker,
    })];
  });
}

export function catalogPollSubjectsFromPolls(
  polls: readonly { subject: string; answers?: ReadonlyArray<{ choice: string }> }[],
): PollSubjectEntry[] {
  const bySubject = new Map<string, { subject: string; choices: Set<string> }>();
  for (const poll of polls) {
    const subject = poll.subject.trim();
    if (!subject) continue;
    let entry = bySubject.get(subject.toLowerCase());
    if (!entry) {
      entry = { subject, choices: new Set() };
      bySubject.set(subject.toLowerCase(), entry);
    }
    for (const answer of poll.answers ?? []) {
      const choice = answer.choice.trim();
      if (choice) entry.choices.add(choice);
    }
  }
  return [...bySubject.values()].flatMap((entry) => (
    entry.choices.size === 0
      ? []
      : [{ subject: entry.subject, choices: [...entry.choices] }]
  ));
}

export function catalogRowsFromPollSubjects(
  subjects: readonly PollSubjectEntry[],
): CatalogSeriesRow[] {
  return subjects.flatMap((subject) => (
    subject.choices.map((choice) => row({
      id: `poll:${subject.subject}:${choice}`,
      label: `${subject.subject} · ${choice}`,
      source: "VoteHub",
      sourceId: "poll",
      kind: "Poll",
      expression: `POLL:${subject.subject}:${choice}`,
    }))
  ));
}

export function listStaticCatalogInventory(
  instruments: readonly SeriesCatalogInstrument[] = [],
  options?: {
    pollSubjects?: readonly PollSubjectEntry[];
    adjacentIndices?: readonly { indexId: string; name: string; ticker?: string }[];
  },
): CatalogSeriesRow[] {
  const securities = securityFieldRows();
  const optionFields = optionFieldRows();
  const crypto = cryptoRows(instruments);

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
    source: "FRED",
    sourceId: "treasury",
    kind: "Treasury",
    expression: `UST:${entry.maturity}`,
    url: `https://fred.stlouisfed.org/series/${entry.seriesId}`,
  }));

  const futures = FUTURES_CATALOG.map((entry) => row({
    id: `fut:${entry.code}`,
    label: `${entry.name} (${entry.code})`,
    source: "Yahoo",
    sourceId: "futures",
    kind: entry.sectorLabel,
    expression: `FUT:${entry.code}`,
  }));

  const liveAdjacent = catalogRowsFromAdjacentIndices(options?.adjacentIndices ?? []);
  const adjacent = liveAdjacent.length > 0
    ? liveAdjacent
    : ADJACENT_INDEX_CATALOG.map((entry) => row({
      id: `adj:${entry.indexId}`,
      label: `ADJ · ${entry.name}`,
      source: "Adjacent",
      sourceId: "adjacent",
      kind: "Index",
      expression: `ADJ:${entry.indexId}`,
      url: "https://adjacent.markets",
    }));

  const polls = catalogRowsFromPollSubjects(options?.pollSubjects ?? POLL_SUBJECTS);

  const benchmarks = BENCHMARK_ORGS.flatMap((org) => (
    BENCHMARK_METRICS.map((metric) => row({
      id: `bench:${org}:${metric.code}`,
      label: `${org} · ${metric.label}`,
      source: "Artificial Analysis",
      sourceId: "benchmark",
      kind: "Benchmark",
      expression: `BENCH:${org}:${metric.code}`,
      url: ARTIFICIAL_ANALYSIS_SITE,
    }))
  )).map((entry) => ({
    ...entry,
    searchText: `${entry.searchText} ${ARTIFICIAL_ANALYSIS_ATTRIBUTION}`.toLowerCase(),
  }));

  return [
    ...securities,
    ...optionFields,
    ...crypto,
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

export function catalogEmptyCopy(loading: boolean, searchQuery: string): { title: string; hint?: string } {
  if (loading) return { title: "Loading catalog…" };
  const query = searchQuery.trim();
  if (query) return { title: `No series matching "${query}"`, hint: "Press / to search." };
  return { title: "No series", hint: "Press / to search." };
}
