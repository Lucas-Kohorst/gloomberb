import {
  getTimeSeriesField,
  listTimeSeriesFields,
} from "../../../time-series/field-catalog";
import {
  chartSeriesSourceKey,
  type ChartSeriesCatalogItem,
} from "../../../capabilities";
import type { TimeSeriesFieldDefinition } from "../../../time-series/types";
import type { SeriesTransform } from "../../../time-series/types";
import {
  FUTURES_CONTRACTS,
  FUTURES_SECTOR_LABELS,
} from "../futures/contracts";
import { TREASURY_MATURITIES } from "../yield-curve/treasury-data";
import {
  canonicalExchange,
  parsePublicTickerKey,
  publicTickerKey,
} from "../../../utils/exchanges";
import {
  parseSeriesExpression,
  type ParsedSeriesExpression,
  expressionSourceText,
  parseStudyExpression,
  parseCorrelationExpression,
  parseBinarySeriesExpression,
  formatChartStudyExpression,
  type ChartStudyExpression,
  type ParsedCorrelationExpression,
} from "./presets";
import {
  SERIES_PREFIX,
  FUTURES_CATALOG,
  TREASURY_CATALOG,
  POLL_SUBJECTS,
  ADJACENT_INDEX_CATALOG,
  CORPORATE_YIELD_CATALOG,
  CREDIT_SPREAD_CATALOG,
  type FuturesCatalogEntry,
  type TreasuryCatalogEntry,
} from "./universal-series";
import { WEATHER_STATIONS } from "../weather/stations";
import { weatherMetricLabel } from "../weather/mapping";
import {
  formatPredictionSeriesExpression,
  looksLikePredictionMarketQuery,
  normalizePredictionMarketId,
  resolvePredictionSeriesQuery,
  type PredictionMarketSearchHit,
} from "./prediction-series";
import type { ChartSeriesCatalogProvider } from "../../../types/plugin";

const CHART_LABEL_SEPARATOR = " — ";

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
  expressionText?: string;
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

function matchedDerivedMetricSpan(queryWords: readonly string[]): {
  metric: "discount";
  start: number;
  length: number;
} | null {
  const start = findContiguousWords(queryWords, ["discount"]);
  return start >= 0 ? { metric: "discount", start, length: 1 } : null;
}

function matchedIdeaMetricSpan(queryWords: readonly string[]): {
  start: number;
  length: number;
} | null {
  const phrases = [
    ["realized", "volatility"],
    ["realised", "volatility"],
    ["realized", "vol"],
    ["realised", "vol"],
    ["draw", "down"],
    ["drawdown"],
    ["correlation"],
    ["correlated"],
    ["corr"],
    ["vol"],
  ];
  let best: { start: number; length: number } | null = null;
  for (const phrase of phrases) {
    const start = findContiguousWords(queryWords, phrase);
    if (start < 0) continue;
    if (!best || phrase.length > best.length) {
      best = { start, length: phrase.length };
    }
  }
  // Keep idea-only queries in the instrument-search path. This preserves the
  // existing behavior where searched instruments provide the first leg and the
  // default instrument supplies the second one for generic ideas.
  return best && best.length < queryWords.length ? best : null;
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
  const ideaMetric = metric ? null : matchedIdeaMetricSpan(queryWords);
  const derivedMetric = metric || ideaMetric ? null : matchedDerivedMetricSpan(queryWords);
  const metricSpan = metric ?? ideaMetric ?? derivedMetric;
  const remaining = metricSpan
    ? queryWords.filter((_, index) => index < metricSpan.start || index >= metricSpan.start + metricSpan.length)
    : queryWords;
  const remainingRaw = metricSpan
    ? rawWords.filter((_, index) => index < metricSpan.start || index >= metricSpan.start + metricSpan.length)
    : rawWords;
  const remainingText = remaining
    .filter((word) => !(metric && /^(?:growth|growing|yoy|year[- ]over[- ]year)$/i.test(word)))
    .join(" ");
  const directInstrument = explicitInstrument(remainingRaw.join(" "));

  if (directInstrument) {
    return {
      directInstrument,
      instrumentQuery: "",
      metricQuery: metricSpan
        ? metric
          ? metric.field.label
          : derivedMetric
            ? "Discount"
            : ""
        : remaining.slice(1).join(" "),
    };
  }

  if (metricSpan) {
    return {
      directInstrument: null,
      instrumentQuery: remainingText,
      metricQuery: metric
        ? metric.field.label
        : derivedMetric
          ? "Discount"
          : "",
    };
  }

  return {
    directInstrument: null,
    instrumentQuery: query.trim(),
    metricQuery: "",
  };
}

export function fieldCategory(field: TimeSeriesFieldDefinition): string {
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

function resolveInstrumentQuery(
  query: string,
  searchedInstruments: readonly SeriesCatalogInstrument[],
): SeriesCatalogInstrument | null {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  const firstToken = normalized.split(/\s+/)[0] ?? "";
  const searched = searchedInstruments.find((instrument) => (
    instrument.symbol.toLowerCase() === firstToken
    || instrument.name?.toLowerCase() === normalized
    || instrument.name?.toLowerCase().startsWith(`${normalized} `)
  ));
  if (searched) return searched;
  if (
    !/^[a-z0-9^][a-z0-9.^_=-]{0,11}$/i.test(firstToken)
    || (firstToken.length > 4 && /^[a-z]+$/i.test(firstToken))
    || /^(?:cpi|gdp|pce|nfp|fred|owid|weather|climate|temp|temperature|bitcoin|ethereum|crypto|futures?|treasury|ust)$/i.test(firstToken)
  ) return null;
  return { symbol: firstToken.toUpperCase() };
}

function resolveIdeaInstrument(
  token: string,
  instruments: readonly SeriesCatalogInstrument[],
): SeriesCatalogInstrument | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  const match = instruments.find((instrument) => (
    instrument.symbol.toLowerCase() === normalized
    || instrument.name?.toLowerCase() === normalized
  ));
  if (match) return match;
  if (!/^[a-z0-9^][a-z0-9.^_=-]{0,11}$/i.test(normalized)) return null;
  return { symbol: normalized.toUpperCase() };
}

function parseCorrelationInstrumentPair(
  query: string,
  instruments: readonly SeriesCatalogInstrument[],
): [SeriesCatalogInstrument, SeriesCatalogInstrument] | null {
  const tokens = query
    .replace(/\b(?:correlation|correlated|corr(?:elation)?(?:20|50|100)?)\b/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length !== 2) return null;
  const left = resolveIdeaInstrument(tokens[0]!, instruments);
  const right = resolveIdeaInstrument(tokens[1]!, instruments);
  return left && right ? [left, right] : null;
}

function exactExpressionSuggestion(query: string): SeriesCatalogSuggestion | null {
  if (!query.includes(":")) return null;
  const expression = parseSeriesExpression(query);
  if (!expression) return null;
  switch (expression.kind) {
    case "economic":
      return {
        id: `fred:${expression.seriesId}`,
        label: expression.label ?? `FRED${CHART_LABEL_SEPARATOR}${expression.seriesId}`,
        description: "Economic series from FRED",
        detail: "FRED",
        expression,
      };
    case "capability":
      return {
        id: chartSeriesSourceKey({
          kind: "capability",
          capabilityId: expression.capabilityId,
          seriesId: expression.seriesId,
        }),
        label: expression.label ?? expression.seriesId,
        description: `Plugin series from ${expression.capabilityId}`,
        detail: "Plugin",
        expression,
      };
    case "adjacent-index":
      return adjacentIndexSuggestion(expression.indexId, expression.label ?? expression.indexId);
    case "prediction-market":
      return predictionExpressionSuggestion(expression);
    case "owid":
      return {
        id: `owid:${expression.slug}:${expression.entity}`,
        label: expression.label ?? `${expression.slug}${CHART_LABEL_SEPARATOR}${expression.entity}`,
        description: "Our World in Data grapher series",
        detail: "OWID",
        expression,
      };
    case "benchmark":
      return {
        id: `bench:${expression.selector}:${expression.metric}`,
        label: `${expression.selector}${CHART_LABEL_SEPARATOR}${expression.metric}`,
        description: "AI benchmark (point-in-time)",
        detail: "Bench",
        expression,
      };
    case "poll":
      return {
        id: `poll:${expression.subject}:${expression.choice}`,
        label: `${expression.subject}${CHART_LABEL_SEPARATOR}${expression.choice}`,
        description: "VoteHub poll series",
        detail: "Poll",
        expression,
      };
    case "weather":
      return {
        id: `wx:${expression.stationId}:${expression.metric}`,
        label: expression.label ?? `${expression.stationId}${CHART_LABEL_SEPARATOR}${expression.metric}`,
        description: expression.provider === "nws-cli"
          ? "NWS Daily Climate Report"
          : "Weather Company climate",
        detail: expression.provider === "nws-cli" ? "NWS" : "WX",
        expression,
      };
    // FUT:/UST: parse to their resolved pipeline kinds (security/economic), so
    // these branches are only reachable if the parser contract changes.
    case "future":
      return {
        id: `fut:${expression.code}`,
        label: expression.label ?? expression.name ?? expression.code,
        description: `Futures · ${expression.name ?? expression.code}`,
        detail: "FUT",
        expression,
      };
    case "treasury-yield":
      return {
        id: `ust:${expression.maturity}`,
        label: expression.label ?? `${expression.maturity} Treasury Yield`,
        description: "US Treasury yield (FRED)",
        detail: "UST",
        expression,
      };
    default: {
      const field = getTimeSeriesField(expression.fieldId);
      const instrument = publicTickerKey(expression.symbol, expression.exchange);
      const suffix = expression.transform ? `:${expression.transform}` : "";
      return {
        id: `${instrument}:${expression.fieldId}${suffix}`,
        label: expression.label
          ?? `${instrument}${CHART_LABEL_SEPARATOR}${field?.label ?? expression.fieldId}${suffix}`,
        description: field
          ? `${fieldCategory(field)} · ${fieldFrequency(field)}`
          : "Security series",
        detail: field ? fieldFrequency(field) : "Security",
        expression,
      };
    }
  }
}

function matchesAliasQuery(query: string, ...values: string[]): boolean {
  const tokens = words(query).map(compact);
  const searchable = compact(values.join(" "));
  return tokens.length > 0 && tokens.every((token) => searchable.includes(token));
}

function coreAliasSuggestions(query: string): SeriesCatalogSuggestion[] {
  const futures = FUTURES_CONTRACTS
    .filter((contract) => matchesAliasQuery(
      query,
      `FUT:${contract.code}`,
      contract.code,
      contract.name,
      `${contract.name} futures`,
      contract.sector,
      FUTURES_SECTOR_LABELS[contract.sector],
    ))
    .map((contract): SeriesCatalogSuggestion => ({
      id: `${contract.symbol}:market.ohlcv`,
      label: `FUT:${contract.code}${CHART_LABEL_SEPARATOR}${contract.name}`,
      description: `${FUTURES_SECTOR_LABELS[contract.sector]} futures`,
      detail: "Futures",
      expression: {
        kind: "security",
        symbol: contract.symbol,
        fieldId: "market.ohlcv",
        label: contract.name,
      },
    }));
  const treasuries = TREASURY_MATURITIES
    .filter((treasury) => matchesAliasQuery(
      query,
      `UST:${treasury.maturity}`,
      treasury.maturity,
      treasury.seriesId,
      `${treasury.maturity.replace("M", " month").replace("Y", " year")} US Treasury yield`,
    ))
    .map((treasury): SeriesCatalogSuggestion => ({
      id: `fred:${treasury.seriesId}`,
      label: `UST:${treasury.maturity}${CHART_LABEL_SEPARATOR}Treasury Yield`,
      description: `U.S. Treasury ${treasury.maturity} yield · FRED ${treasury.seriesId}`,
      detail: "Treasury",
      expression: {
        kind: "economic",
        provider: "fred",
        seriesId: treasury.seriesId,
        label: `${treasury.maturity} Treasury Yield`,
      },
    }));
  return [...futures, ...treasuries];
}

export function buildCapabilitySeriesSuggestions(
  items: ReadonlyArray<ChartSeriesCatalogItem & { capabilityId: string; capabilityName: string }>,
): SeriesCatalogSuggestion[] {
  return items.map((item) => ({
    id: chartSeriesSourceKey({
      kind: "capability",
      capabilityId: item.capabilityId,
      seriesId: item.seriesId,
    }),
    label: item.label,
    description: item.description ?? item.capabilityName,
    detail: item.detail ?? item.capabilityName,
    expression: {
      kind: "capability",
      capabilityId: item.capabilityId,
      seriesId: item.seriesId,
      label: item.label,
      style: item.style,
      transform: item.transform,
    },
  }));
}

function derivedMetricSuggestion(
  metric: "discount",
  instrument: SeriesCatalogInstrument,
): SeriesCatalogSuggestion {
  const instrumentLabel = publicTickerKey(instrument.symbol, instrument.exchange);
  const priceExpression = `${instrumentLabel}:price`;
  return {
    id: `derived:${metric}:${instrumentLabel}`,
    label: `${instrumentLabel}${CHART_LABEL_SEPARATOR}Discount to par`,
    description: "100 minus price",
    detail: "Derived",
    expression: {
      kind: "security",
      symbol: instrument.symbol,
      ...(instrument.exchange ? { exchange: canonicalExchange(instrument.exchange) } : {}),
      fieldId: "market.ohlcv",
    },
    expressionText: `100 - ${priceExpression}`,
  };
}

function derivedMetricForQuery(query: string): "discount" | null {
  return matchedDerivedMetricSpan(words(query))?.metric ?? null;
}

// ---------------------------------------------------------------------------
// Idea suggestions — natural-language chart requests that expand into a study
// expression or a binary expression the chart composer can run. Each idea row
// carries `expressionText` (the runnable text) plus a primary `expression` for
// single-series fallbacks, so the same row completes in the command bar and
// commits through chart-composer quick-add.
// ---------------------------------------------------------------------------

const IDEA_RELATIVE_PERFORMANCE = /\b(relative performance|relative perf|rel perf|performance vs|outperform)\b/i;
const IDEA_DRAWDOWN = /\b(drawdown|draw down|from (?:the )?(?:all.?time )?high)\b/i;
const IDEA_REALIZED_VOL = /\b(realized vol|realised vol|realized volatility|realised volatility|rvol|vol(?:atility)?)\b/i;
const IDEA_GROWTH = /\b(growth|growing|year[- ]over[- ]year|yoy)\b/i;
const IDEA_MARGIN = /\bmargins?\b/i;
const IDEA_SPECIFIC_MARGIN = /\b(gross|operating|net|fcf|free cash flow)\s+margin\b/i;
const IDEA_YIELD_CURVE = /\b(yield curve|curve spread|term spread|10s2s|10s-2s|10y.*2y|bear steepen|bull steepen)\b/i;
const IDEA_DIVIDEND_YIELD = /\b(dividend yield|div yield|dividend rate)\b/i;
const IDEA_CORRELATION = /\b(correlation|correlated|corr(?:elation)?(?:20|50|100)?)\b/i;
const IDEA_MA_DISTANCE = /\b(distance from|distance to|ma distance|sma distance|dma distance|vs (?:its |its )?(?:moving )?average|above.*average|below.*average)\b/i;

const MARGIN_FIELDS: ReadonlyArray<{ fieldId: string; label: string }> = [
  { fieldId: "fundamental.grossMargin", label: "Gross Margin" },
  { fieldId: "fundamental.operatingMargin", label: "Operating Margin" },
  { fieldId: "fundamental.netMargin", label: "Net Margin" },
  { fieldId: "fundamental.freeCashFlowMargin", label: "FCF Margin" },
];

const GROWTH_FIELDS: ReadonlyArray<{ fieldId: string; label: string; match: RegExp }> = [
  { fieldId: "fundamental.totalRevenue", label: "Revenue", match: /revenue|sales/i },
  { fieldId: "fundamental.eps", label: "EPS", match: /eps|earnings per share/i },
  { fieldId: "fundamental.freeCashFlow", label: "FCF", match: /fcf|free cash flow/i },
  { fieldId: "fundamental.netIncome", label: "Net Income", match: /net income|profit/i },
];

function instrumentLabel(instrument: SeriesCatalogInstrument): string {
  return publicTickerKey(instrument.symbol, instrument.exchange);
}

function securityExpression(
  instrument: SeriesCatalogInstrument,
  fieldId = "market.ohlcv",
  transform?: SeriesTransform,
): ParsedSeriesExpression {
  return {
    kind: "security",
    symbol: instrument.symbol,
    ...(instrument.exchange ? { exchange: canonicalExchange(instrument.exchange) } : {}),
    fieldId,
    ...(transform ? { transform } : {}),
  };
}

function parseVsPair(query: string): { left: string; right: string } | null {
  const match = /^([A-Z0-9.^]{1,12})\s+(?:vs\.?|versus)\s+([A-Z0-9.^]{1,12})(?:\s|$)/i.exec(query.trim());
  if (!match) return null;
  const left = match[1]!.toUpperCase();
  const right = match[2]!.toUpperCase();
  if (!/^[A-Z0-9.^]{1,12}$/.test(left) || !/^[A-Z0-9.^]{1,12}$/.test(right)) return null;
  return { left, right };
}

function pushIdea(
  ideas: SeriesCatalogSuggestion[],
  suggestion: SeriesCatalogSuggestion | null,
): void {
  if (suggestion && !ideas.some((entry) => entry.id === suggestion.id)) ideas.push(suggestion);
}

function relativePerformanceSuggestion(
  left: SeriesCatalogInstrument,
  right: SeriesCatalogInstrument,
): SeriesCatalogSuggestion {
  const leftLabel = instrumentLabel(left);
  const rightLabel = instrumentLabel(right);
  return {
    id: `idea:relative-performance:${leftLabel}:${rightLabel}`,
    label: `${leftLabel} / ${rightLabel}${CHART_LABEL_SEPARATOR}Relative Performance`,
    description: "Price ratio of the two series",
    detail: "Idea",
    expression: securityExpression(left),
    expressionText: `${leftLabel}:price / ${rightLabel}:price`,
  };
}

function correlationIdeaSuggestion(
  left: SeriesCatalogInstrument,
  right: SeriesCatalogInstrument,
): SeriesCatalogSuggestion {
  const leftLabel = instrumentLabel(left);
  const rightLabel = instrumentLabel(right);
  const leftExpression = securityExpression(left);
  return {
    id: `idea:correlation:${leftLabel}:${rightLabel}`,
    label: `${leftLabel} ↔ ${rightLabel}${CHART_LABEL_SEPARATOR}Correlation`,
    description: "20-day rolling return correlation",
    detail: "Idea",
    expression: leftExpression,
    expressionText: `CORR(${leftLabel}:price, ${rightLabel}:price)`,
  };
}

function correlationIdeaSuggestionFromPair(
  correlation: ParsedCorrelationExpression,
): SeriesCatalogSuggestion | null {
  if (correlation.left.kind === "constant") return null;
  const leftText = expressionSourceText(correlation.left);
  const rightText = expressionSourceText(correlation.right);
  if (leftText.includes(" ") || rightText.includes(" ")) return null;
  return {
    id: `idea:correlation:${leftText}:${rightText}`,
    label: `${leftText} ↔ ${rightText}${CHART_LABEL_SEPARATOR}Correlation`,
    description: "20-day rolling return correlation",
    detail: "Idea",
    expression: correlation.left,
    expressionText: `CORR(${leftText}, ${rightText})`,
  };
}

function drawdownSuggestion(instrument: SeriesCatalogInstrument): SeriesCatalogSuggestion {
  const label = instrumentLabel(instrument);
  return {
    id: `idea:drawdown:${label}`,
    label: `${label}${CHART_LABEL_SEPARATOR}Drawdown`,
    description: "Percent below the rolling peak",
    detail: "Study",
    expression: securityExpression(instrument),
    expressionText: `DD:${label}:price`,
  };
}

function realizedVolatilitySuggestion(instrument: SeriesCatalogInstrument): SeriesCatalogSuggestion {
  const label = instrumentLabel(instrument);
  return {
    id: `idea:realized-volatility:${label}`,
    label: `${label}${CHART_LABEL_SEPARATOR}Realized Volatility (20D annualized)`,
    description: "Annualized standard deviation of daily returns over 20 trading days",
    detail: "Study",
    expression: securityExpression(instrument),
    expressionText: `VOL:${label}:price`,
  };
}

function movingAverageDistanceSuggestion(
  instrument: SeriesCatalogInstrument,
  period: number,
  query: string,
): SeriesCatalogSuggestion {
  const label = instrumentLabel(instrument);
  const explicit = /\b200\b|\bdma\b|\b200[- ]?d\b/.test(query);
  const window = explicit || period === 200 ? 200 : period;
  const text = window === 200 ? `DIST:200:${label}:price` : `DIST:${label}:price`;
  return {
    id: `idea:ma-distance:${label}:${window}`,
    label: `${label}${CHART_LABEL_SEPARATOR}Distance from SMA(${window})`,
    description: `Percent distance from the ${window}-day moving average`,
    detail: "Study",
    expression: securityExpression(instrument),
    expressionText: text,
  };
}

function yieldSpreadSuggestion(leftMaturity: string, rightMaturity: string): SeriesCatalogSuggestion | null {
  const left = parseSeriesExpression(`UST:${leftMaturity}`);
  const right = parseSeriesExpression(`UST:${rightMaturity}`);
  if (!left || !right) return null;
  return {
    id: `idea:yield-spread:${leftMaturity}:${rightMaturity}`,
    label: `${leftMaturity} − ${rightMaturity} Treasury Spread`,
    description: `${leftMaturity} yield minus ${rightMaturity} yield`,
    detail: "Spread",
    expression: left,
    expressionText: `UST:${leftMaturity} - UST:${rightMaturity}`,
  };
}

function predictionSpreadSuggestion(
  left: PredictionMarketSearchHit,
  right: PredictionMarketSearchHit,
): SeriesCatalogSuggestion | null {
  const leftId = normalizePredictionMarketId(left.venue, left.marketId);
  const rightId = normalizePredictionMarketId(right.venue, right.marketId);
  if (!leftId || !rightId) return null;
  const leftPrefix = left.venue === "kalshi" ? "KALSHI" : "POLY";
  const rightPrefix = right.venue === "kalshi" ? "KALSHI" : "POLY";
  const leftExpression = parseSeriesExpression(`${leftPrefix}:${leftId}`);
  if (!leftExpression) return null;
  return {
    id: `idea:pm-spread:${left.venue}:${leftId}:${rightId}`,
    label: `${left.title} − ${right.title}${CHART_LABEL_SEPARATOR}Spread`,
    description: "Yes-price difference between the two markets",
    detail: "Spread",
    expression: leftExpression,
    expressionText: `${leftPrefix}:${leftId} - ${rightPrefix}:${rightId}`,
  };
}

function growthSuggestion(instrument: SeriesCatalogInstrument, fieldId: string, label: string): SeriesCatalogSuggestion {
  const instrumentKey = instrumentLabel(instrument);
  const expression = securityExpression(instrument, fieldId, "yoy");
  return {
    id: `idea:growth:${instrumentKey}:${fieldId}:yoy`,
    label: `${instrumentKey}${CHART_LABEL_SEPARATOR}${label} Growth (YoY)`,
    description: "Year-over-year percent change",
    detail: "Idea",
    expression,
  };
}

function marginSuggestion(instrument: SeriesCatalogInstrument, fieldId: string, label: string): SeriesCatalogSuggestion {
  const instrumentKey = instrumentLabel(instrument);
  const expression = securityExpression(instrument, fieldId);
  return {
    id: `idea:margin:${instrumentKey}:${fieldId}`,
    label: `${instrumentKey}${CHART_LABEL_SEPARATOR}${label}`,
    description: "Margin ratio, straight from fundamentals",
    detail: "Margin",
    expression,
  };
}

function dividendYieldSuggestion(instrument: SeriesCatalogInstrument): SeriesCatalogSuggestion {
  const label = instrumentLabel(instrument);
  const expression = securityExpression(instrument, "valuation.dividendYield");
  return {
    id: `idea:dividend-yield:${label}`,
    label: `${label}${CHART_LABEL_SEPARATOR}Dividend Yield`,
    description: "Trailing dividend yield",
    detail: "Idea",
    expression,
  };
}

function studyIdeaSuggestionFromExpression(
  study: ChartStudyExpression | null,
): SeriesCatalogSuggestion | null {
  if (!study || study.source.kind === "constant") return null;
  const text = expressionSourceText(study.source);
  const detail = study.kind === "drawdown"
    ? "Drawdown"
    : study.kind === "volatility"
      ? "Realized Vol"
      : "MA Distance";
  const title = study.kind === "drawdown"
    ? "Drawdown"
    : study.kind === "volatility"
      ? `Realized Volatility (${study.period ?? 20}D annualized)`
      : `Distance from SMA(${study.period ?? 20})`;
  return {
    id: `idea:study:${study.kind}:${text}`,
    label: `${text}${CHART_LABEL_SEPARATOR}${title}`,
    description: `${detail} study of ${text}`,
    detail,
    expression: study.source,
    expressionText: formatChartStudyExpression(study),
  };
}

function binaryIdeaSuggestion(
  binary: NonNullable<ReturnType<typeof parseBinarySeriesExpression>>,
): SeriesCatalogSuggestion | null {
  const leftText = expressionSourceText(binary.left);
  const rightText = expressionSourceText(binary.right);
  const leftExpression = binary.left.kind === "constant" ? null : binary.left;
  if (!leftExpression || leftText.includes(" ") || rightText.includes(" ")) return null;
  const bothPrediction = binary.left.kind !== "constant"
    && binary.right.kind !== "constant"
    && binary.left.kind === "prediction-market"
    && binary.right.kind === "prediction-market";
  const title = binary.studyKind === "ratio" ? "Ratio" : "Spread";
  const ideaKind = bothPrediction ? "pm-spread" : `binary-${binary.studyKind}`;
  return {
    id: `idea:${ideaKind}:${leftText}:${rightText}`,
    label: `${leftText} − ${rightText}${CHART_LABEL_SEPARATOR}${bothPrediction ? "Prediction Spread" : title}`,
    description: bothPrediction
      ? "Yes-price difference between the two markets"
      : `${leftText} ${binary.operator} ${rightText}`,
    detail: "Idea",
    expression: leftExpression,
    expressionText: binary.studyKind === "spread"
      ? `${leftText} - ${rightText}`
      : `${leftText} / ${rightText}`,
  };
}

/**
 * Builds the chart "idea" rows the shared catalog knows: relative performance,
 * drawdown, realized volatility, yield-curve and prediction-market spreads,
 * growth, margins, dividend yields, correlation, and moving-average distance.
 * Runs ahead of the plain field matrix so an idea wins for the queries that
 * name it.
 */
export function buildIdeaSuggestions(
  query: string,
  instruments: readonly SeriesCatalogInstrument[],
  searchedMarkets: readonly PredictionMarketSearchHit[] = [],
): SeriesCatalogSuggestion[] {
  const q = query.trim();
  if (!q) return [];
  const qLower = q.toLowerCase();
  const ideas: SeriesCatalogSuggestion[] = [];
  const available = instruments.length > 0 ? instruments : [{ symbol: "SPY", name: "S&P 500 ETF" }];
  const primary = available[0]!;
  const secondary = available[1] ?? { symbol: "SPY", name: "S&P 500 ETF" };

  // Explicit study / correlation / binary expressions round-trip into a row.
  const study = parseStudyExpression(q);
  if (study) pushIdea(ideas, studyIdeaSuggestionFromExpression(study));
  const correlation = !study ? parseCorrelationExpression(q) : null;
  if (correlation) pushIdea(ideas, correlationIdeaSuggestionFromPair(correlation));
  const binary = !study && !correlation ? parseBinarySeriesExpression(q) : null;
  if (binary) pushIdea(ideas, binaryIdeaSuggestion(binary));

  // `X vs Y` — the one grammar the catalog adds on top of the expression text.
  const pair = parseVsPair(q);
  if (pair) {
    const left = { symbol: pair.left };
    const right = { symbol: pair.right };
    if (IDEA_CORRELATION.test(qLower)) {
      pushIdea(ideas, correlationIdeaSuggestion(left, right));
      return ideas;
    }
    pushIdea(ideas, relativePerformanceSuggestion(left, right));
  }

  if (IDEA_DRAWDOWN.test(qLower)) {
    for (const instrument of available.slice(0, 2)) {
      pushIdea(ideas, drawdownSuggestion(instrument));
    }
  }
  if (IDEA_REALIZED_VOL.test(qLower)) {
    for (const instrument of available.slice(0, 2)) {
      pushIdea(ideas, realizedVolatilitySuggestion(instrument));
    }
  }
  if (IDEA_MA_DISTANCE.test(qLower)) {
    for (const instrument of available.slice(0, 2)) {
      pushIdea(ideas, movingAverageDistanceSuggestion(instrument, 20, qLower));
    }
  }
  if (IDEA_CORRELATION.test(qLower)) {
    pushIdea(ideas, correlationIdeaSuggestion(primary, secondary));
  }
  if (IDEA_RELATIVE_PERFORMANCE.test(qLower) || /\bperf(?:ormance)?\s+vs\b/i.test(qLower)) {
    pushIdea(ideas, relativePerformanceSuggestion(primary, secondary));
  }
  if (IDEA_GROWTH.test(qLower)) {
    const field = GROWTH_FIELDS.find((entry) => entry.match.test(qLower))
      ?? GROWTH_FIELDS[0]!;
    for (const instrument of available.slice(0, 2)) {
      pushIdea(ideas, growthSuggestion(instrument, field.fieldId, field.label));
    }
  }
  if (IDEA_MARGIN.test(qLower) && !IDEA_SPECIFIC_MARGIN.test(qLower)) {
    for (const instrument of available.slice(0, 2)) {
      for (const margin of MARGIN_FIELDS) {
        pushIdea(ideas, marginSuggestion(instrument, margin.fieldId, margin.label));
      }
    }
  }
  if (IDEA_DIVIDEND_YIELD.test(qLower)) {
    for (const instrument of available.slice(0, 2)) {
      pushIdea(ideas, dividendYieldSuggestion(instrument));
    }
  }
  if (IDEA_YIELD_CURVE.test(qLower) || /\b10y\b.*\b2y\b|\b2y\b.*\b10y\b/i.test(q)) {
    pushIdea(ideas, yieldSpreadSuggestion("10Y", "2Y"));
    pushIdea(ideas, yieldSpreadSuggestion("10Y", "3M"));
  }
  if (/\bspread\b/i.test(qLower) && searchedMarkets.length >= 2) {
    pushIdea(ideas, predictionSpreadSuggestion(searchedMarkets[0]!, searchedMarkets[1]!));
  }
  return ideas;
}

export function buildSeriesCatalogSuggestions(
  query: string,
  defaultInstrument: SeriesCatalogInstrument,
  searchedInstruments: readonly SeriesCatalogInstrument[] = [],
  limit = 8,
  searchedMarkets: readonly PredictionMarketSearchHit[] = [],
  extraSuggestions: readonly SeriesCatalogSuggestion[] = [],
): SeriesCatalogSuggestion[] {
  const exact = exactExpressionSuggestion(query.trim());
  const nl = resolvePredictionSeriesQuery(query, searchedMarkets);
  const analysis = analyzeSeriesSearchQuery(query);
  const ideaOnlyQuery = analysis.instrumentQuery.trim().toLowerCase() === query.trim().toLowerCase()
    && [
      IDEA_RELATIVE_PERFORMANCE,
      IDEA_DRAWDOWN,
      IDEA_REALIZED_VOL,
      IDEA_GROWTH,
      IDEA_MARGIN,
      IDEA_YIELD_CURVE,
      IDEA_DIVIDEND_YIELD,
      IDEA_CORRELATION,
      IDEA_MA_DISTANCE,
    ].some((pattern) => pattern.test(query));
  const correlationPair = IDEA_CORRELATION.test(query)
    ? parseCorrelationInstrumentPair(query, searchedInstruments)
    : null;
  const resolvedInstrument = analysis.directInstrument
    ?? (!ideaOnlyQuery
      && analysis.instrumentQuery
      && analysis.instrumentQuery.trim().toLowerCase() !== query.trim().toLowerCase()
      ? resolveInstrumentQuery(analysis.instrumentQuery, searchedInstruments)
      : null);
  const instruments = uniqueInstruments(
    correlationPair
      ? correlationPair
      : resolvedInstrument
      ? [resolvedInstrument]
      : analysis.instrumentQuery
        ? searchedInstruments
        : [defaultInstrument],
  );
  const namesAnInstrument = analysis.instrumentQuery
    && analysis.instrumentQuery.trim().toLowerCase() !== query.trim().toLowerCase();
  const instrumentSpecificIdea = namesAnInstrument && [
    IDEA_RELATIVE_PERFORMANCE,
    IDEA_DRAWDOWN,
    IDEA_REALIZED_VOL,
    IDEA_GROWTH,
    IDEA_MARGIN,
    IDEA_DIVIDEND_YIELD,
    IDEA_CORRELATION,
    IDEA_MA_DISTANCE,
  ].some((pattern) => pattern.test(query));
  if (instruments.length === 0 && (analysis.metricQuery || instrumentSpecificIdea)) {
    return [];
  }
  const derivedMetric = derivedMetricForQuery(query);

  const rankedFields = listTimeSeriesFields()
    .map((field) => ({ field, score: fieldScore(field, analysis.metricQuery) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.field.label.localeCompare(right.field.label));

  const suggestions: SeriesCatalogSuggestion[] = exact ? [exact] : [];
  for (const suggestion of coreAliasSuggestions(query)) {
    if (!suggestions.some((entry) => entry.id === suggestion.id)) suggestions.push(suggestion);
  }
  for (const suggestion of buildIdeaSuggestions(query, instruments, searchedMarkets)) {
    if (!suggestions.some((entry) => entry.id === suggestion.id)) suggestions.push(suggestion);
  }
  if (derivedMetric) {
    for (const instrument of instruments) {
      const suggestion = derivedMetricSuggestion(derivedMetric, instrument);
      if (!suggestions.some((entry) => entry.id === suggestion.id)) suggestions.push(suggestion);
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
        label: `${instrumentLabel}${CHART_LABEL_SEPARATOR}${field.label}`,
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
  // Adjacent indices, FRED, crypto) and live prediction/OWID hits.
  appendUniversalSuggestions(suggestions, query, limit);
  appendPredictionMarketHits(suggestions, searchedMarkets, limit);
  for (const extra of extraSuggestions) {
    if (suggestions.length >= limit) break;
    if (!suggestions.some((entry) => entry.id === extra.id)) suggestions.push(extra);
  }

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

  for (const entry of CRYPTO_CATALOG) {
    const score = universalScore(q, qCompact, [
      entry.symbol,
      entry.name,
      "crypto",
      "coin",
      "token",
    ]);
    if (score >= 0) scored.push({ suggestion: cryptoSuggestion(entry.symbol, entry.name), score });
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

  // Corporate yields and credit spreads — the other "yield" series, backed by FRED.
  for (const entry of CORPORATE_YIELD_CATALOG) {
    const score = universalScore(q, qCompact, [
      entry.label,
      entry.seriesId,
      "corporate",
      "corp",
      "yield",
      "bond",
      "credit",
      "ig",
      "junk",
      "high yield",
      "investment grade",
    ]);
    if (score >= 0) {
      scored.push({ suggestion: corporateYieldSuggestion(entry.seriesId, entry.label), score });
    }
  }
  for (const entry of CREDIT_SPREAD_CATALOG) {
    const score = universalScore(q, qCompact, [
      entry.label,
      entry.seriesId,
      "credit",
      "spread",
      "oas",
      "option adjusted",
      "corporate",
      "junk",
      "high yield",
    ]);
    if (score >= 0) {
      scored.push({ suggestion: creditSpreadSuggestion(entry.seriesId, entry.label), score });
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
        "temp",
        "temperature",
        "forecast",
      ]);
      if (score < 0) continue;
      scored.push({
        suggestion: {
          id: `wx:${station.id}:${metric}`,
          label: `WX${CHART_LABEL_SEPARATOR}${station.city} ${metric}`,
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
          label: `NWS${CHART_LABEL_SEPARATOR}${station.icao} ${metric}`,
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

function scoreQueryAgainstKeywords(query: string, queryCompact: string, keywords: string[]): number {
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

function universalScore(query: string, queryCompact: string, keywords: string[]): number {
  if (!query) return 50;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return scoreQueryAgainstKeywords(query, queryCompact, keywords);
  let total = 0;
  for (const token of tokens) {
    const score = scoreQueryAgainstKeywords(token, compact(token), keywords);
    if (score < 0) return -1;
    total += score;
  }
  return total;
}

const CRYPTO_CATALOG: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: "BTC-USD", name: "Bitcoin" },
  { symbol: "ETH-USD", name: "Ethereum" },
  { symbol: "SOL-USD", name: "Solana" },
  { symbol: "XRP-USD", name: "XRP" },
  { symbol: "DOGE-USD", name: "Dogecoin" },
];

function corporateYieldSuggestion(seriesId: string, label: string): SeriesCatalogSuggestion {
  return {
    id: `fred:${seriesId}`,
    label: `FRED${CHART_LABEL_SEPARATOR}${label}`,
    description: "Corporate bond yield from FRED",
    detail: "Corp Yield",
    expression: { kind: "economic", provider: "fred", seriesId, label },
  };
}

function creditSpreadSuggestion(seriesId: string, label: string): SeriesCatalogSuggestion {
  return {
    id: `fred:${seriesId}`,
    label: `FRED${CHART_LABEL_SEPARATOR}${label}`,
    description: "Option-adjusted credit spread from FRED",
    detail: "Credit",
    expression: { kind: "economic", provider: "fred", seriesId, label },
  };
}

function cryptoSuggestion(symbol: string, name: string): SeriesCatalogSuggestion {
  return {
    id: `crypto:${symbol}`,
    label: `${symbol}${CHART_LABEL_SEPARATOR}${name}`,
    description: "Crypto pair (Yahoo)",
    detail: "Crypto",
    expression: { kind: "security", symbol, fieldId: "market.ohlcv" },
  };
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

function pollSuggestion(subject: string, choice: string): SeriesCatalogSuggestion {
  return {
    id: `poll:${subject}:${choice}`,
    label: `${subject}${CHART_LABEL_SEPARATOR}${choice}`,
    description: "VoteHub poll series",
    detail: "Poll",
    expression: { kind: "poll", subject, choice },
  };
}

function adjacentIndexSuggestion(indexId: string, name: string): SeriesCatalogSuggestion {
  return {
    id: `adj:${indexId}`,
    label: `ADJ${CHART_LABEL_SEPARATOR}${name}`,
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
    label: `${expression.venue === "kalshi" ? "Kalshi" : "Polymarket"}${CHART_LABEL_SEPARATOR}${expression.label ?? expression.marketId}`,
    description: `${expression.venue === "kalshi" ? "Kalshi" : "Polymarket"} yes-price`,
    detail: expression.venue === "kalshi" ? "KALSHI" : "POLY",
    expression,
  };
}

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
    case "capability":
      return `CAP:${expression.capabilityId}:${expression.seriesId}`;
    default: {
      const base = `${publicTickerKey(expression.symbol, expression.exchange)}:${expression.fieldId}`;
      return expression.transform ? `${base}:${expression.transform}` : base;
    }
  }
}

const ASSIST_FIELD_NAMES = [
  "price", "close", "volume", "div", "dvd",
  "revenue", "grossProfit", "grossMargin", "operatingIncome", "netIncome", "netMargin",
  "freeCashFlow", "eps", "totalAssets", "totalDebt", "totalEquity",
  "trailingPE", "forwardPE", "pegRatio", "priceSales", "evEbitda", "priceFcf",
] as const;

export function buildChartSeriesAssistContext(
  providers: readonly ChartSeriesCatalogProvider[] = [],
): string {
  const discovered = providers.flatMap((provider) => [
    ...(provider.assist?.keywords ?? []),
    ...(provider.assist?.examples ?? []),
  ]);
  const providerContext = discovered.length > 0
    ? ` Available catalog terms and examples: ${[...new Set(discovered)].join(", ")}.`
    : "";
  return ` Chart series fields: ${ASSIST_FIELD_NAMES.join(", ")}. `
    + "Syntax: SYMBOL:field (e.g. AAPL:revenue), comma-separated for multiple series, "
    + "SYMBOL:field:transform for transforms (e.g. AAPL:revenue:yoy for growth), "
    + "A / B for a ratio, A - B for a spread, "
    + "CORR(A, B) for rolling correlation (e.g. CORR(AAPL:price, MSFT:price)), "
    + "DD:SYMBOL:price for drawdown from the rolling peak, "
    + "VOL:SYMBOL:price for 20-day realized volatility (VOL:20:SYMBOL:price for a window), "
    + "DIST:SYMBOL:price for % distance from the 20-day SMA (DIST:200:SYMBOL:price for 200), "
    + "FRED:seriesId for economic data, "
    + "ADJ:indexId for Adjacent indices and reference rates (e.g. ADJ:red, ADJ:house), "
    + "KALSHI:ticker for Kalshi yes-price (e.g. KALSHI:KXPRESPERSON), "
    + "POLY:marketId for Polymarket yes-price, "
    + "FUT:code for futures (e.g. FUT:ES), "
    + "UST:maturity for Treasury yields (e.g. UST:10Y), "
    + "BENCH:org:metric for AI benchmarks (e.g. BENCH:OpenAI:tps), "
    + "POLL:subject:choice for poll trends (e.g. POLL:Trump Approval:Approve), "
    + "WX:station:metric for Weather Company climate (e.g. WX:LAX:high), "
    + "NWS:icao:metric for NWS Daily Climate Report (e.g. NWS:KNYC:high), "
    + "OWID:slug:entity for Our World in Data (e.g. OWID:life-expectancy:USA, OWID:population:OWID_WRL), "
    + "BTC-USD:price for crypto. "
    + "LLAMA:chain:ethereum:tvl or LLAMA:protocol:aave:tvl for DefiLlama total value locked in USD; protocols also support fees and revenue. "
    + "Use G <expression> to chart or CAT <query> to browse the Data Catalog. "
    + "Natural language such as 'relative performance', 'AAPL vs MSFT', 'drawdown', "
    + "'realized volatility', 'yield curve spread', 'revenue growth', 'gross margin', "
    + "'dividend yield', 'correlation', 'distance from moving average', 'life expectancy', "
    + "'co2 emissions', 'adjacent red index', 'trump kalshi', 'cpi fred', or 'will fed cut polymarket' "
    + "maps onto those expressions."
    + providerContext;
}

const CATALOG_SERIES_PREFIX_RE = /^(FRED|ADJ|KALSHI|POLY|PM|FUT|UST|BENCH|POLL|WX|NWS|OWID|DD|VOL|DIST):|^CORR\s*\(/i;
const CATALOG_SERIES_INTENT_RE = /\b(fred|cpi|gdp|unemployment|pce|nfp|treasury|ust|owid|weather|climate|nws|temp|temperature|precip|wx|votehub|polls?|bitcoin|ethereum|crypto|llm-stats|aibench|benchmarks?|futures?|discount|premium|drawdown|draw down|realized vol|realised vol|realized volatility|realised volatility|rvol|vol(?:atility)?|relative performance|relative perf|rel perf|outperform|yield curve|curve spread|term spread|spreads?|growth|growing|year[- ]over[- ]year|yoy|margins?|dividend yield|div yield|correlation|correlated|moving average|ma distance|distance from|yields?)\b/i;

export function looksLikeOwidSeriesQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (/^owid:/i.test(trimmed)) return true;
  return /\b(owid|our world in data)\b/i.test(trimmed);
}

function looksLikeWeatherStationQuery(query: string): boolean {
  const compactQuery = compact(query);
  if (compactQuery.length < 3) return false;
  return WEATHER_STATIONS.some((station) => {
    const city = compact(station.city);
    const id = compact(station.id);
    return compactQuery.includes(city)
      || compactQuery.includes(id)
      || city.startsWith(compactQuery)
      || id.startsWith(compactQuery);
  });
}

export function looksLikeCatalogSeriesQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (/^LLAMA:|\b(defillama|tvl|total value locked)\b/i.test(trimmed)) return true;
  if (CATALOG_SERIES_PREFIX_RE.test(trimmed)) return true;
  if (looksLikePredictionMarketQuery(trimmed)) return true;
  if (looksLikeOwidSeriesQuery(trimmed)) return true;
  if (CATALOG_SERIES_INTENT_RE.test(trimmed)) return true;
  // `AAPL vs MSFT` (and only a full pair) is unambiguous relative performance.
  if (/^[A-Z0-9.^]{1,12}\s+(?:vs\.?|versus)\s+[A-Z0-9.^]{1,12}$/i.test(trimmed)) return true;
  return looksLikeWeatherStationQuery(trimmed);
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
