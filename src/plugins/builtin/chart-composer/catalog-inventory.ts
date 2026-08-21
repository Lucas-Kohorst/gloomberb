import { isDividendFieldId, isMarketFieldId, listTimeSeriesFields } from "../../../time-series/field-catalog";
import { parseOptionSymbol } from "../../../utils/options";
import { listKnownFredSeries } from "../econ/fred-series-map";
import { LLM_STATS_SITE_BASE, type LlmStatsRow } from "../llm-stats/types";
import type { PollTabId } from "../polls/types";
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
import { TWC_KALSHI_URL, type WeatherMetric } from "../weather/types";
import { WEATHER_STATIONS } from "../weather/stations";
import { weatherMetricLabel } from "../weather/mapping";
import { normalizeOwidEntityCode, pickDefaultOwidEntityCode } from "../../../sources/owid/parse";
import type { OwidChartMetadataPrint, OwidChartSearchHit } from "../../../sources/owid/types";
import {
  OWID_CATALOG,
  findOwidCatalogEntryBySlug,
  owidCatalogExpression,
  owidCatalogSearchText,
  owidGrapherUrl,
  owidSeriesLabel,
  type OwidCatalogEntry,
} from "../owid/catalog";

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
  | "benchmark"
  | "weather"
  | "owid";

export type CatalogFilterId =
  | "all"
  | "securities"
  | "options"
  | "crypto"
  | "fred"
  | "prediction"
  | "futures"
  | "ai"
  | "owid"
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
  needsEntity?: boolean;
  owidSlug?: string;
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
  { id: "owid", label: "OWID" },
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
  owid: new Set(["owid"]),
  other: new Set(["adjacent", "poll", "weather", "owid"]),
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

/** Same VoteHub tabs the Polls pane loads — keep CAT inside that rate budget. */
export const VOTEHUB_POLL_TYPES: readonly PollTabId[] = [
  "approval",
  "favorability",
  "generic-ballot",
  "us-senator",
  "governor",
  "us-representative",
];

type CatalogPollSubject = PollSubjectEntry & { url?: string };

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
  needsEntity?: boolean;
  owidSlug?: string;
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

function isCatalogFieldNameQuery(query: string): boolean {
  const lower = query.trim().toLowerCase();
  if (!lower) return false;
  return listTimeSeriesFields().some((field) => (
    field.label.toLowerCase() === lower
    || field.shortLabel.toLowerCase() === lower
    || (field.id.split(".").at(-1)?.toLowerCase() === lower)
  ));
}

/** True when CAT search should resolve a ticker without refetching live catalogs. */
export function looksLikeCatalogTickerQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes(":")) return false;
  const symbol = catalogTickerFromInput(trimmed);
  if (!symbol) return false;
  if (compactOccSymbol(trimmed) || /\d/.test(symbol) || /[-.^/_]/.test(symbol)) return true;
  if (isCatalogFieldNameQuery(trimmed)) return false;
  return symbol.length <= 6;
}

export function catalogInstrumentMatchesQuery(
  instrument: SeriesCatalogInstrument,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  if (instrument.symbol.toLowerCase().includes(needle)) return true;
  return (instrument.name ?? "").toLowerCase().includes(needle);
}

export function catalogRowsForResolvedInstruments(
  instruments: readonly SeriesCatalogInstrument[],
): CatalogSeriesRow[] {
  return instruments.flatMap((instrument) => {
    if (isCatalogCryptoInstrument(instrument)) {
      return [cryptoPairRow(catalogSecuritySymbol(instrument), instrument.name)];
    }
    if (isOptionInstrument(instrument)) {
      const symbol = compactOccSymbol(instrument.symbol)
        ?? catalogTickerFromInput(instrument.symbol);
      if (!symbol) return [];
      return listTimeSeriesFields().flatMap((field) => {
        if (!isMarketFieldId(field.id)) return [];
        const token = shortChartFieldToken(field.id);
        return [row({
          id: `option:${symbol}:${field.id}`,
          label: `${symbol} · ${field.label}`,
          source: "Yahoo",
          sourceId: "option",
          kind: "Options",
          expression: `${symbol}:${token}`,
          searchExtra: [instrument.name, "option", field.shortLabel].filter(Boolean).join(" "),
        })];
      });
    }
    const symbol = catalogTickerFromInput(instrument.symbol);
    if (!symbol) return [];
    return listTimeSeriesFields().map((field) => {
      const token = shortChartFieldToken(field.id);
      return row({
        id: `ticker:${symbol}:${field.id}`,
        label: `${symbol} · ${field.label}`,
        source: "Yahoo",
        sourceId: "security",
        kind: fieldKind(field.id),
        expression: `${symbol}:${token}`,
        searchExtra: [instrument.name, field.shortLabel].filter(Boolean).join(" "),
      });
    });
  });
}

export function catalogExpressionForRow(entry: CatalogSeriesRow, ticker?: string): string | null {
  if (entry.needsEntity) {
    const slug = entry.owidSlug?.trim();
    const entity = ticker ? normalizeOwidEntityCode(ticker) : null;
    if (!slug || !entity) return null;
    return `OWID:${slug}:${entity}`;
  }
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

function llmStatsMetricValue(model: LlmStatsRow, code: string): number | null {
  const value = (() => {
    switch (code) {
      case "tps":
        return model.avgThroughput;
      case "p95":
        return model.p95Latency;
      case "ttft":
        return model.avgTtft;
      case "latency":
        return model.avgLatency;
      case "fail":
        return model.failureRate;
      case "calls":
        return model.totalCalls;
      default:
        return null;
    }
  })();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function catalogRowsFromLlmStatsRows(models: readonly LlmStatsRow[]): CatalogSeriesRow[] {
  return models.flatMap((model) => (
    BENCHMARK_METRICS.flatMap((metric) => {
      if (llmStatsMetricValue(model, metric.code) == null) return [];
      return [row({
        id: `bench:${model.id}:${metric.code}`,
        label: `${model.displayName} · ${metric.label}`,
        source: "llm-stats.com",
        sourceId: "benchmark",
        kind: "Benchmark",
        expression: `BENCH:${model.id}:${metric.code}`,
        url: model.url || LLM_STATS_SITE_BASE,
        searchExtra: [model.organization, model.provider, "llm-stats"].join(" "),
      })];
    })
  ));
}

/** CAT discovery query for OWID search. Null skips the live origin (ticker lookups). */
export function catalogOwidDiscoveryQuery(query: string): string | null {
  const trimmed = query.trim();
  if (/^(owid|our world in data)$/i.test(trimmed)) return "";
  if (looksLikeCatalogTickerQuery(trimmed)) return null;
  return trimmed;
}

function owidCatalogRow(entry: {
  slug: string;
  title: string;
  expression: string;
  url?: string;
  needsEntity: boolean;
  searchExtra?: string;
}): CatalogSeriesRow {
  return row({
    id: `owid:${entry.slug}`,
    label: entry.title,
    source: "Our World in Data",
    sourceId: "owid",
    kind: "OWID",
    expression: entry.expression,
    url: entry.url || owidGrapherUrl(entry.slug),
    searchExtra: [
      entry.slug,
      entry.slug.replaceAll("-", " "),
      "owid",
      "our world in data",
      "cc by",
      "cc by 4.0",
      entry.searchExtra,
    ].filter(Boolean).join(" "),
    needsEntity: entry.needsEntity,
    owidSlug: entry.slug,
  });
}

export function catalogRowsFromOwidCatalog(
  entries: readonly OwidCatalogEntry[] = OWID_CATALOG,
): CatalogSeriesRow[] {
  return entries.map((entry) => owidCatalogRow({
    slug: entry.slug,
    title: owidSeriesLabel(entry.title, entry.defaultEntity, entry.defaultEntityName),
    expression: owidCatalogExpression(entry),
    searchExtra: owidCatalogSearchText(entry),
    needsEntity: false,
  }));
}

export function catalogRowsFromOwidHits(
  hits: readonly OwidChartSearchHit[],
  metadataBySlug: ReadonlyMap<string, OwidChartMetadataPrint>,
  blockedSlugs: ReadonlySet<string> = new Set(),
): CatalogSeriesRow[] {
  return hits.flatMap((hit) => {
    if (blockedSlugs.has(hit.slug)) return [];
    const metadata = metadataBySlug.get(hit.slug);
    const catalog = findOwidCatalogEntryBySlug(hit.slug);
    const entity = pickDefaultOwidEntityCode(hit.availableEntities, metadata?.entities ?? [])
      ?? catalog?.defaultEntity
      ?? null;
    const needsEntity = !entity;
    const title = metadata?.title || hit.title || catalog?.title || hit.slug;
    const entityName = entity
      ? metadata?.entities.find((row) => row.code === entity)?.name
        ?? catalog?.defaultEntityName
      : undefined;
    const expression = entity ? `OWID:${hit.slug}:${entity}` : `OWID:${hit.slug}`;
    return [owidCatalogRow({
      slug: hit.slug,
      title: entity ? owidSeriesLabel(title, entity, entityName) : title,
      expression,
      url: hit.url || metadata?.url,
      needsEntity,
      searchExtra: [
        hit.subtitle,
        metadata?.citation,
        metadata?.unit,
        catalog ? owidCatalogSearchText(catalog) : null,
        ...hit.availableEntities.slice(0, 12),
        ...(metadata?.entities ?? []).slice(0, 12).map((entry) => `${entry.code} ${entry.name}`),
      ].filter(Boolean).join(" "),
    })];
  });
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
    source: "CoinGecko",
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
      label: index.name.trim() || index.ticker?.trim() || indexId,
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
  polls: readonly {
    subject: string;
    url?: string | null;
    answers?: ReadonlyArray<{ choice: string }>;
  }[],
): CatalogPollSubject[] {
  const bySubject = new Map<string, { subject: string; choices: Set<string>; url?: string }>();
  for (const poll of polls) {
    const subject = poll.subject.trim();
    if (!subject) continue;
    let entry = bySubject.get(subject.toLowerCase());
    if (!entry) {
      entry = { subject, choices: new Set() };
      bySubject.set(subject.toLowerCase(), entry);
    }
    const pollUrl = poll.url?.trim();
    if (!entry.url && pollUrl) entry.url = pollUrl;
    for (const answer of poll.answers ?? []) {
      const choice = answer.choice.trim();
      if (choice) entry.choices.add(choice);
    }
  }
  return [...bySubject.values()].flatMap((entry) => (
    entry.choices.size === 0
      ? []
      : [{
        subject: entry.subject,
        choices: [...entry.choices],
        ...(entry.url ? { url: entry.url } : {}),
      }]
  ));
}

export function catalogRowsFromPollSubjects(
  subjects: readonly CatalogPollSubject[],
): CatalogSeriesRow[] {
  return subjects.flatMap((subject) => (
    subject.choices.map((choice) => row({
      id: `poll:${subject.subject}:${choice}`,
      label: `${subject.subject} · ${choice}`,
      source: "VoteHub",
      sourceId: "poll",
      kind: "Poll",
      expression: `POLL:${subject.subject}:${choice}`,
      ...(subject.url ? { url: subject.url } : {}),
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
    label: entry.label,
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
      label: entry.name,
      source: "Adjacent",
      sourceId: "adjacent",
      kind: "Index",
      expression: `ADJ:${entry.indexId}`,
      url: "https://adjacent.markets",
    }));

  const polls = catalogRowsFromPollSubjects(options?.pollSubjects ?? POLL_SUBJECTS);

  const weatherMetrics: WeatherMetric[] = ["high", "low", "hourly"];
  const weather = WEATHER_STATIONS.flatMap((station) => (
    weatherMetrics.map((metric) => row({
      id: `wx:${station.id}:${metric}`,
      label: `${station.city} · ${weatherMetricLabel(metric)}`,
      source: "Weather Company",
      sourceId: "weather",
      kind: metric === "hourly" ? "Hourly" : "Climate",
      expression: `WX:${station.id}:${metric}`,
      url: TWC_KALSHI_URL,
      searchExtra: [station.icao, `CLI${station.id}`, station.country, "kalshi", "twc", metric].join(" "),
    }))
  ));

  const owid = catalogRowsFromOwidCatalog();

  const nwsMetrics: WeatherMetric[] = ["high", "low"];
  const nws = WEATHER_STATIONS.filter((station) => station.scope === "domestic").flatMap((station) => (
    nwsMetrics.map((metric) => row({
      id: `nws:${station.icao}:${metric}`,
      label: `${station.city} · NWS ${weatherMetricLabel(metric)}`,
      source: "NWS",
      sourceId: "weather",
      kind: "Climate",
      expression: `NWS:${station.icao}:${metric}`,
      url: "https://www.weather.gov",
      searchExtra: [station.icao, station.id, "nws", "cli", metric].join(" "),
    }))
  ));

  const benchmarks = BENCHMARK_ORGS.flatMap((org) => (
    BENCHMARK_METRICS.map((metric) => row({
      id: `bench:${org}:${metric.code}`,
      label: `${org} · ${metric.label}`,
      source: "llm-stats.com",
      sourceId: "benchmark",
      kind: "Benchmark",
      expression: `BENCH:${org}:${metric.code}`,
      url: LLM_STATS_SITE_BASE,
      searchExtra: "llm-stats aibench",
    }))
  ));

  return [
    ...securities,
    ...optionFields,
    ...crypto,
    ...fred,
    ...treasuries,
    ...futures,
    ...adjacent,
    ...polls,
    ...weather,
    ...nws,
    ...benchmarks,
    ...owid,
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

export function catalogEmptyCopy(
  loading: boolean,
  searchQuery: string,
  error?: string | null,
): { title: string; hint?: string } {
  if (loading) return { title: "Loading catalog…" };
  if (error) return { title: error, hint: "Press r to retry." };
  const query = searchQuery.trim();
  if (query) return { title: `No series matching "${query}"`, hint: "Press / to search." };
  return { title: "No series", hint: "Press / to search." };
}
