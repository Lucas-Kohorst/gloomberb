import {
  getTimeSeriesField,
  listTimeSeriesFields,
} from "../../../time-series/field-catalog";
import type { TimeSeriesFieldDefinition } from "../../../time-series/types";
import {
  canonicalExchange,
  parsePublicTickerKey,
  publicTickerKey,
} from "../../../utils/exchanges";
import {
  parseSeriesExpression,
  type ParsedSeriesExpression,
} from "./presets";
import {
  SERIES_PREFIX,
  FUTURES_CATALOG,
  TREASURY_CATALOG,
  BENCHMARK_METRICS,
  BENCHMARK_ORGS,
  POLL_SUBJECTS,
  ADJACENT_INDEX_CATALOG,
  type FuturesCatalogEntry,
  type TreasuryCatalogEntry,
} from "./universal-series";
import { WEATHER_STATIONS } from "../weather/stations";
import { weatherMetricLabel } from "../weather/mapping";
import {
  OWID_CATALOG,
  matchOwidCatalogEntries,
  owidSeriesLabel,
  type OwidCatalogEntry,
} from "../owid/catalog";
import {
  formatPredictionSeriesExpression,
  normalizePredictionMarketId,
  resolvePredictionSeriesQuery,
  type PredictionMarketSearchHit,
} from "./prediction-series";

export interface SeriesCatalogInstrument {
  symbol: string;
  exchange?: string;
  name?: string;
  assetCategory?: string;
}

export interface SeriesCatalogSuggestion {
  id: string;
  label: string;
  description: string;
  detail: string;
  expression: ParsedSeriesExpression;
}

export interface SeriesSearchAnalysis {
  directInstrument: SeriesCatalogInstrument | null;
  instrumentQuery: string;
  metricQuery: string;
}

const PREFERRED_FIELD_IDS = [
  "market.ohlcv",
  "fundamental.totalRevenue",
  "fundamental.netIncome",
  "fundamental.eps",
  "fundamental.freeCashFlow",
  "market.volume",
  "market.dividends",
  "valuation.trailingPE",
  "valuation.evEbitda",
] as const;

const FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "market.ohlcv": ["stock price", "share price"],
  "market.volume": ["trading volume"],
  "market.dividends": ["dividend", "dividends", "div", "dvd"],
  "fundamental.totalRevenue": ["sales"],
  "fundamental.operatingCashFlow": ["cash from operations", "cfo"],
  "valuation.trailingPE": ["price earnings", "price to earnings"],
  "valuation.forwardPE": ["forward price earnings"],
  "valuation.priceSales": ["price to sales"],
  "valuation.evSales": ["enterprise value sales"],
  "valuation.evEbitda": ["enterprise value ebitda"],
  "valuation.priceFcf": ["price free cash flow"],
});

function words(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((token) => token.toLowerCase().replace(/[^a-z0-9^:._=-]+/g, ""))
    .filter(Boolean);
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function splitCamelCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

function fieldPhrases(field: TimeSeriesFieldDefinition): string[][] {
  const suffix = field.id.split(".").at(-1) ?? field.id;
  const values = new Set([
    field.label,
    field.shortLabel,
    splitCamelCase(suffix),
    field.id.replaceAll(".", " "),
    ...(FIELD_ALIASES[field.id] ?? []),
  ]);
  const phrases = [...values].flatMap((value) => {
    const normal = words(value);
    const joined = compact(value);
    return [
      normal,
      ...(joined.length > 1 ? [[joined]] : []),
    ];
  });
  return phrases.filter((phrase) => phrase.length > 0);
}

function findContiguousWords(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, index) => haystack[start + index] === token)) return start;
  }
  return -1;
}

function matchedMetricSpan(queryWords: readonly string[]): {
  field: TimeSeriesFieldDefinition;
  start: number;
  length: number;
} | null {
  let best: { field: TimeSeriesFieldDefinition; start: number; length: number; weight: number } | null = null;
  for (const field of listTimeSeriesFields()) {
    for (const phrase of fieldPhrases(field)) {
      const start = findContiguousWords(queryWords, phrase);
      if (start < 0) continue;
      const weight = phrase.join("").length;
      if (!best || phrase.length > best.length || (phrase.length === best.length && weight > best.weight)) {
        best = { field, start, length: phrase.length, weight };
      }
    }
  }
  return best;
}

function explicitInstrument(value: string): SeriesCatalogInstrument | null {
  const trimmed = value.trim();
  const token = trimmed.split(/\s+/)[0] ?? "";
  if (!token || token !== token.toUpperCase() || !/^[A-Z0-9^][A-Z0-9.^_=-]*(?::[A-Z0-9._-]+)?$/.test(token)) {
    return null;
  }
  const parsed = parsePublicTickerKey(token);
  return {
    symbol: parsed.symbol,
    ...(parsed.exchange ? { exchange: parsed.exchange } : {}),
  };
}

export function analyzeSeriesSearchQuery(query: string): SeriesSearchAnalysis {
  const queryWords = words(query);
  const rawWords = query.trim().split(/\s+/).filter(Boolean);
  if (queryWords.length === 0) {
    return { directInstrument: null, instrumentQuery: "", metricQuery: "" };
  }

  const metric = matchedMetricSpan(queryWords);
  const remaining = metric
    ? queryWords.filter((_, index) => index < metric.start || index >= metric.start + metric.length)
    : queryWords;
  const remainingRaw = metric
    ? rawWords.filter((_, index) => index < metric.start || index >= metric.start + metric.length)
    : rawWords;
  const remainingText = remaining.join(" ");
  const directInstrument = explicitInstrument(remainingRaw.join(" "));

  if (directInstrument) {
    return {
      directInstrument,
      instrumentQuery: "",
      metricQuery: metric
        ? metric.field.label
        : remaining.slice(1).join(" "),
    };
  }

  if (metric) {
    return {
      directInstrument: null,
      instrumentQuery: remainingText,
      metricQuery: metric.field.label,
    };
  }

  return {
    directInstrument: null,
    instrumentQuery: query.trim(),
    metricQuery: "",
  };
}

function fieldCategory(field: TimeSeriesFieldDefinition): string {
  if (field.id.startsWith("market.")) return "Market";
  if (field.id.startsWith("valuation.")) return "Valuation";
  return "Fundamentals";
}

function fieldFrequency(field: TimeSeriesFieldDefinition): string {
  return field.nativeFrequency === "auto"
    ? "Automatic"
    : `${field.nativeFrequency[0]!.toUpperCase()}${field.nativeFrequency.slice(1)}`;
}

function fieldScore(field: TimeSeriesFieldDefinition, query: string): number {
  const queryWords = words(query);
  if (queryWords.length === 0) {
    const preferredIndex = PREFERRED_FIELD_IDS.indexOf(field.id as typeof PREFERRED_FIELD_IDS[number]);
    return preferredIndex >= 0 ? 1_000 - preferredIndex : 100;
  }

  const queryCompact = compact(query);
  let best = -1;
  for (const phrase of fieldPhrases(field)) {
    const phraseText = phrase.join(" ");
    const phraseCompact = compact(phraseText);
    if (phraseCompact === queryCompact) best = Math.max(best, 2_000 + phraseCompact.length);
    else if (phraseCompact.startsWith(queryCompact)) best = Math.max(best, 1_500 + queryCompact.length);
    else if (phraseCompact.includes(queryCompact)) best = Math.max(best, 1_200 + queryCompact.length);
    else if (queryWords.every((token) => phrase.some((part) => part.startsWith(token)))) {
      best = Math.max(best, 900 + queryWords.join("").length);
    }
  }
  return best;
}

function uniqueInstruments(instruments: readonly SeriesCatalogInstrument[]): SeriesCatalogInstrument[] {
  const seen = new Set<string>();
  return instruments.filter((instrument) => {
    const key = publicTickerKey(instrument.symbol, instrument.exchange);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function exactExpressionSuggestion(query: string): SeriesCatalogSuggestion | null {
  if (!query.includes(":")) return null;
  const expression = parseSeriesExpression(query);
  if (!expression) return null;
  switch (expression.kind) {
    case "economic":
      return {
        id: `fred:${expression.seriesId}`,
        label: `FRED · ${expression.seriesId}`,
        description: "Economic series from FRED",
        detail: "FRED",
        expression,
      };
    case "adjacent-index":
      return {
        id: `adj:${expression.indexId}`,
        label: `ADJ · ${expression.indexId}`,
        description: "Adjacent prediction-market index",
        detail: "Adjacent",
        expression,
      };
    case "future":
      return {
        id: `fut:${expression.code}`,
        label: `${expression.name} (${expression.code})`,
        description: `Futures · ${expression.symbol}`,
        detail: "Futures",
        expression,
      };
    case "treasury-yield":
      return {
        id: `ust:${expression.maturity}`,
        label: `${expression.maturity} Treasury Yield`,
        description: "US Treasury yield (FRED)",
        detail: "UST",
        expression,
      };
    case "benchmark":
      return {
        id: `bench:${expression.selector}:${expression.metric}`,
        label: `${expression.selector} · ${expression.metric}`,
        description: "AI benchmark (point-in-time)",
        detail: "Bench",
        expression,
      };
    case "poll":
      return {
        id: `poll:${expression.subject}:${expression.choice}`,
        label: `${expression.subject} · ${expression.choice}`,
        description: "VoteHub poll series",
        detail: "Poll",
        expression,
      };
    case "weather":
      return {
        id: `${expression.provider}:${expression.stationId}:${expression.metric}`,
        label: `${expression.provider === "nws-cli" ? "NWS" : "WX"} · ${expression.stationId} ${expression.metric}`,
        description: expression.provider === "nws-cli"
          ? "NWS Daily Climate Report (first final CLI print)"
          : "Weather Company Kalshi climate / hourly",
        detail: expression.provider === "nws-cli" ? "NWS" : "WX",
        expression,
      };
    case "owid":
      return {
        id: `owid:${expression.slug}:${expression.entity}`,
        label: expression.label ?? `OWID · ${expression.slug} ${expression.entity}`,
        description: "Our World in Data grapher series (CC BY 4.0)",
        detail: "OWID",
        expression,
      };
    case "prediction-market":
      return {
        id: `pm:${expression.venue}:${expression.marketId}`,
        label: `${expression.venue === "kalshi" ? "Kalshi" : "Polymarket"} · ${expression.label ?? expression.marketId}`,
        description: `${expression.venue === "kalshi" ? "Kalshi" : "Polymarket"} yes-price`,
        detail: expression.venue === "kalshi" ? "KALSHI" : "POLY",
        expression,
      };
    default: {
      const field = getTimeSeriesField(expression.fieldId);
      const instrument = publicTickerKey(expression.symbol, expression.exchange);
      return {
        id: `${instrument}:${expression.fieldId}`,
        label: `${instrument} · ${field?.label ?? expression.fieldId}`,
        description: field
          ? `${fieldCategory(field)} · ${fieldFrequency(field)}`
          : "Security series",
        detail: field ? fieldFrequency(field) : "Security",
        expression,
      };
    }
  }
}

/** Renders a parsed series expression back into the SYMBOL:field / FRED:id text the chart command accepts. */
export function formatParsedSeriesExpression(expression: ParsedSeriesExpression): string {
  switch (expression.kind) {
    case "economic":
      return `FRED:${expression.seriesId}`;
    case "adjacent-index":
      return `${SERIES_PREFIX.adjacentIndex}:${expression.indexId}`;
    case "future":
      return `${SERIES_PREFIX.future}:${expression.code}`;
    case "treasury-yield":
      return `${SERIES_PREFIX.treasury}:${expression.maturity}`;
    case "benchmark":
      return `${SERIES_PREFIX.benchmark}:${expression.selector}:${expression.metric}`;
    case "poll":
      return `${SERIES_PREFIX.poll}:${expression.subject}:${expression.choice}`;
    case "weather":
      return `${expression.provider === "nws-cli" ? SERIES_PREFIX.nwsCli : SERIES_PREFIX.weather}:${expression.stationId}:${expression.metric}`;
    case "owid":
      return `${SERIES_PREFIX.owid}:${expression.slug}:${expression.entity}`;
    case "prediction-market":
      return formatPredictionSeriesExpression(expression);
    default:
      return `${publicTickerKey(expression.symbol, expression.exchange)}:${expression.fieldId}`;
  }
}

/**
 * Field names the AI assistant can drop into a `G` expression. Each is a valid
 * alias the parser resolves (a field-id suffix or an explicit alias), so the
 * assistant never has to emit the verbose `fundamental.totalRevenue` form.
 */
const ASSIST_FIELD_NAMES = [
  "price", "close", "volume", "div", "dvd",
  "revenue", "grossProfit", "grossMargin", "operatingIncome", "netIncome", "netMargin",
  "freeCashFlow", "eps", "totalAssets", "totalDebt", "totalEquity",
  "trailingPE", "forwardPE", "pegRatio", "priceSales", "evEbitda", "priceFcf",
] as const;

/**
 * Appended onto the `G` command descriptor so `/assist/command` knows the
 * series vocabulary and expression syntax, letting it map natural-language
 * chart queries ("show AAPL revenue vs MSFT revenue") onto a real expression.
 */
export function buildChartSeriesAssistContext(): string {
  return ` Chart series fields: ${ASSIST_FIELD_NAMES.join(", ")}. `
    + "Syntax: SYMBOL:field (e.g. AAPL:revenue), comma-separated for multiple series, "
    + "A / B for a ratio, A - B for a spread, FRED:seriesId for economic data, "
    + "ADJ:indexId for Adjacent indices (e.g. ADJ:red, ADJ:blue, ADJ:red-tr), "
    + "KALSHI:ticker for Kalshi yes-price (e.g. KALSHI:KXPRESPERSON), "
    + "POLY:marketId for Polymarket yes-price, "
    + "FUT:code for futures (e.g. FUT:ES), "
    + "UST:maturity for Treasury yields (e.g. UST:10Y), "
    + "BENCH:org:metric for AI benchmarks (e.g. BENCH:OpenAI:tps), "
    + "POLL:subject:choice for poll trends (e.g. POLL:Trump Approval:Approve), "
    + "WX:station:metric for Weather Company climate (e.g. WX:LAX:high), "
    + "NWS:icao:metric for NWS Daily Climate Report (e.g. NWS:KNYC:high), "
    + "OWID:slug:entity for Our World in Data (e.g. OWID:life-expectancy:USA, OWID:population:OWID_WRL). "
    + "Natural language such as 'life expectancy', 'co2 emissions', 'adjacent red index', 'trump kalshi', or 'will fed cut polymarket' maps onto those expressions.";
}

export function buildSeriesCatalogSuggestions(
  query: string,
  defaultInstrument: SeriesCatalogInstrument,
  searchedInstruments: readonly SeriesCatalogInstrument[] = [],
  limit = 8,
  searchedMarkets: readonly PredictionMarketSearchHit[] = [],
): SeriesCatalogSuggestion[] {
  const exact = exactExpressionSuggestion(query.trim());
  const nl = resolvePredictionSeriesQuery(query, searchedMarkets);
  const analysis = analyzeSeriesSearchQuery(query);
  const instruments = uniqueInstruments(
    analysis.directInstrument
      ? [analysis.directInstrument]
      : analysis.instrumentQuery
        ? searchedInstruments
        : [defaultInstrument],
  );

  const rankedFields = listTimeSeriesFields()
    .map((field) => ({ field, score: fieldScore(field, analysis.metricQuery) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.field.label.localeCompare(right.field.label));

  const suggestions: SeriesCatalogSuggestion[] = exact ? [exact] : [];
  if (nl) {
    const nlSuggestion = predictionExpressionSuggestion(nl);
    if (!suggestions.some((entry) => entry.id === nlSuggestion.id)) {
      suggestions.unshift(nlSuggestion);
    }
  }
  if (!query.includes(":") && !analysis.metricQuery) {
    for (const suggestion of [...owidCatalogSuggestions(query)].reverse()) {
      if (!suggestions.some((entry) => entry.id === suggestion.id)) {
        suggestions.unshift(suggestion);
      }
    }
  }
  const fieldLimit = instruments.length > 1 && !analysis.metricQuery ? 1 : rankedFields.length;
  for (const instrument of instruments) {
    const instrumentLabel = publicTickerKey(instrument.symbol, instrument.exchange);
    for (const { field } of rankedFields.slice(0, fieldLimit)) {
      const expression: ParsedSeriesExpression = {
        kind: "security",
        symbol: instrument.symbol,
        ...(instrument.exchange ? { exchange: canonicalExchange(instrument.exchange) } : {}),
        fieldId: field.id,
      };
      const suggestion: SeriesCatalogSuggestion = {
        id: `${instrumentLabel}:${field.id}`,
        label: `${instrumentLabel} · ${field.label}`,
        description: [
          instrument.name,
          fieldCategory(field),
          fieldFrequency(field),
        ].filter(Boolean).join(" · "),
        detail: fieldFrequency(field),
        expression,
      };
      if (!suggestions.some((entry) => entry.id === suggestion.id)) suggestions.push(suggestion);
    }
  }

  // Append universal-series suggestions (futures, treasuries, benchmarks, polls,
  // Adjacent indices) and live prediction-market hits, filling remaining slots.
  appendUniversalSuggestions(suggestions, query, limit);
  appendPredictionMarketHits(suggestions, searchedMarkets, limit);

  return suggestions.slice(0, Math.max(1, limit));
}

function appendUniversalSuggestions(
  suggestions: SeriesCatalogSuggestion[],
  query: string,
  limit: number,
): void {
  const remaining = Math.max(0, limit - suggestions.length);
  if (remaining === 0) return;
  const q = query.trim().toLowerCase();
  const qCompact = compact(q);
  const scored: Array<{ suggestion: SeriesCatalogSuggestion; score: number }> = [];

  // Futures
  for (const entry of FUTURES_CATALOG) {
    const score = universalScore(q, qCompact, [
      entry.code,
      entry.name,
      entry.symbol,
      entry.sectorLabel,
      "futures",
      "future",
    ]);
    if (score >= 0) {
      scored.push({ suggestion: futuresSuggestion(entry), score });
    }
  }

  // Treasuries
  for (const entry of TREASURY_CATALOG) {
    const score = universalScore(q, qCompact, [
      entry.maturity,
      entry.label,
      "treasury",
      "yield",
      "bond",
      "bonds",
      "ust",
    ]);
    if (score >= 0) {
      scored.push({ suggestion: treasurySuggestion(entry), score });
    }
  }

  // Benchmarks — org + metric combos
  for (const org of BENCHMARK_ORGS) {
    for (const metric of BENCHMARK_METRICS) {
      const score = universalScore(q, qCompact, [
        org,
        metric.label,
        metric.code,
        "benchmark",
        "bench",
        "ai",
        "llm",
      ]);
      if (score >= 0) {
        scored.push({ suggestion: benchmarkSuggestion(org, metric.code, metric.label), score });
      }
    }
  }

  // Polls — subject + choice combos
  for (const subject of POLL_SUBJECTS) {
    for (const choice of subject.choices) {
      const score = universalScore(q, qCompact, [
        subject.subject,
        choice,
        "poll",
        "polls",
        "votehub",
      ]);
      if (score >= 0) {
        scored.push({ suggestion: pollSuggestion(subject.subject, choice), score });
      }
    }
  }

  // Adjacent prediction-market indices
  for (const entry of ADJACENT_INDEX_CATALOG) {
    const score = universalScore(q, qCompact, [
      entry.indexId,
      entry.ticker,
      entry.name,
      ...entry.aliases,
      "adjacent",
      "index",
      "adj",
    ]);
    if (score >= 0) {
      scored.push({ suggestion: adjacentIndexSuggestion(entry.indexId, entry.name), score });
    }
  }

  for (const entry of matchOwidCatalogEntries(query)) {
    const score = universalScore(q, qCompact, [
      entry.title,
      entry.slug,
      entry.slug.replaceAll("-", " "),
      ...entry.topics.filter((topic) => topic.replace(/[^a-z0-9]+/gi, "").length >= 4),
      "owid",
      "our world in data",
    ]);
    if (score >= 0) scored.push({ suggestion: owidCatalogSuggestion(entry), score });
  }

  for (const station of WEATHER_STATIONS) {
    for (const metric of ["high", "low", "precip"] as const) {
      const score = universalScore(q, qCompact, [
        station.id,
        station.icao,
        station.city,
        metric,
        weatherMetricLabel(metric),
        "weather",
        "wx",
        "nws",
        "cli",
        "climate",
      ]);
      if (score < 0) continue;
      scored.push({
        suggestion: {
          id: `wx:${station.id}:${metric}`,
          label: `WX · ${station.city} ${metric}`,
          description: "Weather Company Kalshi climate",
          detail: "WX",
          expression: {
            kind: "weather",
            provider: "twc-kalshi",
            stationId: station.id,
            metric,
            label: `${station.id} ${weatherMetricLabel(metric)}`,
          },
        },
        score,
      });
      scored.push({
        suggestion: {
          id: `nws:${station.icao}:${metric}`,
          label: `NWS · ${station.icao} ${metric}`,
          description: "NWS Daily Climate Report (first final CLI)",
          detail: "NWS",
          expression: {
            kind: "weather",
            provider: "nws-cli",
            stationId: station.icao,
            metric,
            label: `${station.icao} NWS ${weatherMetricLabel(metric)}`,
          },
        },
        score,
      });
    }
  }

  scored.sort((left, right) => right.score - left.score);
  for (const { suggestion } of scored.slice(0, remaining)) {
    if (!suggestions.some((entry) => entry.id === suggestion.id)) {
      suggestions.push(suggestion);
    }
  }
}

function universalScore(query: string, queryCompact: string, keywords: string[]): number {
  if (!query) return 50; // show a few when the query is empty
  for (const keyword of keywords) {
    const kw = keyword.toLowerCase();
    const kwCompact = compact(kw);
    if (kwCompact === queryCompact) return 2_000 + kwCompact.length;
    if (kwCompact.startsWith(queryCompact)) return 1_500 + queryCompact.length;
    if (queryCompact.includes(kwCompact) || kwCompact.includes(queryCompact)) return 1_000 + queryCompact.length;
    for (const word of kw.split(/\s+/)) {
      if (word.startsWith(query) || query.startsWith(word)) return 800 + query.length;
    }
  }
  return -1;
}

function owidCatalogSuggestion(entry: OwidCatalogEntry): SeriesCatalogSuggestion {
  return {
    id: `owid:${entry.slug}:${entry.defaultEntity}`,
    label: owidSeriesLabel(entry.title, entry.defaultEntity, entry.defaultEntityName),
    description: "Our World in Data grapher series (CC BY 4.0)",
    detail: "OWID",
    expression: {
      kind: "owid",
      slug: entry.slug,
      entity: entry.defaultEntity,
      label: owidSeriesLabel(entry.title, entry.defaultEntity, entry.defaultEntityName),
    },
  };
}

function owidCatalogSuggestions(query: string): SeriesCatalogSuggestion[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const q = trimmed.toLowerCase();
  const qCompact = compact(q);
  const browse = /^(owid|our world in data)$/i.test(trimmed);
  const scored = OWID_CATALOG.map((entry) => ({
    entry,
    score: universalScore(q, qCompact, [
      entry.title,
      entry.slug,
      entry.slug.replaceAll("-", " "),
      ...entry.topics.filter((topic) => topic.replace(/[^a-z0-9]+/gi, "").length >= 4),
      "owid",
      "our world in data",
    ]),
  })).filter((row) => browse || row.score >= 1_000);
  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, 6).map((row) => owidCatalogSuggestion(row.entry));
}

function futuresSuggestion(entry: FuturesCatalogEntry): SeriesCatalogSuggestion {
  return {
    id: `fut:${entry.code}`,
    label: `${entry.name} (${entry.code})`,
    description: `Futures · ${entry.sectorLabel}`,
    detail: "FUT",
    expression: { kind: "future", code: entry.code, symbol: entry.symbol, name: entry.name, label: entry.name },
  };
}

function treasurySuggestion(entry: TreasuryCatalogEntry): SeriesCatalogSuggestion {
  return {
    id: `ust:${entry.maturity}`,
    label: entry.label,
    description: "US Treasury yield (FRED)",
    detail: "UST",
    expression: { kind: "treasury-yield", maturity: entry.maturity, seriesId: entry.seriesId, label: entry.label },
  };
}

function benchmarkSuggestion(org: string, metricCode: string, metricLabel: string): SeriesCatalogSuggestion {
  return {
    id: `bench:${org}:${metricCode}`,
    label: `${org} · ${metricLabel}`,
    description: "AI benchmark (point-in-time)",
    detail: "Bench",
    expression: { kind: "benchmark", selector: org, metric: metricCode },
  };
}

function pollSuggestion(subject: string, choice: string): SeriesCatalogSuggestion {
  return {
    id: `poll:${subject}:${choice}`,
    label: `${subject} · ${choice}`,
    description: "VoteHub poll series",
    detail: "Poll",
    expression: { kind: "poll", subject, choice },
  };
}

function adjacentIndexSuggestion(indexId: string, name: string): SeriesCatalogSuggestion {
  return {
    id: `adj:${indexId}`,
    label: `ADJ · ${name}`,
    description: "Adjacent prediction-market index",
    detail: "Adjacent",
    expression: { kind: "adjacent-index", indexId, label: name },
  };
}

function predictionExpressionSuggestion(
  expression: Extract<ParsedSeriesExpression, { kind: "adjacent-index" | "prediction-market" }>,
): SeriesCatalogSuggestion {
  if (expression.kind === "adjacent-index") {
    return adjacentIndexSuggestion(expression.indexId, expression.label ?? expression.indexId);
  }
  return {
    id: `pm:${expression.venue}:${expression.marketId}`,
    label: `${expression.venue === "kalshi" ? "Kalshi" : "Polymarket"} · ${expression.label ?? expression.marketId}`,
    description: `${expression.venue === "kalshi" ? "Kalshi" : "Polymarket"} yes-price`,
    detail: expression.venue === "kalshi" ? "KALSHI" : "POLY",
    expression,
  };
}

function appendPredictionMarketHits(
  suggestions: SeriesCatalogSuggestion[],
  hits: readonly PredictionMarketSearchHit[],
  limit: number,
): void {
  for (const hit of hits) {
    if (suggestions.length >= limit) return;
    const marketId = normalizePredictionMarketId(hit.venue, hit.marketId);
    if (!marketId) continue;
    const suggestion = predictionExpressionSuggestion({
      kind: "prediction-market",
      venue: hit.venue,
      marketId,
      label: hit.title,
    });
    if (!suggestions.some((entry) => entry.id === suggestion.id)) {
      suggestions.push(suggestion);
    }
  }
}
