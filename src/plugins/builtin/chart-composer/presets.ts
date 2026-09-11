import { DEFILLAMA_CAPABILITY_ID, parseDefiLlamaSeriesId, defillamaSeriesLabel } from "../defillama/catalog";
import {
  CHART_SPEC_VERSION,
  type ChartPanelSpec,
  type ChartSeriesSpec,
  type ChartSpec,
  type ChartStudyKind,
  type ChartStudySpec,
  type PanelScale,
  type SeriesAxis,
  type SeriesPeriod,
  type SeriesStyle,
  type SeriesTimestampMode,
  type SeriesTransform,
} from "../../../time-series/types";
import type { ChartResolution, TimeRange } from "../../../components/chart/core/types";
import {
  canonicalTimeSeriesFieldId,
  getTimeSeriesField,
  isFundamentalFieldId,
  listTimeSeriesFields,
} from "../../../time-series/field-catalog";
import {
  CHART_DISPLAY_TIME_ZONES,
  coerceSeriesInterpolationForStyle,
  coerceSeriesTransformForStyle,
  defaultChartSeriesPresentation,
  isOhlcSeriesStyle,
} from "../../../time-series/spec";
import { seriesSpecLabel } from "../../../time-series/series-label";
import {
  CANONICAL_EXCHANGE_ALIASES,
  canonicalExchange,
  publicTickerKey,
} from "../../../utils/exchanges";
import { MAX_CHART_COMPOSER_SERIES } from "./chart-spec";
import {
  isValidChartCapabilityId,
  isValidChartSeriesId,
} from "../../../capabilities/chart-series";
import { FUTURES_CONTRACTS } from "../futures/contracts";
import { TREASURY_MATURITIES } from "../yield-curve/treasury-data";
import {
  SERIES_PREFIX,
  findFuturesCatalogEntry,
  findTreasuryCatalogEntry,
  findVolCatalogEntry,
} from "./universal-series";
import {
  canonicalWeatherStationId,
  findWeatherStation,
} from "../weather/stations";
import {
  parseWeatherMetric,
  weatherMetricLabel,
} from "../weather/mapping";
import type { WeatherMetric, WeatherPrintProvider } from "../weather/types";
import {
  normalizePredictionMarketId,
  resolveAdjacentIndexQuery,
} from "./prediction-series";
import { normalizeOwidEntityCode, normalizeOwidSlug } from "../../../sources/owid/parse";
import {
  findOwidCatalogEntryBySlug,
  owidSeriesLabel,
} from "../owid/catalog";

const CHART_FIELD_IDS = {
  price: "market.ohlcv",
  close: "market.close",
  volume: "market.volume",
  dividends: "market.dividends",
  revenue: "fundamental.totalRevenue",
  grossProfit: "fundamental.grossProfit",
  operatingIncome: "fundamental.operatingIncome",
  netIncome: "fundamental.netIncome",
  freeCashFlow: "fundamental.freeCashFlow",
  eps: "fundamental.eps",
  trailingPE: "valuation.trailingPE",
  forwardPE: "valuation.forwardPE",
  evEbitda: "valuation.evEbitda",
} as const;

const CHART_FIELD_TOKEN_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  div: CHART_FIELD_IDS.dividends,
  dvd: CHART_FIELD_IDS.dividends,
  dividend: CHART_FIELD_IDS.dividends,
  dividends: CHART_FIELD_IDS.dividends,
});

/** Series transforms accepted as a `SYMBOL:field:transform` expression suffix. */
const SERIES_TRANSFORM_TOKENS: ReadonlySet<string> = new Set([
  "raw",
  "percent",
  "index100",
  "yoy",
  "qoq",
  "log",
]);

const SHORT_FIELD_TOKENS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries([
    ...Object.entries(CHART_FIELD_IDS).map(([token, fieldId]) => [fieldId, token]),
    [CHART_FIELD_IDS.dividends, "dvd"],
  ]),
);

/** Short token used in catalog / command-bar copy (`AAPL:dvd`, `AAPL:price`). */
export function shortChartFieldToken(fieldId: string): string {
  return SHORT_FIELD_TOKENS[fieldId] ?? fieldId.split(".").at(-1) ?? fieldId;
}

export type ConstantSeriesExpression = { kind: "constant"; value: number };

/**
 * Every chartable single series, as parsed from text by
 * {@link parseSeriesExpression}. The security variant carries an optional
 * `SYMBOL:field:transform` suffix so transforms (yoy, percent, …) are authored
 * in the same text grammar as the source series.
 */
export type ParsedSeriesExpression =
  | { kind: "security"; symbol: string; exchange?: string; fieldId: string; label?: string; transform?: SeriesTransform }
  | { kind: "economic"; provider: "fred"; seriesId: string; label?: string }
  | {
      kind: "capability";
      capabilityId: string;
      seriesId: string;
      label?: string;
      style?: SeriesStyle;
      transform?: SeriesTransform;
    }
  | { kind: "adjacent-index"; indexId: string; label?: string }
  | { kind: "future"; code: string; symbol: string; name: string; label?: string }
  | { kind: "treasury-yield"; maturity: string; seriesId: string; label?: string }
  | { kind: "benchmark"; selector: string; metric: string; label?: string }
  | { kind: "poll"; subject: string; choice: string; label?: string }
  | { kind: "weather"; provider: "twc-kalshi" | "nws-cli"; stationId: string; metric: WeatherMetric; label?: string }
  | { kind: "owid"; slug: string; entity: string; label?: string }
  | { kind: "prediction-market"; venue: "kalshi" | "polymarket"; marketId: string; label?: string };

/** A chart series expression or a plain numeric constant (used as a binary leg). */
export type SeriesOrConstant = ParsedSeriesExpression | ConstantSeriesExpression;

function normalizeBaseSymbol(value: string): string | null {
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.^_=-]{0,31}$/.test(symbol) ? symbol : null;
}

function normalizeInstrument(
  value: string,
  allowUnknownExchange = false,
): { symbol: string; exchange?: string } | null {
  const parts = value.trim().split(":");
  if (parts.length === 1) {
    const symbol = normalizeBaseSymbol(parts[0]!);
    return symbol ? { symbol } : null;
  }
  if (parts.length !== 2) return null;
  const symbol = normalizeBaseSymbol(parts[0]!);
  const exchangeToken = parts[1]!.trim().toUpperCase();
  const knownExchange = Object.prototype.hasOwnProperty.call(CANONICAL_EXCHANGE_ALIASES, exchangeToken);
  if (!symbol || !/^[A-Z0-9._-]{1,24}$/.test(exchangeToken) || (!knownExchange && !allowUnknownExchange)) {
    return null;
  }
  return { symbol, exchange: canonicalExchange(exchangeToken) };
}

export function resolveChartFieldAlias(value: string | undefined): string {
  if (!value?.trim()) return CHART_FIELD_IDS.price;
  const trimmed = value.trim();
  const alias = CHART_FIELD_TOKEN_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  const canonical = canonicalTimeSeriesFieldId(trimmed);
  if (getTimeSeriesField(canonical)) return canonical;
  const searchable = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
  const match = listTimeSeriesFields().find((field) => (
    field.id.toLowerCase().replace(/[^a-z0-9]/g, "") === searchable
    || field.label.toLowerCase().replace(/[^a-z0-9]/g, "") === searchable
    || field.shortLabel.toLowerCase().replace(/[^a-z0-9]/g, "") === searchable
  ));
  return match?.id ?? canonical;
}

export function parseSeriesExpression(value: string): ParsedSeriesExpression | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  const prefix = parts[0]?.trim().toUpperCase() ?? "";
  if (prefix === "LLAMA") {
    const identity = parseDefiLlamaSeriesId(parts.slice(1).join("/"));
    return identity ? {
      kind: "capability", capabilityId: DEFILLAMA_CAPABILITY_ID,
      seriesId: `${identity.kind}/${identity.slug}/${identity.metric}`,
      label: defillamaSeriesLabel(identity),
    } : null;
  }
  if (parts[0]?.trim().toUpperCase() === "CAP") {
    const separator = trimmed.indexOf(":", 4);
    if (separator < 0) return null;
    const capabilityId = trimmed.slice(4, separator);
    const seriesId = trimmed.slice(separator + 1);
    return isValidChartCapabilityId(capabilityId) && isValidChartSeriesId(seriesId)
      ? { kind: "capability", capabilityId, seriesId }
      : null;
  }
  if (parts[0]?.trim().toUpperCase() === "FRED") {
    const seriesId = parts.length === 2 ? parts[1]?.trim().toUpperCase() ?? "" : "";
    return /^[A-Z0-9._-]{1,80}$/.test(seriesId)
      ? { kind: "economic", provider: "fred", seriesId }
      : null;
  }
  if (parts.length === 2 && parts[0]?.trim().toUpperCase() === "FUT") {
    const code = parts[1]?.trim().toUpperCase();
    const contract = FUTURES_CONTRACTS.find((entry) => entry.code === code);
    return contract
      ? { kind: "security", symbol: contract.symbol, fieldId: CHART_FIELD_IDS.price, label: contract.name }
      : null;
  }
  if (parts.length === 2 && parts[0]?.trim().toUpperCase() === "UST") {
    const maturity = parts[1]?.trim().toUpperCase();
    const treasury = TREASURY_MATURITIES.find((entry) => entry.maturity === maturity);
    return treasury
      ? {
          kind: "economic",
          provider: "fred",
          seriesId: treasury.seriesId,
          label: `${treasury.maturity} Treasury Yield`,
        }
      : null;
  }

  // --- Universal series prefixes -----------------------------------------
  if (prefix === SERIES_PREFIX.adjacentIndex) {
    const indexId = parts.slice(1).join(":").trim().toLowerCase();
    return indexId ? { kind: "adjacent-index", indexId } : null;
  }

  if (prefix === SERIES_PREFIX.future) {
    const code = parts.slice(1).join(":").trim().toUpperCase();
    if (!code) return null;
    const entry = findFuturesCatalogEntry(code);
    if (!entry) return null;
    return { kind: "future", code: entry.code, symbol: entry.symbol, name: entry.name, label: entry.name };
  }

  if (prefix === SERIES_PREFIX.treasury) {
    const maturity = parts.slice(1).join(":").trim().toUpperCase();
    if (!maturity) return null;
    const entry = findTreasuryCatalogEntry(maturity);
    if (!entry) return null;
    return { kind: "treasury-yield", maturity: entry.maturity, seriesId: entry.seriesId, label: entry.label };
  }

  // Bare TNX / 10Y / VIX tokens should not go through Yahoo — hosted charts 429
  // after suffix-guessing, and the FRED series is the actual yield / vol print.
  if (parts.length === 1) {
    const treasury = findTreasuryCatalogEntry(trimmed);
    if (treasury) {
      return { kind: "treasury-yield", maturity: treasury.maturity, seriesId: treasury.seriesId, label: treasury.label };
    }
    const vol = findVolCatalogEntry(trimmed);
    if (vol) {
      return { kind: "economic", provider: "fred", seriesId: vol.seriesId, label: vol.label };
    }
  }

  if (prefix === SERIES_PREFIX.benchmark) {
    // BENCH:selector:metric  — selector may contain spaces; metric is the last colon segment.
    const rest = parts.slice(1).join(":");
    const lastColon = rest.lastIndexOf(":");
    if (lastColon < 0) return null;
    const selector = rest.slice(0, lastColon).trim();
    const metric = rest.slice(lastColon + 1).trim().toLowerCase();
    if (!selector || !metric) return null;
    return { kind: "benchmark", selector, metric };
  }

  if (prefix === SERIES_PREFIX.poll) {
    // POLL:subject:choice  — subject is everything between the first and last colon; choice is the last segment.
    const rest = parts.slice(1).join(":");
    const lastColon = rest.lastIndexOf(":");
    if (lastColon < 0) return null;
    const subject = rest.slice(0, lastColon).trim();
    const choice = rest.slice(lastColon + 1).trim();
    if (!subject || !choice) return null;
    return { kind: "poll", subject, choice };
  }

  if (prefix === SERIES_PREFIX.weather || prefix === SERIES_PREFIX.nwsCli) {
    if (parts.length < 3) return null;
    const provider: WeatherPrintProvider = prefix === SERIES_PREFIX.nwsCli ? "nws-cli" : "twc-kalshi";
    const metric = parseWeatherMetric(parts.slice(2).join(":"));
    if (!metric) return null;
    if (provider === "nws-cli") {
      if (metric === "hourly") return null;
      const station = findWeatherStation(parts[1] ?? "");
      const icao = station?.icao ?? (parts[1] ?? "").trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(icao)) return null;
      return {
        kind: "weather",
        provider,
        stationId: icao,
        metric,
        label: `${icao} NWS ${weatherMetricLabel(metric)}`,
      };
    }
    const stationId = canonicalWeatherStationId(parts[1] ?? "");
    if (!stationId) return null;
    return {
      kind: "weather",
      provider,
      stationId,
      metric,
      label: `${stationId} ${weatherMetricLabel(metric)}`,
    };
  }

  if (prefix === SERIES_PREFIX.owid) {
    const rest = parts.slice(1).join(":");
    const lastColon = rest.lastIndexOf(":");
    if (lastColon < 0) return null;
    const slug = normalizeOwidSlug(rest.slice(0, lastColon));
    const entity = normalizeOwidEntityCode(rest.slice(lastColon + 1));
    if (!slug || !entity) return null;
    const catalog = findOwidCatalogEntryBySlug(slug);
    const title = catalog?.title ?? slug.replaceAll("-", " ");
    return {
      kind: "owid",
      slug,
      entity,
      label: owidSeriesLabel(
        title,
        entity,
        catalog?.defaultEntity === entity ? catalog.defaultEntityName : undefined,
      ),
    };
  }

  if (prefix === SERIES_PREFIX.kalshi) {
    const marketId = normalizePredictionMarketId("kalshi", parts.slice(1).join(":"));
    return marketId ? { kind: "prediction-market", venue: "kalshi", marketId } : null;
  }

  if (prefix === SERIES_PREFIX.polymarket) {
    const marketId = normalizePredictionMarketId("polymarket", parts.slice(1).join(":"));
    return marketId ? { kind: "prediction-market", venue: "polymarket", marketId } : null;
  }

  if (prefix === SERIES_PREFIX.predictionMarket) {
    const rest = parts.slice(1).join(":");
    const venueSep = rest.indexOf(":");
    if (venueSep < 0) return null;
    const venueToken = rest.slice(0, venueSep).trim().toLowerCase();
    const venue = venueToken === "kalshi" || venueToken === "polymarket" ? venueToken : null;
    if (!venue) return null;
    const marketId = normalizePredictionMarketId(venue, rest.slice(venueSep + 1));
    return marketId ? { kind: "prediction-market", venue, marketId } : null;
  }

  let instrument: { symbol: string; exchange?: string } | null = null;
  let fieldId: string = CHART_FIELD_IDS.price;
  let transform: SeriesTransform | undefined;
  if (parts.length === 1) {
    instrument = normalizeInstrument(trimmed);
  } else if (parts.length === 2) {
    const candidateFieldId = resolveChartFieldAlias(parts[1]);
    if (getTimeSeriesField(candidateFieldId)) {
      instrument = normalizeInstrument(parts[0]!);
      fieldId = candidateFieldId;
    } else {
      // A known public exchange suffix is unambiguously a qualified ticker.
      instrument = normalizeInstrument(trimmed);
    }
  } else if (parts.length === 3) {
    // `SYMBOL:field:transform` (e.g. AAPL:revenue:yoy for growth). The middle
    // segment is a field alias and the last a series transform; this must not
    // shadow the exchange-qualified form `SYMBOL:EXCH:field` below.
    const fieldCandidate = resolveChartFieldAlias(parts[1]);
    const transformToken = parts[2]?.trim().toLowerCase();
    if (
      getTimeSeriesField(fieldCandidate)
      && transformToken
      && SERIES_TRANSFORM_TOKENS.has(transformToken)
    ) {
      instrument = normalizeInstrument(parts[0]!);
      fieldId = fieldCandidate;
      transform = transformToken as SeriesTransform;
    } else {
      const candidateFieldId = resolveChartFieldAlias(parts[2]);
      if (getTimeSeriesField(candidateFieldId)) {
        instrument = normalizeInstrument(`${parts[0]}:${parts[1]}`, true);
        fieldId = candidateFieldId;
      }
    }
  } else if (parts.length === 4) {
    // Exchange-qualified transformed fields use
    // `SYMBOL:EXCH:field:transform`, which is the formatted form emitted for
    // catalog suggestions whose instrument carries an exchange.
    const candidateFieldId = resolveChartFieldAlias(parts[2]);
    const transformToken = parts[3]?.trim().toLowerCase();
    if (
      getTimeSeriesField(candidateFieldId)
      && transformToken
      && SERIES_TRANSFORM_TOKENS.has(transformToken)
    ) {
      instrument = normalizeInstrument(`${parts[0]}:${parts[1]}`, true);
      fieldId = candidateFieldId;
      transform = transformToken as SeriesTransform;
    }
  }
  if (!instrument) return null;
  if (!getTimeSeriesField(fieldId)) return null;
  return transform
    ? { kind: "security", ...instrument, fieldId, transform }
    : { kind: "security", ...instrument, fieldId };
}

/**
 * Parses a two-series binary expression like `AAPL:price / AAPL:revenue` into
 * its legs and the pair-study kind that combines them. `/` maps to a ratio
 * study and `-` to a spread study (both already supported by the resolver).
 * `*` and `+` are recognized but not yet supported. Returns null when the
 * expression is not a binary combination.
 */
export type BinarySeriesOperator = "/" | "-";

export interface ParsedBinarySeriesExpression {
  left: SeriesOrConstant;
  right: SeriesOrConstant;
  operator: BinarySeriesOperator;
  studyKind: "ratio" | "spread";
}

export function parseConstantExpression(value: string): ConstantSeriesExpression | null {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? { kind: "constant", value: parsed } : null;
}

function parseSeriesOrConstant(value: string): SeriesOrConstant | null {
  return parseConstantExpression(value) ?? parseSeriesExpression(value);
}

export function parseBinarySeriesExpression(value: string): ParsedBinarySeriesExpression | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // `/` never appears inside a valid series token, so it's safe to split on
  // without requiring surrounding whitespace.
  const slashMatch = /^(.+?)\s*\/\s*(.+)$/.exec(trimmed);
  if (slashMatch) {
    const left = parseSeriesOrConstant(slashMatch[1]!.trim());
    const right = parseSeriesOrConstant(slashMatch[2]!.trim());
    if (left && right) return { left, right, operator: "/", studyKind: "ratio" };
  }
  // `-` can appear inside symbols/exchange codes, so require surrounding
  // whitespace to avoid mis-splitting `3HNX:LSE`-style tokens.
  const dashMatch = /^(.+?)\s+-\s+(.+)$/.exec(trimmed);
  if (dashMatch) {
    const left = parseSeriesOrConstant(dashMatch[1]!.trim());
    const right = parseSeriesOrConstant(dashMatch[2]!.trim());
    if (left && right) return { left, right, operator: "-", studyKind: "spread" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Study expressions — `DD:`, `VOL:`, `DIST:` derive a single study from one
// source series, and `CORR(a, b)` derives a rolling correlation from two. They
// reuse the study kinds the chart resolver already implements (drawdown,
// volatility, distance, correlation) without new math or new spec types.
// ---------------------------------------------------------------------------

export type ChartStudyKindName = "drawdown" | "volatility" | "distance";

export type ChartStudyExpression =
  | { kind: "drawdown"; source: SeriesOrConstant }
  | { kind: "volatility"; period?: number; source: SeriesOrConstant }
  | { kind: "distance"; period?: number; source: SeriesOrConstant };

const STUDY_PREFIX_TO_KIND: Readonly<Record<string, ChartStudyKindName>> = {
  [SERIES_PREFIX.drawdown]: "drawdown",
  [SERIES_PREFIX.volatility]: "volatility",
  [SERIES_PREFIX.distance]: "distance",
} as const;

/** Default realized-volatility / SMA-distance window when the expression omits one. */
export const DEFAULT_STUDY_PERIOD = 20;

const STUDY_EXPRESSION_RE = /^(DD|VOL|DIST):(.+)$/i;

function parseStudyPeriodToken(tail: string): { period: number; source: string } | null {
  const match = /^(\d{1,3})[:\s]\s*(.+)$/.exec(tail);
  if (!match) return null;
  const period = Number(match[1]!);
  if (!Number.isInteger(period) || period <= 0 || period > 500) return null;
  return { period, source: match[2]!.trim() };
}

/**
 * Parse a study expression:
 * - `DD:<source>` — drawdown from the rolling peak
 * - `VOL:<source>` / `VOL:<period>:<source>` — rolling realized volatility
 * - `DIST:<source>` / `DIST:<period>:<source>` — % distance from the SMA
 * The source uses the full series-expression grammar (security with optional
 * transform, FRED, UST, KALSHI, …) or a numeric constant.
 */
export function parseStudyExpression(value: string): ChartStudyExpression | null {
  const match = STUDY_EXPRESSION_RE.exec(value.trim());
  if (!match) return null;
  const kind = STUDY_PREFIX_TO_KIND[match[1]!.toUpperCase()];
  if (!kind || kind === "drawdown") {
    const source = parseSeriesOrConstant(match[2]!.trim());
    return source ? { kind: "drawdown", source } : null;
  }
  const tail = match[2]!.trim();
  const parsed = parseStudyPeriodToken(tail);
  const source = parseSeriesOrConstant(parsed?.source ?? tail);
  if (!source) return null;
  return {
    kind,
    ...(parsed && parsed.period !== DEFAULT_STUDY_PERIOD ? { period: parsed.period } : {}),
    source,
  };
}

export function formatChartStudyExpression(
  study: ChartStudyExpression,
): string {
  const prefix = study.kind === "drawdown"
    ? SERIES_PREFIX.drawdown
    : study.kind === "volatility"
      ? SERIES_PREFIX.volatility
      : SERIES_PREFIX.distance;
  const head = study.kind !== "drawdown" && study.period
    ? `${prefix}:${study.period}:`
    : `${prefix}:`;
  return `${head}${expressionSourceText(study.source)}`;
}

/** Formats any parseable source leg back into command-bar text. */
export function expressionSourceText(expression: SeriesOrConstant): string {
  if (expression.kind === "constant") return String(expression.value);
  switch (expression.kind) {
    case "economic":
      return `FRED:${expression.seriesId}`;
    case "capability":
      return `CAP:${expression.capabilityId}:${expression.seriesId}`;
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
      return `${expression.venue === "kalshi" ? "KALSHI" : "POLY"}:${expression.marketId}`;
    case "security":
      return formatSecurityExpressionText(expression);
  }
}

function formatSecurityExpressionText(expression: Extract<ParsedSeriesExpression, { kind: "security" }>): string {
  const base = `${publicTickerKey(expression.symbol, expression.exchange)}:${expression.fieldId}`;
  return expression.transform ? `${base}:${expression.transform}` : base;
}

export interface ParsedCorrelationExpression {
  left: SeriesOrConstant;
  right: SeriesOrConstant;
}

/**
 * Parse `CORR(<left>, <right>)` into the two legs. The surrounding parens make
 * the comma unambiguous against the multi-series list separator.
 */
export function parseCorrelationExpression(value: string): ParsedCorrelationExpression | null {
  const match = /^CORR\s*\(\s*(.+?)\s*,\s*(.+?)\s*\)$/i.exec(value.trim());
  if (!match) return null;
  const left = parseSeriesOrConstant(match[1]!.trim());
  const right = parseSeriesOrConstant(match[2]!.trim());
  return left && right ? { left, right } : null;
}

export function formatCorrelationExpression(correlation: ParsedCorrelationExpression): string {
  return `CORR(${expressionSourceText(correlation.left)}, ${expressionSourceText(correlation.right)})`;
}

export function isChartIdeaExpression(value: string): boolean {
  const trimmed = value.trim();
  return STUDY_EXPRESSION_RE.test(trimmed) || /^CORR\s*\(/i.test(trimmed);
}

export function parseChartExpression(value: string): ParsedSeriesExpression[] {
  if (!value.trim()) return [];

  const legs = value.split(/[;,\n]/);
  if (legs.length > MAX_CHART_COMPOSER_SERIES) {
    throw new Error(`Charts support up to ${MAX_CHART_COMPOSER_SERIES} base series.`);
  }

  return legs.map((leg) => {
    const parsed = parseSeriesExpression(leg) ?? resolveAdjacentIndexQuery(leg.trim());
    if (parsed) return parsed;
    const display = leg.trim() || "empty series";
    throw new Error(
      `Invalid chart series "${display}". Use SYMBOL, SYMBOL:field, FUT:code, UST:maturity, FRED:series, or CAP:capability-id:series-id.`,
    );
  });
}

export function formatSeriesExpression(series: ChartSeriesSpec): string {
  const source = series.source;
  switch (source.kind) {
    case "economic":
      return `FRED:${source.seriesId}`;
    case "capability":
      return `CAP:${source.capabilityId}:${source.seriesId}`;
    case "prediction-market":
      return `${source.venue === "kalshi" ? "KALSHI" : "POLY"}:${source.marketId}`;
    case "adjacent-index":
      return `${SERIES_PREFIX.adjacentIndex}:${source.indexId}`;
    case "benchmark":
      return `${SERIES_PREFIX.benchmark}:${source.selector}:${source.metric}`;
    case "poll":
      return `${SERIES_PREFIX.poll}:${source.subject}:${source.choice}`;
    case "weather":
      return `${source.provider === "nws-cli" ? SERIES_PREFIX.nwsCli : SERIES_PREFIX.weather}:${source.stationId}:${source.metric}`;
    case "owid":
      return `${SERIES_PREFIX.owid}:${source.slug}:${source.entity}`;
    case "constant":
      return String(source.value);
    case "security": {
      const base = `${publicTickerKey(source.instrument.symbol, source.instrument.exchange)}:${source.fieldId}`;
      return series.transform && series.transform !== "raw" ? `${base}:${series.transform}` : base;
    }
  }
}

export function chartSeriesLabel(series: ChartSeriesSpec): string {
  return seriesSpecLabel(series);
}

export function getCompatibleSeriesStyles(fieldId: string): SeriesStyle[] {
  return getTimeSeriesField(fieldId)?.styles ?? ["line", "area", "step", "columns", "points"];
}

export function getCompatibleSeriesTransforms(fieldId: string): SeriesTransform[] {
  return getTimeSeriesField(fieldId)?.transforms ?? ["raw", "percent", "index100", "yoy", "qoq", "log"];
}

export function defaultFinancialTimestampMode(fieldId: string): SeriesTimestampMode | null {
  const canonical = canonicalTimeSeriesFieldId(fieldId);
  if (canonical.startsWith("fundamental.")) return "period-end";
  if (canonical.startsWith("valuation.")) return "available-at";
  return null;
}

export function applySeriesTimestampMode(
  series: ChartSeriesSpec,
  timestampMode: SeriesTimestampMode,
): ChartSeriesSpec {
  if (series.source.kind !== "security" || !isFundamentalFieldId(series.source.fieldId)) {
    return series;
  }
  return {
    ...series,
    source: { ...series.source, timestampMode },
  };
}

/** Apply visual invariants without changing the series' authored time basis. */
export function applySeriesStyle(series: ChartSeriesSpec, style: SeriesStyle): ChartSeriesSpec {
  return {
    ...series,
    style,
    transform: coerceSeriesTransformForStyle(style, series.transform),
    interpolation: coerceSeriesInterpolationForStyle(style),
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "series";
}

function defaultSeriesPresentation(fieldId: string): {
  style: SeriesStyle;
  transform: SeriesTransform;
  axis: SeriesAxis;
  period: SeriesPeriod;
  panelId: string;
} {
  const field = getTimeSeriesField(fieldId);
  return {
    style: field?.defaultStyle ?? "line",
    transform: "raw",
    axis: "auto",
    period: field?.nativeFrequency === "daily" ? "auto" : field?.nativeFrequency ?? "auto",
    panelId: fieldId === CHART_FIELD_IDS.volume ? "volume" : "main",
  };
}

export function buildSeriesSpec(
  expression: SeriesOrConstant,
  index: number,
  overrides: Partial<Omit<ChartSeriesSpec, "id" | "source">> = {},
): ChartSeriesSpec {
  if (expression.kind === "capability") {
    const style = overrides.style ?? expression.style ?? "line";
    return {
      id: `${slug(expression.capabilityId)}-${slug(expression.seriesId)}-${index + 1}`,
      source: {
        kind: "capability",
        capabilityId: expression.capabilityId,
        seriesId: expression.seriesId,
      },
      ...(expression.label ? { label: expression.label } : {}),
      transform: expression.transform ?? "raw",
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }
  if (expression.kind === "constant") {
    const source = { kind: "constant" as const, value: expression.value };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style;
    return {
      id: `const-${slug(String(expression.value))}-${index + 1}`,
      source,
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "economic") {
    const source = { kind: "economic" as const, provider: "fred" as const, seriesId: expression.seriesId };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style;
    return {
      id: `fred-${slug(expression.seriesId)}-${index + 1}`,
      source,
      ...(expression.label ? { label: expression.label } : {}),
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "future") {
    // Futures are Yahoo continuous-front symbols; they resolve through the
    // existing security pipeline. The prefix only makes them discoverable.
    const presentation = defaultSeriesPresentation(CHART_FIELD_IDS.price);
    const style = overrides.style ?? presentation.style;
    return {
      id: `${slug(expression.code)}-fut-${index + 1}`,
      source: {
        kind: "security",
        instrument: { symbol: expression.symbol },
        fieldId: CHART_FIELD_IDS.price,
        period: presentation.period,
      },
      ...(expression.label ? { label: expression.label } : {}),
      transform: presentation.transform,
      axis: presentation.axis,
      panelId: presentation.panelId,
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "treasury-yield") {
    // Treasury yields are FRED constant-rate series; reuse the economic pipeline.
    const source = { kind: "economic" as const, provider: "fred" as const, seriesId: expression.seriesId };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style;
    return {
      id: `ust-${slug(expression.maturity)}-${index + 1}`,
      source,
      ...(expression.label ? { label: expression.label } : {}),
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "adjacent-index") {
    const source = { kind: "adjacent-index" as const, indexId: expression.indexId };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style;
    return {
      id: `adj-${slug(expression.indexId)}-${index + 1}`,
      source,
      ...(expression.label ? { label: expression.label } : {}),
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "benchmark") {
    const source = { kind: "benchmark" as const, selector: expression.selector, metric: expression.metric };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style;
    return {
      id: `bench-${slug(expression.selector)}-${slug(expression.metric)}-${index + 1}`,
      source,
      ...(expression.label ? { label: expression.label } : {}),
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "poll") {
    const source = { kind: "poll" as const, subject: expression.subject, choice: expression.choice };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style;
    return {
      id: `poll-${slug(expression.subject)}-${slug(expression.choice)}-${index + 1}`,
      source,
      ...(expression.label ? { label: expression.label } : {}),
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "weather") {
    const source = {
      kind: "weather" as const,
      provider: expression.provider,
      stationId: expression.stationId,
      metric: expression.metric,
    };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style;
    return {
      id: `wx-${expression.provider}-${slug(expression.stationId)}-${expression.metric}-${index + 1}`,
      source,
      ...(expression.label ? { label: expression.label } : {}),
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "owid") {
    const source = { kind: "owid" as const, slug: expression.slug, entity: expression.entity };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style ?? "step";
    const catalog = findOwidCatalogEntryBySlug(expression.slug);
    const label = expression.label
      ?? owidSeriesLabel(
        catalog?.title ?? expression.slug.replaceAll("-", " "),
        expression.entity,
        catalog?.defaultEntity === expression.entity ? catalog.defaultEntityName : undefined,
      );
    return {
      id: `owid-${slug(expression.slug)}-${slug(expression.entity)}-${index + 1}`,
      source,
      label,
      transform: presentation.transform,
      axis: "left",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  if (expression.kind === "prediction-market") {
    const source = {
      kind: "prediction-market" as const,
      venue: expression.venue,
      marketId: expression.marketId,
    };
    const presentation = defaultChartSeriesPresentation(source);
    const style = overrides.style ?? presentation.style;
    return {
      id: `pm-${expression.venue}-${slug(expression.marketId)}-${index + 1}`,
      source,
      ...(expression.label ? { label: expression.label } : {}),
      transform: presentation.transform,
      axis: "auto",
      panelId: "main",
      ...overrides,
      style,
      interpolation: coerceSeriesInterpolationForStyle(style),
    };
  }

  const presentation = defaultSeriesPresentation(expression.fieldId);
  const requestedTransform = expression.transform;
  const rawStyle = presentation.style;
  // A non-raw transform is incompatible with OHLC styles; fall back to a line
  // so `SYMBOL:price:percent`-style expressions stay valid chart specs.
  const style = requestedTransform && requestedTransform !== "raw" && isOhlcSeriesStyle(rawStyle)
    ? "line"
    : (overrides.style ?? rawStyle);
  const timestampMode = defaultFinancialTimestampMode(expression.fieldId);
  return {
    id: `${slug(expression.symbol)}-${slug(expression.fieldId)}${requestedTransform ? `-${requestedTransform}` : ""}-${index + 1}`,
    source: {
      kind: "security",
      instrument: {
        symbol: expression.symbol,
        ...(expression.exchange ? { exchange: expression.exchange } : {}),
      },
      fieldId: expression.fieldId,
      period: presentation.period,
      ...(timestampMode ? { timestampMode } : {}),
    },
    ...(expression.label ? { label: expression.label } : {}),
    transform: requestedTransform ?? presentation.transform,
    axis: presentation.axis,
    panelId: presentation.panelId,
    ...overrides,
    style,
    interpolation: coerceSeriesInterpolationForStyle(style),
  };
}

function uniqueSeriesId(series: readonly ChartSeriesSpec[], preferredId: string): string {
  if (!series.some((entry) => entry.id === preferredId)) return preferredId;
  let suffix = 2;
  while (series.some((entry) => entry.id === `${preferredId}-${suffix}`)) suffix += 1;
  return `${preferredId}-${suffix}`;
}

function coerceOhlcPanelCollision(
  series: ChartSeriesSpec,
  existing: readonly ChartSeriesSpec[],
): ChartSeriesSpec {
  return isOhlcSeriesStyle(series.style)
    && existing.some((entry) => (
      entry.panelId === series.panelId && isOhlcSeriesStyle(entry.style)
    ))
    ? applySeriesStyle(series, "line")
    : series;
}

function isFinancialSeries(series: ChartSeriesSpec): boolean {
  return series.source.kind === "security" && isFundamentalFieldId(series.source.fieldId);
}

function isMarketPriceSeries(series: ChartSeriesSpec): boolean {
  return series.source.kind === "security"
    && getTimeSeriesField(series.source.fieldId)?.unitGroup === "price";
}

function effectiveSeriesUnitGroup(series: ChartSeriesSpec): string {
  if (series.transform === "percent" || series.transform === "yoy" || series.transform === "qoq") {
    return "percent";
  }
  if (series.transform === "index100") return "index";
  switch (series.source.kind) {
    case "economic":
      return `economic:${series.source.seriesId}`;
    case "capability":
      return `capability:${series.source.capabilityId}`;
    case "adjacent-index":
      return "level";
    case "benchmark":
      return `benchmark:${series.source.metric}`;
    case "poll":
      return "percent";
    case "weather":
      return `${series.source.provider}:${series.source.stationId}:${series.source.metric}`;
    case "owid":
      return `owid:${series.source.slug}`;
    case "prediction-market":
      return "probability";
    case "constant":
      return "constant";
    default:
      return getTimeSeriesField(series.source.fieldId)?.unitGroup ?? series.source.fieldId;
  }
}

function nextGeneratedPanelId(
  spec: Pick<ChartSpec, "panels" | "series" | "studies">,
  prefix = "panel",
): string {
  const used = new Set([
    ...spec.panels.map((panel) => panel.id),
    ...spec.series.map((series) => series.panelId),
    ...spec.studies.map((study) => study.panelId),
  ]);
  let index = 2;
  while (used.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

function availableGenericPanelId(
  spec: ChartSpec,
  candidate: ChartSeriesSpec,
): string {
  const candidateGroup = effectiveSeriesUnitGroup(candidate);
  const canFit = (panelId: string) => {
    if (spec.studies.some((study) => study.panelId === panelId && panelId !== "main")) {
      return false;
    }
    const groups = new Set(
      spec.series
        .filter((series) => series.panelId === panelId)
        .map(effectiveSeriesUnitGroup),
    );
    return groups.has(candidateGroup) || groups.size < 2;
  };
  if (canFit(candidate.panelId)) return candidate.panelId;
  const generated = spec.panels
    .map((panel) => panel.id)
    .filter((panelId) => /^panel-\d+$/.test(panelId))
    .find(canFit);
  return generated ?? nextGeneratedPanelId(spec);
}

function availableFinancialPanelId(
  spec: ChartSpec,
  candidate: ChartSeriesSpec,
): string {
  const { series, studies } = spec;
  const candidateGroup = effectiveSeriesUnitGroup(candidate);
  const existingPanelIds = [
    ...new Set(
      series
        .filter(isFinancialSeries)
        .map((entry) => entry.panelId)
        .filter((id) => id !== "main"),
    ),
  ];
  for (const panelId of existingPanelIds) {
    if (studies.some((study) => study.panelId === panelId)) continue;
    const occupants = series.filter((entry) => entry.panelId === panelId);
    const groups = new Set(occupants.filter(isFinancialSeries).map(effectiveSeriesUnitGroup));
    if (occupants.every(isFinancialSeries) && (groups.has(candidateGroup) || groups.size < 2)) {
      return panelId;
    }
  }

  let suffix = 1;
  while (true) {
    const panelId = suffix === 1 ? "fundamentals" : `fundamentals-${suffix}`;
    const occupants = series.filter((entry) => entry.panelId === panelId);
    const usedByStudy = studies.some((study) => study.panelId === panelId);
    if (occupants.length === 0 && !usedByStudy) return panelId;
    if (!usedByStudy && occupants.every(isFinancialSeries)) {
      const groups = new Set(occupants.map(effectiveSeriesUnitGroup));
      if (groups.has(candidateGroup) || groups.size < 2) return panelId;
    }
    suffix += 1;
  }
}

function placeAppendedSeriesByDefault(
  series: ChartSeriesSpec,
  spec: ChartSpec,
): ChartSeriesSpec {
  if (series.panelId !== "main") return series;
  if (isFinancialSeries(series) && spec.series.some(isMarketPriceSeries)) {
    return applySeriesTimestampMode({
      ...series,
      panelId: availableFinancialPanelId(spec, series),
    }, "available-at");
  }
  const sharesPanelWithFinancial = isMarketPriceSeries(series)
    && spec.series.some((entry) => (
      entry.panelId === series.panelId && isFinancialSeries(entry)
    ));
  return {
    ...series,
    panelId: sharesPanelWithFinancial
      ? nextGeneratedPanelId(spec)
      : availableGenericPanelId(spec, series),
  };
}

function ensureRequiredPanels(
  existing: readonly ChartPanelSpec[],
  series: readonly ChartSeriesSpec[],
  studies: readonly ChartStudySpec[],
): ChartPanelSpec[] {
  const known = new Set(existing.map((panel) => panel.id));
  return [
    ...existing,
    ...panelsForSeries(series, studies).filter((panel) => !known.has(panel.id)),
  ];
}

export function appendChartSeries(
  spec: ChartSpec,
  expression: ParsedSeriesExpression,
): { spec: ChartSpec; series: ChartSeriesSpec } {
  const built = coerceOhlcPanelCollision(
    placeAppendedSeriesByDefault(
      buildSeriesSpec(expression, spec.series.length),
      spec,
    ),
    spec.series,
  );
  const series = {
    ...built,
    id: uniqueSeriesId(spec.series, built.id),
  };
  const nextSeries = [...spec.series, series];
  return {
    series,
    spec: {
      ...spec,
      series: nextSeries,
      panels: ensureRequiredPanels(spec.panels, nextSeries, spec.studies),
    },
  };
}

function uniqueStudyId(studies: readonly ChartStudySpec[], preferred: string): string {
  if (!studies.some((entry) => entry.id === preferred)) return preferred;
  let suffix = 2;
  while (studies.some((entry) => entry.id === `${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

export interface ChartIdeaApplyResult {
  spec: ChartSpec;
  /** The series the idea added, in authoring order (hidden operands included). */
  appended: ChartSeriesSpec[];
}

/**
 * Canonical source key shared by {@link SeriesOrConstant} operands and built
 * {@link ChartSeriesSpec}s, so an idea merge can recognize "the user already
 * charts this source" regardless of which side it is compared from.
 */
function parsedSourceIdentityKey(expression: SeriesOrConstant): string | null {
  switch (expression.kind) {
    case "security":
      return `SEC:${expression.symbol}:${expression.fieldId}`;
    // Futures resolve through the security pipeline as their continuous symbol.
    case "future":
      return `SEC:${expression.symbol}:${CHART_FIELD_IDS.price}`;
    // Treasury yields resolve through the FRED economic pipeline.
    case "treasury-yield":
      return `FRED:${expression.seriesId}`;
    case "economic":
      return `FRED:${expression.seriesId}`;
    case "capability":
      return `CAP:${expression.capabilityId}:${expression.seriesId}`;
    case "adjacent-index":
      return `ADJ:${expression.indexId}`;
    case "benchmark":
      return `BENCH:${expression.selector}:${expression.metric}`;
    case "poll":
      return `POLL:${expression.subject}:${expression.choice}`;
    case "weather":
      return `WX:${expression.provider}:${expression.stationId}:${expression.metric}`;
    case "owid":
      return `OWID:${expression.slug}:${expression.entity}`;
    case "prediction-market":
      return `PM:${expression.venue}:${expression.marketId}`;
    case "constant":
      return null;
    default:
      return null;
  }
}

/** {@link parsedSourceIdentityKey}, from the built-series side of a chart spec. */
function seriesSourceIdentityKey(series: ChartSeriesSpec): string | null {
  switch (series.source.kind) {
    case "security":
      return `SEC:${series.source.instrument.symbol}:${series.source.fieldId}`;
    case "economic":
      return `FRED:${series.source.seriesId}`;
    case "capability":
      return `CAP:${series.source.capabilityId}:${series.source.seriesId}`;
    case "adjacent-index":
      return `ADJ:${series.source.indexId}`;
    case "benchmark":
      return `BENCH:${series.source.selector}:${series.source.metric}`;
    case "poll":
      return `POLL:${series.source.subject}:${series.source.choice}`;
    case "weather":
      return `WX:${series.source.provider}:${series.source.stationId}:${series.source.metric}`;
    case "owid":
      return `OWID:${series.source.slug}:${series.source.entity}`;
    case "prediction-market":
      return `PM:${series.source.venue}:${series.source.marketId}`;
    case "constant":
      return null;
    default:
      return null;
  }
}

/**
 * Apply a chart "idea" expression onto an open spec. Idea expressions need more
 * than one series or a derived study row (`DD:`, `VOL:`, `DIST:`, `CORR(a, b)`,
 * `a / b`, `a - b`), so they cannot go through the single-series
 * {@link appendChartSeries}. The full expression is built fresh — reusing the
 * exact same preset logic the `G` command uses — and its series/studies/panels
 * are merged into the existing spec under collision-safe ids. A source already
 * on the chart is reused as the study/formula input instead of appending a
 * look-alike series (which would break the one-candle-per-panel rule). Previous
 * pair formulas are superseded whenever a new formula idea lands, so the pair
 * study selection always reflects the most recent ratio/spread/correlation add.
 *
 * Returns null when the text is not a chart idea or cannot be parsed; callers
 * then fall back to a plain single-series append.
 */
export function applyChartIdeaToSpec(
  spec: ChartSpec,
  expressionText: string,
): ChartIdeaApplyResult | null {
  const text = expressionText.trim();
  if (!text) return null;
  const study = parseStudyExpression(text);
  const correlation = study ? null : parseCorrelationExpression(text);
  const binary = study || correlation ? null : parseBinarySeriesExpression(text);
  const isIdea = Boolean(study || correlation || binary);
  if (!isIdea) return null;

  const fresh = study
    ? buildStudyPreset(study)
    : buildCustomChartPreset(text);
  if (fresh.series.length === 0) return null;

  // The parsed source behind each fresh series, in authoring order. Stays in
  // sync with what buildStudyPreset / buildCustomChartPreset actually built.
  const sources: SeriesOrConstant[] = study
    ? [study.source]
    : correlation
      ? [correlation.left, correlation.right]
      : [binary!.left, binary!.right];

  const existingBySource = new Map<string, ChartSeriesSpec>();
  for (const entry of spec.series) {
    const key = seriesSourceIdentityKey(entry);
    if (key && !existingBySource.has(key)) existingBySource.set(key, entry);
  }

  // Reuse a matching existing source as the fresh series (and therefore as the
  // study/formula input); append only sources the chart does not have yet.
  const seriesIdMap = new Map<string, string>();
  const appended: ChartSeriesSpec[] = [];
  const claimed = new Set<string>();
  fresh.series.forEach((entry, index) => {
    const key = sources[index] ? parsedSourceIdentityKey(sources[index]!) : null;
    const existing = key ? existingBySource.get(key) : undefined;
    if (existing && !claimed.has(existing.id)) {
      claimed.add(existing.id);
      seriesIdMap.set(entry.id, existing.id);
      return;
    }
    const id = uniqueSeriesId(spec.series, entry.id);
    seriesIdMap.set(entry.id, id);
    // Same candle/OHLC-collision protection the fresh builders use, in case the
    // chart already has a price series this merge could not reuse.
    appended.push(coerceOhlcPanelCollision({ ...entry, id }, [...spec.series, ...appended]));
  });

  // Panels keep the live chart's authored panel state; fresh study/formula
  // panels (Drawdown, Volatility, MA Distance, Formula, Correlation) are added
  // with their default labels/heights only when the id is brand new.
  const panelIds = new Set(spec.panels.map((panel) => panel.id));
  const mergedPanels = [...spec.panels];
  for (const panel of fresh.panels) {
    if (panelIds.has(panel.id)) continue;
    mergedPanels.push(panel);
    panelIds.add(panel.id);
  }

  // Fresh pair formulas (ratio/spread/correlation) supersede prior ones so
  // `pair:ratio` remains a unique id and getSelectedPairStudies reflects the
  // newest formula; a plain DD/VOL/DIST study must never remove a pair formula
  // the user already authored.
  const mergedStudies = study
    ? spec.studies
    : spec.studies.filter((entry) => (
      !entry.id.startsWith(PAIR_STUDY_ID_PREFIX)
    ));
  const freshStudies = fresh.studies.map((entry) => ({
    ...entry,
    id: uniqueStudyId(mergedStudies, entry.id),
    inputSeriesIds: entry.inputSeriesIds.map((inputId) => seriesIdMap.get(inputId) ?? inputId),
  }));

  return {
    spec: {
      ...spec,
      series: [...spec.series, ...appended],
      studies: [...mergedStudies, ...freshStudies],
      panels: mergedPanels,
    },
    appended,
  };
}

function panelsForSeries(series: readonly ChartSeriesSpec[], studies: readonly ChartStudySpec[] = []): ChartPanelSpec[] {
  const panelIds = new Set(["main", ...series.map((entry) => entry.panelId), ...studies.map((entry) => entry.panelId)]);
  return [...panelIds].map((id) => ({
    id,
    ...(id === "volume" ? { label: "Volume", height: 0.24 } : {}),
    ...(id === "fundamentals" || /^fundamentals-\d+$/.test(id)
      ? { label: id === "fundamentals" ? "Fundamentals" : `Fundamentals ${id.slice("fundamentals-".length)}`, height: 0.35 }
      : {}),
    ...(id === "rsi" || id === "macd" || id === "atr" || id === "adx"
      ? { label: id.toUpperCase(), height: 0.28 }
      : {}),
    ...(id === "stochastic" ? { label: "Stoch", height: 0.28 } : {}),
    ...(id === "formula" ? { label: "Formula", height: 0.3 } : {}),
    ...(id === "correlation" ? { label: "Correlation", height: 0.3 } : {}),
    ...(id === "drawdown" ? { label: "Drawdown", height: 0.3 } : {}),
    ...(id === "volatility" ? { label: "Volatility", height: 0.3 } : {}),
    ...(id === "distance" ? { label: "MA Distance", height: 0.3 } : {}),
    ...(/^panel-\d+$/.test(id) ? { label: `Panel ${id.slice("panel-".length)}`, height: 0.35 } : {}),
  }));
}

/** Keep arbitrary sources legible when one panel would require more than two axes. */
function buildCustomSeries(expressions: readonly SeriesOrConstant[]): ChartSeriesSpec[] {
  const parsedSeries = expressions.map((expression, index) => buildSeriesSpec(expression, index));
  const mixedPriceAndFinancial = parsedSeries.some(isMarketPriceSeries)
    && parsedSeries.some(isFinancialSeries);
  const reservedPanelIds = new Set([
    "main",
    ...(mixedPriceAndFinancial ? ["fundamentals"] : []),
    ...parsedSeries.filter((series) => series.panelId !== "main").map((series) => series.panelId),
  ]);
  const panelGroups: Array<{ id: string; scope: string; groups: Set<string> }> = [];
  const builtSeries: ChartSeriesSpec[] = [];
  const nextPanelId = (prefix: "panel" | "fundamentals") => {
    let index = 2;
    while (reservedPanelIds.has(`${prefix}-${index}`)) index += 1;
    const id = `${prefix}-${index}`;
    reservedPanelIds.add(id);
    return id;
  };
  const allocatePanel = (scope: string, preferredId: string | null, unitGroup: string) => {
    const candidates = panelGroups.filter((entry) => entry.scope === scope);
    const panel = candidates.find((entry) => entry.groups.has(unitGroup))
      ?? candidates.find((entry) => entry.groups.size < 2)
      ?? (() => {
        const id = candidates.length === 0 && preferredId
          ? preferredId
          : nextPanelId(scope === "financial" ? "fundamentals" : "panel");
        const entry = { id, scope, groups: new Set<string>() };
        panelGroups.push(entry);
        reservedPanelIds.add(id);
        return entry;
      })();
    panel.groups.add(unitGroup);
    return panel.id;
  };

  parsedSeries.forEach((built) => {
    let candidate = built;
    if (built.panelId === "main") {
      const unitGroup = effectiveSeriesUnitGroup(built);
      const scope = mixedPriceAndFinancial
        ? isFinancialSeries(built)
          ? "financial"
          : isMarketPriceSeries(built) ? "price" : "other"
        : "main";
      const preferredId = scope === "financial"
        ? "fundamentals"
        : scope === "price" || scope === "main" ? "main" : null;
      candidate = {
        ...built,
        panelId: allocatePanel(scope, preferredId, unitGroup),
      };
      if (scope === "financial") {
        candidate = applySeriesTimestampMode(candidate, "available-at");
      }
    }
    builtSeries.push(coerceOhlcPanelCollision(candidate, builtSeries));
  });
  return builtSeries;
}

/**
 * Keep user-authored panel presentation while reconciling the panels needed by
 * the current series and studies. Indicator/formula toggles should only add or
 * remove their referenced panels; they must not reset labels, heights, order,
 * or logarithmic scales on panels that remain in use.
 */
function reconcilePanels(
  existing: readonly ChartPanelSpec[],
  series: readonly ChartSeriesSpec[],
  studies: readonly ChartStudySpec[],
): ChartPanelSpec[] {
  const defaults = panelsForSeries(series, studies);
  const requiredIds = new Set(defaults.map((panel) => panel.id));
  const managedStudyPanelIds = new Set(["volume", "rsi", "macd", "formula", "correlation", "drawdown", "volatility", "distance"]);
  const retained = existing.filter((panel) => (
    requiredIds.has(panel.id) || !managedStudyPanelIds.has(panel.id)
  ));
  const retainedIds = new Set(retained.map((panel) => panel.id));
  return [
    ...retained,
    ...defaults.filter((panel) => !retainedIds.has(panel.id)),
  ];
}

function chartSpec(
  series: ChartSeriesSpec[],
  options: { range?: TimeRange; resolution?: ChartResolution; studies?: ChartStudySpec[] } = {},
): ChartSpec {
  const studies = options.studies ?? [];
  return {
    version: CHART_SPEC_VERSION,
    viewport: { range: options.range ?? "5Y", resolution: options.resolution ?? "auto" },
    panels: panelsForSeries(series, studies),
    series,
    studies,
  };
}

export function buildEmptyChartPreset(): ChartSpec {
  return chartSpec([]);
}

export function buildCustomChartPreset(expression: string, fallbackSymbol?: string | null): ChartSpec {
  const study = parseStudyExpression(expression);
  if (study) return buildStudyPreset(study);
  const correlation = parseCorrelationExpression(expression);
  if (correlation) {
    const spec = setPairStudies(
      chartSpec(buildCustomSeries([correlation.left, correlation.right])),
      ["correlation"],
    );
    // Like the ratio/spread operands, the two correlation inputs stay authored
    // hidden so the derived rolling correlation is what the expression asks for.
    return { ...spec, series: spec.series.map((series) => ({ ...series, visible: false })) };
  }
  const binary = parseBinarySeriesExpression(expression);
  if (binary) {
    const spec = setPairStudies(
      chartSpec(buildCustomSeries([binary.left, binary.right])),
      [binary.studyKind],
    );
    // `A / B` asks for the derived line, not the two inputs, so the operands are
    // authored hidden. They stay in the spec (and keep loading) so the study can
    // compute and the user can unhide either leg from series settings.
    return { ...spec, series: spec.series.map((series) => ({ ...series, visible: false })) };
  }
  const parsed = parseChartExpression(expression);
  if (parsed.length === 0) return fallbackSymbol ? buildPriceChartPreset(fallbackSymbol) : buildEmptyChartPreset();
  const owidOnly = parsed.every((entry) => entry.kind === "owid");
  return chartSpec(buildCustomSeries(parsed), owidOnly ? { range: "ALL" } : {});
}

/**
 * Build the chart for a single-source study expression (`DD:`, `VOL:`, `DIST:`).
 * The source series stays visible as context; the derived line lands in its own
 * lower panel.
 */
export function buildStudyPreset(study: ChartStudyExpression): ChartSpec {
  const source = buildSeriesSpec(study.source, 0);
  return chartSpec([source], { studies: [buildStudySpec(study, source)] });
}

/**
 * Maps a {@link ChartStudyExpression} onto a resolved {@link ChartStudySpec}.
 * The three study kinds the expression layer exposes (drawdown, volatility,
 * distance) are implemented by the chart resolver and accepted by the spec
 * normalizer; they are intentionally kept out of the annotated single-source
 * study toggles, which remain on the classic builtin indicators.
 */
export function buildStudySpec(
  study: ChartStudyExpression,
  source: ChartSeriesSpec,
): ChartStudySpec {
  const panelId = study.kind === "drawdown"
    ? "drawdown"
    : study.kind === "volatility"
      ? "volatility"
      : "distance";
  const parameters: Record<string, number> = {};
  if ((study.kind === "volatility" || study.kind === "distance") && study.period) {
    parameters.period = study.period;
  }
  return {
    id: `${study.kind}-${source.id}`,
    // `drawdown` / `volatility` / `distance` are real resolver kinds but are not
    // part of the shared ChartStudyKind union (types.ts is a no-touch file), so
    // the spec object is built through a locally-typed cast.
    kind: study.kind as unknown as ChartStudyKind,
    inputSeriesIds: [source.id],
    parameters,
    panelId,
    axis: "auto",
  };
}

export function buildPriceChartPreset(symbol: string): ChartSpec {
  const normalized = normalizeInstrument(symbol, true);
  if (!normalized) return buildEmptyChartPreset();
  return setBuiltinStudies(
    chartSpec([buildSeriesSpec({ kind: "security", ...normalized, fieldId: CHART_FIELD_IDS.price }, 0)]),
    ["volume"],
  );
}

/**
 * Research / bound-pane charts. Prefixed alt series (POLY:, KALSHI:, ADJ:,
 * FRED:, …) go through the expression parser; everything else is a security.
 */
export function buildBoundChartPreset(symbol: string): ChartSpec {
  const trimmed = symbol.trim();
  if (!trimmed) return buildEmptyChartPreset();
  const parsed = parseSeriesExpression(trimmed);
  if (parsed && parsed.kind !== "security") {
    try {
      return buildCustomChartPreset(trimmed);
    } catch {
      return buildEmptyChartPreset();
    }
  }
  return buildPriceChartPreset(trimmed);
}

export function setMainPanelScale(spec: ChartSpec, scale: PanelScale): ChartSpec {
  if (scale !== "linear" && scale !== "log" && scale !== "percent") return spec;
  return {
    ...spec,
    panels: spec.panels.map((panel) => panel.id === "main" ? { ...panel, scale } : panel),
    series: scale === "log"
      ? spec.series.map((series) => series.panelId === "main" && series.transform === "log"
        ? { ...series, transform: "raw" }
        : series)
      : spec.series,
  };
}

export function toggleMainPanelScale(spec: ChartSpec): ChartSpec {
  const current = spec.panels.find((panel) => panel.id === "main")?.scale === "log" ? "log" : "linear";
  return setMainPanelScale(spec, current === "log" ? "linear" : "log");
}

export function toggleMainPanelPercentScale(spec: ChartSpec): ChartSpec {
  const current = spec.panels.find((panel) => panel.id === "main")?.scale;
  return setMainPanelScale(spec, current === "percent" ? "linear" : "percent");
}

export function toggleMainPanelAutoScale(spec: ChartSpec): ChartSpec {
  const enabled = spec.panels.find((panel) => panel.id === "main")?.autoScale !== false;
  return {
    ...spec,
    panels: spec.panels.map((panel) => {
      if (panel.id !== "main") return panel;
      if (enabled) return { ...panel, autoScale: false };
      const { autoScale: _autoScale, ...rest } = panel;
      return rest;
    }),
  };
}

export function setChartDisplayTimeZone(spec: ChartSpec, timeZone: string): ChartSpec {
  const next = (CHART_DISPLAY_TIME_ZONES as readonly string[]).includes(timeZone) ? timeZone : undefined;
  return {
    ...spec,
    viewport: {
      ...spec.viewport,
      timeZone: next,
    },
  };
}

/** Overlay another ticker on the open chart and switch the main pane to percent. */
export function appendCompareTicker(spec: ChartSpec, ticker: string): ChartSpec | null {
  const instrument = normalizeInstrument(ticker, true);
  if (!instrument || spec.series.length >= MAX_CHART_COMPOSER_SERIES) return null;
  const nextKey = publicTickerKey(instrument.symbol, instrument.exchange);
  const already = spec.series.some((entry) => (
    entry.source.kind === "security"
    && publicTickerKey(entry.source.instrument.symbol, entry.source.instrument.exchange) === nextKey
    && (entry.source.fieldId === CHART_FIELD_IDS.price || entry.source.fieldId === CHART_FIELD_IDS.close)
    && entry.panelId === "main"
  ));
  if (already) return null;
  const converted = spec.series.map((entry) => (
    entry.panelId === "main" && isOhlcSeriesStyle(entry.style)
      ? applySeriesStyle(entry, "line")
      : entry
  ));
  const built = buildSeriesSpec(
    { kind: "security", ...instrument, fieldId: CHART_FIELD_IDS.close },
    converted.length,
    { style: "line", transform: "raw", axis: "left", panelId: "main" },
  );
  const series = { ...built, id: uniqueSeriesId(converted, built.id) };
  const nextSeries = [...converted, series];
  return {
    ...spec,
    series: nextSeries,
    panels: ensureRequiredPanels(
      spec.panels.map((panel) => panel.id === "main" ? { ...panel, scale: "percent" as const } : panel),
      nextSeries,
      spec.studies,
    ),
  };
}

/** Rebind research-context series without discarding authored chart choices. */
export function rebindChartSecuritySymbol(spec: ChartSpec, previous: string, next: string): ChartSpec {
  const previousInstrument = normalizeInstrument(previous, true);
  const nextInstrument = normalizeInstrument(next, true);
  if (!previousInstrument || !nextInstrument) return spec;
  const previousKey = publicTickerKey(previousInstrument.symbol, previousInstrument.exchange);
  const nextKey = publicTickerKey(nextInstrument.symbol, nextInstrument.exchange);
  if (previousKey === nextKey) return spec;
  let changed = false;
  const series = spec.series.map((entry) => {
    if (entry.source.kind !== "security"
      || publicTickerKey(entry.source.instrument.symbol, entry.source.instrument.exchange) !== previousKey) {
      return entry;
    }
    changed = true;
    const normalizedLabel = entry.label?.trim().toUpperCase();
    const label = normalizedLabel === previousKey || normalizedLabel === previousInstrument.symbol
      ? nextKey
      : entry.label;
    return {
      ...entry,
      ...(label ? { label } : { label: undefined }),
      source: {
        ...entry.source,
        instrument: nextInstrument,
      },
    };
  });
  return changed ? { ...spec, series } : spec;
}

export function buildIntradayPriceChartPreset(symbol: string): ChartSpec {
  const normalized = normalizeInstrument(symbol, true);
  if (!normalized) return buildEmptyChartPreset();
  return setBuiltinStudies(chartSpec([
    buildSeriesSpec(
      { kind: "security", ...normalized, fieldId: CHART_FIELD_IDS.price },
      0,
      { style: "candles" },
    ),
  ], { range: "1D", resolution: "1m" }), ["volume"]);
}

export function buildComparisonChartPreset(symbols: readonly string[]): ChartSpec {
  const normalized = symbols.map((symbol) => normalizeInstrument(symbol, true)).filter((entry): entry is NonNullable<typeof entry> => entry !== null).slice(0, MAX_CHART_COMPOSER_SERIES);
  return chartSpec(normalized.map((instrument, index) => buildSeriesSpec(
    { kind: "security", ...instrument, fieldId: CHART_FIELD_IDS.close },
    index,
    { style: "line", transform: "percent", axis: "left" },
  )), { range: "1Y", resolution: "1d" });
}

export function buildFundamentalChartPreset(
  symbols: readonly string[],
  fieldId = CHART_FIELD_IDS.revenue,
): ChartSpec {
  const resolvedField = resolveChartFieldAlias(fieldId);
  const normalized = symbols.map((symbol) => normalizeInstrument(symbol, true)).filter((entry): entry is NonNullable<typeof entry> => entry !== null).slice(0, MAX_CHART_COMPOSER_SERIES);
  return chartSpec(normalized.map((instrument, index) => buildSeriesSpec(
    { kind: "security", ...instrument, fieldId: resolvedField },
    index,
    { axis: "left" },
  )), { range: "5Y", resolution: "auto" });
}

export function buildValuationChartPreset(
  symbols: readonly string[],
  fieldId = CHART_FIELD_IDS.trailingPE,
): ChartSpec {
  const resolvedField = resolveChartFieldAlias(fieldId);
  const normalized = symbols.map((symbol) => normalizeInstrument(symbol, true)).filter((entry): entry is NonNullable<typeof entry> => entry !== null).slice(0, MAX_CHART_COMPOSER_SERIES);
  return chartSpec(normalized.map((instrument, index) => buildSeriesSpec(
    { kind: "security", ...instrument, fieldId: resolvedField },
    index,
    { style: normalized.length === 1 ? "line" : "columns", axis: "left" },
  )));
}

const STUDY_DEFAULTS = {
  volume: { kind: "volume", panelId: "volume", parameters: {} },
  sma20: { kind: "sma", panelId: "main", parameters: { period: 20 } },
  sma50: { kind: "sma", panelId: "main", parameters: { period: 50 } },
  sma200: { kind: "sma", panelId: "main", parameters: { period: 200 } },
  ema20: { kind: "ema", panelId: "main", parameters: { period: 20 } },
  bollinger20: { kind: "bollinger", panelId: "main", parameters: { period: 20, stdDev: 2 } },
  vwap: { kind: "vwap", panelId: "main", parameters: {} },
  rsi14: { kind: "rsi", panelId: "rsi", parameters: { period: 14 } },
  macd: { kind: "macd", panelId: "macd", parameters: { fast: 12, slow: 26, signal: 9 } },
  atr14: { kind: "atr", panelId: "atr", parameters: { period: 14 } },
  stoch14: { kind: "stochastic", panelId: "stochastic", parameters: { period: 14, smooth: 3 } },
  adx14: { kind: "adx", panelId: "adx", parameters: { period: 14 } },
} as const satisfies Record<string, {
  kind: Exclude<ChartStudyKind, "ratio" | "spread" | "correlation">;
  panelId: string;
  parameters: Record<string, number>;
}>;

export type BuiltinStudySelection = keyof typeof STUDY_DEFAULTS;

const BUILTIN_STUDY_ID_PREFIX = "builtin:";

export function getSelectedBuiltinStudies(spec: ChartSpec): BuiltinStudySelection[] {
  const selected = new Set(spec.studies.flatMap((study) => {
    if (!study.id.startsWith(BUILTIN_STUDY_ID_PREFIX)) return [];
    const selection = study.id.slice(BUILTIN_STUDY_ID_PREFIX.length).split(":", 1)[0];
    return selection && Object.prototype.hasOwnProperty.call(STUDY_DEFAULTS, selection)
      ? [selection as BuiltinStudySelection]
      : [];
  }));
  return (Object.keys(STUDY_DEFAULTS) as BuiltinStudySelection[]).filter((selection) => selected.has(selection));
}

export function setBuiltinStudies(spec: ChartSpec, selected: readonly BuiltinStudySelection[]): ChartSpec {
  const input = spec.series.find((series) => (
    series.source.kind === "security"
    && (series.source.fieldId === CHART_FIELD_IDS.price || series.source.fieldId === CHART_FIELD_IDS.close)
  ));
  const selectedSet = new Set(selected);
  const customStudies = spec.studies.filter((study) => !study.id.startsWith(BUILTIN_STUDY_ID_PREFIX));
  const studies = input
    ? [
      ...customStudies,
      ...(Object.entries(STUDY_DEFAULTS) as Array<[BuiltinStudySelection, typeof STUDY_DEFAULTS[BuiltinStudySelection]]>)
        .filter(([selection]) => selectedSet.has(selection))
        .map(([selection, defaults]) => ({
          id: `${BUILTIN_STUDY_ID_PREFIX}${selection}:${input.id}`,
          kind: defaults.kind,
          inputSeriesIds: [input.id],
          parameters: defaults.parameters,
          panelId: defaults.panelId,
          axis: "auto" as const,
        })),
    ]
    : customStudies;
  return { ...spec, studies, panels: reconcilePanels(spec.panels, spec.series, studies) };
}

export type PairStudySelection = "ratio" | "spread" | "correlation";

const PAIR_STUDY_ID_PREFIX = "pair:";

export function getSelectedPairStudies(spec: ChartSpec): PairStudySelection[] {
  const selected = new Set(spec.studies.flatMap((study) => (
    study.id.startsWith(PAIR_STUDY_ID_PREFIX)
      ? [study.kind as PairStudySelection]
      : []
  )));
  return (["ratio", "spread", "correlation"] as PairStudySelection[])
    .filter((kind) => selected.has(kind));
}

export function setPairStudies(spec: ChartSpec, selected: readonly PairStudySelection[]): ChartSpec {
  // Inputs are taken regardless of visibility: a derived study keeps computing
  // from its two sources even when the plot only shows the derived line.
  const inputs = spec.series.slice(0, 2);
  const selectedSet = new Set(selected);
  const pairStudies: ChartStudySpec[] = inputs.length === 2
    ? (["ratio", "spread", "correlation"] as PairStudySelection[])
      .filter((kind) => selectedSet.has(kind))
      .map((kind): ChartStudySpec => ({
        id: `${PAIR_STUDY_ID_PREFIX}${kind}`,
        kind,
        inputSeriesIds: inputs.map((series) => series.id),
        parameters: kind === "spread"
          ? { multiplier: 1 }
          : kind === "correlation"
            ? { period: 20, returns: 1 }
            : {},
        panelId: kind === "correlation" ? "correlation" : "formula",
        axis: "auto",
      }))
    : [];
  const studies: ChartStudySpec[] = [
    ...spec.studies.filter((study) => !study.id.startsWith(PAIR_STUDY_ID_PREFIX)),
    ...pairStudies,
  ];
  return { ...spec, studies, panels: reconcilePanels(spec.panels, spec.series, studies) };
}
