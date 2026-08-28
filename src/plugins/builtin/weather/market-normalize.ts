/**
 * Renderer-neutral weather market normalization layer.
 *
 * Parses Kalshi and Polymarket weather contracts into a single
 * {@link WeatherMarketSpec} that captures venue, market family, station/source,
 * date window, timezone, units, precision, bracket semantics, revision policy,
 * fallback source, and settlement URL from the fields/rules each venue exposes.
 *
 * The module is pure TypeScript: no React, OpenTUI, or DOM dependencies, so it
 * can be imported from terminal, desktop, and hosted/cloud renderers alike.
 *
 * Supported weather market families:
 *  - daily-high / daily-low      (Kalshi KXHIGH/KXLOWT, Polymarket daily temp)
 *  - hourly-temp                 (Kalshi KXTEMP..H, hourly observation markets)
 *  - monthly-precip              (Kalshi KXRAIN, monthly precip totals)
 *  - monthly-snowfall            (monthly snow totals)
 *  - where-rain                  ("where will it rain" location markets)
 *  - hurricane / tornado / drought (only when the source is explicit)
 */

import type {
  KalshiMarketRecord,
} from "../../prediction-markets/services/kalshi/types";
import type {
  PolymarketEventRecord,
  PolymarketMarketRecord,
} from "../../prediction-markets/services/polymarket/types";
import {
  parseKalshiWeatherEventStamp,
  parseKalshiWeatherSeriesTicker,
  resolveWeatherSettlement,
} from "./mapping";
import {
  resolveSevereWeatherSource,
} from "./severe";
import {
  canonicalWeatherStationId,
  findWeatherStation,
} from "./stations";
import { TWC_KALSHI_URL } from "./types";

export type WeatherVenue = "kalshi" | "polymarket";

export type WeatherMarketFamily =
  | "daily-high"
  | "daily-low"
  | "hourly-temp"
  | "monthly-precip"
  | "monthly-snowfall"
  | "where-rain"
  | "hurricane"
  | "tornado"
  | "drought";

/** Measurement unit for the underlying observation. */
export type WeatherUnit =
  | "f" // Fahrenheit
  | "c" // Celsius
  | "in" // inches (precip / snowfall)
  | "mm" // millimeters
  | "cm" // centimeters
  | "count" // integer counts (tornado count, hurricane count)
  | "category" // categorical (Saffir-Simpson, EF, drought level)
  | "binary"; // yes/no location outcome (where-rain)

/** How a numeric bracket resolves. */
export type WeatherBracketSemantics =
  | "less-than" // Yes if value < cap
  | "greater-than" // Yes if value > floor
  | "between" // Yes if floor <= value < cap
  | "at-or-above" // Yes if value >= floor
  | "at-or-below" // Yes if value <= cap
  | "exact" // Yes if value == target
  | "categorical"; // named outcomes, no numeric bracket

/** How the settlement value is revised / finalized. */
export type WeatherRevisionPolicy =
  | "official-final" // final official report (TWC CLI / NWS)
  | "preliminary" // preliminary report, amended later
  | "amended" // amended reports accepted up to a cutoff
  | "fixed-cutoff" // value frozen at a fixed timestamp
  | "season-end" // resolved at the end of a season
  | "monthly-total" // cumulative monthly total
  | "unknown";

export interface WeatherDateWindow {
  /** ISO `YYYY-MM-DD` for a day, `YYYY-MM` for a month, or `YYYY` for a season. */
  start: string;
  end?: string;
  /** Local hour (0-23) for hourly-temp markets; null otherwise. */
  hour: number | null;
  /** Human-readable label from the market, e.g. "Aug 19, 2026". */
  label: string | null;
}

export interface WeatherMarketSpec {
  venue: WeatherVenue;
  family: WeatherMarketFamily;
  /** Canonical TWC climate id (e.g. `LAX`) when a station is known. */
  stationId: string | null;
  /** Named settlement source, e.g. "The Weather Company", "NWS", "NOAA". */
  source: string | null;
  dateWindow: WeatherDateWindow | null;
  /** IANA timezone of the observation station, when known. */
  timezone: string | null;
  unit: WeatherUnit;
  /** Decimal places the observation is reported to. */
  precision: number;
  bracket: WeatherBracketSemantics;
  /** Numeric lower bound when bracket is numeric. */
  floor: number | null;
  /** Numeric upper bound when bracket is numeric. */
  cap: number | null;
  revisionPolicy: WeatherRevisionPolicy;
  /** Backup source named in the rules, e.g. NWS for a TWC market. */
  fallbackSource: string | null;
  settlementUrl: string | null;
  /** Raw market id / ticker for traceability. */
  marketId: string;
  /** True when the source was explicitly named in rules (not inferred). */
  sourceExplicit: boolean;
  /** True when the market was recognized as a weather market at all. */
  recognized: boolean;
}

/**
 * Venue-agnostic input assembled from either venue's market record. Use
 * {@link normalizeKalshiWeatherMarket} or {@link normalizePolymarketWeatherMarket}
 * to build this from a raw record, or construct it directly.
 */
export interface WeatherMarketInput {
  venue: WeatherVenue;
  marketId: string;
  title: string;
  marketLabel?: string;
  eventLabel?: string;
  eventTicker?: string;
  seriesTicker?: string;
  category?: string;
  description?: string;
  rulesPrimary?: string;
  rulesSecondary?: string;
  resolutionSource?: string;
  settlementUrl?: string;
  /** Kalshi strike metadata. */
  strikeType?: string;
  floorStrike?: number | string | null;
  capStrike?: number | string | null;
  /** Polymarket categorical outcomes, e.g. ["Yes", "No"] or city names. */
  outcomes?: string[];
  endsAt?: string | null;
}

const MONTH_NAMES: Readonly<Record<string, number>> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9,
  sept: 9, oct: 10, nov: 11, dec: 12,
};

const SOURCE_LABELS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /weather company|weather\.com\/kalshi/i, label: "The Weather Company" },
  { pattern: /national weather service|\bnws\b/i, label: "NWS" },
  { pattern: /national hurricane center|\bnhc\b/i, label: "NHC" },
  { pattern: /storm prediction center|\bspc\b/i, label: "SPC" },
  { pattern: /drought monitor/i, label: "U.S. Drought Monitor" },
  { pattern: /\bnoaa\b/i, label: "NOAA" },
  { pattern: /accuweather/i, label: "AccuWeather" },
];

/** Landing page for each named source, used as the settlement URL. */
const SOURCE_URLS: Readonly<Record<string, string>> = {
  "The Weather Company": TWC_KALSHI_URL,
  NWS: "https://www.weather.gov",
  NOAA: "https://www.noaa.gov",
  AccuWeather: "https://www.accuweather.com",
};

const URL_RE = /\bhttps?:\/\/[^\s)"')<>]+\b/i;

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function joinFields(...values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => !!value && value.trim().length > 0)
    .join("\n");
}

function lower(value: string): string {
  return value.toLowerCase();
}

function hasPhrase(text: string, phrase: string): boolean {
  const lowerText = lower(text);
  if (lowerText.includes(lower(phrase))) return true;
  const pattern = lower(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s-]+/g, "[\\s-]+");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(text);
}

/** Detect the named settlement source from rules/resolution-source text. */
export function detectWeatherSource(text: string): string | null {
  for (const entry of SOURCE_LABELS) {
    if (entry.pattern.test(text)) return entry.label;
  }
  return null;
}

/** Extract the first explicit URL from text, for settlement-source links. */
function extractUrlFromText(text: string): string | null {
  const match = URL_RE.exec(text);
  return match?.[0] ? match[0].replace(/[.,;:)]+$/, "") : null;
}

/** Resolve a settlement URL from the detected source name or rules text. */
function resolveSettlementUrl(
  source: string | null,
  text: string,
): string | null {
  if (source && SOURCE_URLS[source]) return SOURCE_URLS[source];
  return extractUrlFromText(text);
}

function familyFromKalshiSeries(
  seriesTicker: string | undefined,
): WeatherMarketFamily | null {
  const parsed = parseKalshiWeatherSeriesTicker(seriesTicker);
  if (!parsed) return null;
  switch (parsed.metric) {
    case "high": return "daily-high";
    case "low": return "daily-low";
    case "hourly": return "hourly-temp";
    case "precip": return "monthly-precip";
    default: return null;
  }
}

const FAMILY_PATTERNS: ReadonlyArray<{
  family: WeatherMarketFamily;
  patterns: readonly string[];
}> = [
  {
    family: "where-rain",
    patterns: ["where will it rain", "where will rain", "where is it going to rain", "rainfall location"],
  },
  {
    family: "monthly-snowfall",
    patterns: ["snowfall", "total snow", "snow total", "monthly snow"],
  },
  {
    family: "monthly-precip",
    patterns: ["monthly precipitation", "total precipitation", "monthly rainfall", "total rainfall"],
  },
  {
    family: "hourly-temp",
    patterns: ["hourly temperature", "hourly temp", "temperature at"],
  },
  {
    family: "daily-high",
    patterns: ["highest temperature", "high temperature", "maximum temperature", "max temp", "daily high"],
  },
  {
    family: "daily-low",
    patterns: ["lowest temperature", "low temperature", "minimum temperature", "min temp", "daily low"],
  },
];

const SEVERE_KIND_TO_FAMILY: Readonly<Record<string, WeatherMarketFamily>> = {
  hurricane: "hurricane",
  tornado: "tornado",
  drought: "drought",
};

/**
 * Resolve a severe-weather family (hurricane/tornado/drought) by delegating to
 * the dedicated severe-weather source registry. The family is only returned
 * when the rules explicitly name a public source (status `supported`), enforcing
 * the "source must be explicit" rule. Wildfire and "other" are outside this
 * layer's family scope and return null here.
 */
function resolveSevereFamily(
  input: WeatherMarketInput,
): { family: WeatherMarketFamily; source: string; sourceUrl: string | null } | null {
  const resolved = resolveSevereWeatherSource({
    venue: input.venue,
    seriesTicker: input.seriesTicker,
    eventTicker: input.eventTicker,
    marketId: input.marketId,
    category: input.category,
    title: input.title,
    description: input.description,
    rulesPrimary: input.rulesPrimary,
    rulesSecondary: input.rulesSecondary,
    resolutionSource: input.resolutionSource,
  });
  if (resolved.status !== "supported") return null;
  const family = resolved.kind ? SEVERE_KIND_TO_FAMILY[resolved.kind] : null;
  if (!family || !resolved.source) return null;
  return { family, source: resolved.source, sourceUrl: resolved.sourceUrl };
}

function familyFromText(
  text: string,
): WeatherMarketFamily | null {
  for (const entry of FAMILY_PATTERNS) {
    if (entry.patterns.some((pattern) => hasPhrase(text, pattern))) {
      return entry.family;
    }
  }
  return null;
}

/** True when the input looks like a weather market at all. */
export function isWeatherMarket(input: WeatherMarketInput): boolean {
  if (input.venue === "kalshi") {
    if (parseKalshiWeatherSeriesTicker(
      input.seriesTicker ?? input.eventTicker ?? input.marketId,
    )) {
      return true;
    }
  }
  const blob = joinFields(
    input.title,
    input.marketLabel,
    input.eventLabel,
    input.category,
    input.description,
    input.rulesPrimary,
    input.rulesSecondary,
    input.resolutionSource,
  );
  if (/weather|climate|temperature|precipitation|snowfall|hurricane|tornado|drought|rainfall/i.test(blob)) {
    // Avoid false positives on economics "climate" (e.g. a Fed market is not
    // weather even if the Kalshi category is "Climate and Weather").
    if (/\bfed\b|fomc|inflation|cpi|payroll|gdp|unemployment/i.test(blob)) {
      return parseKalshiWeatherSeriesTicker(
        input.seriesTicker ?? input.eventTicker ?? input.marketId,
      ) != null;
    }
    return true;
  }
  return false;
}

function parseMonthYear(text: string): { start: string; label: string } | null {
  const match = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s*,?\s*(20\d{2})\b/i.exec(text);
  if (!match) return null;
  const month = MONTH_NAMES[lower(match[1] ?? "")];
  const year = Number(match[2]);
  if (!month || !year) return null;
  return {
    start: `${year}-${String(month).padStart(2, "0")}`,
    label: `${match[1]} ${year}`,
  };
}

function parseFullDate(text: string): { start: string; label: string } | null {
  // "Aug 19, 2026" / "August 19, 2026" / "19 Aug 2026"
  const match = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})\b(?:\s*,?\s*(20\d{2}))?/i.exec(text)
    ?? /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\b(?:\s*,?\s*(20\d{2}))?/i.exec(text);
  if (!match) return null;
  let monthToken: string;
  let dayToken: string;
  let yearToken: string | undefined;
  if (MONTH_NAMES[lower(match[1] ?? "")]) {
    monthToken = match[1] ?? "";
    dayToken = match[2] ?? "";
    yearToken = match[3];
  } else {
    dayToken = match[1] ?? "";
    monthToken = match[2] ?? "";
    yearToken = match[3];
  }
  const month = MONTH_NAMES[lower(monthToken)];
  const day = Number(dayToken);
  const year = yearToken ? Number(yearToken) : new Date().getFullYear();
  if (!month || !day || !year) return null;
  return {
    start: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    label: `${monthToken} ${dayToken}, ${year}`,
  };
}

function detectDateWindow(
  input: WeatherMarketInput,
  family: WeatherMarketFamily,
): WeatherDateWindow | null {
  // Kalshi event ticker stamp is the most precise for daily/hourly.
  const stamp = parseKalshiWeatherEventStamp(
    input.eventTicker ?? input.marketId,
  );
  if (stamp) {
    return {
      start: stamp.date,
      hour: stamp.hour,
      label: null,
    };
  }
  const text = joinFields(
    input.title,
    input.marketLabel,
    input.eventLabel,
    input.rulesPrimary,
    input.rulesSecondary,
    input.description,
  );
  if (family === "monthly-precip" || family === "monthly-snowfall" || family === "drought") {
    const month = parseMonthYear(text);
    if (month) {
      return { start: month.start, end: month.start, hour: null, label: month.label };
    }
  }
  if (family === "hurricane" || family === "tornado") {
    // Season markets: "2026 Atlantic hurricane season"
    const seasonMatch = /\b(20\d{2})\s+(?:atlantic|pacific)?\s*(?:hurricane|tornado|severe weather)\s*season\b/i.exec(text);
    if (seasonMatch) {
      return { start: seasonMatch[1] ?? "", hour: null, label: `${seasonMatch[1]} season` };
    }
  }
  const full = parseFullDate(text);
  if (full) {
    return { start: full.start, hour: null, label: full.label };
  }
  // Fall back to endsAt ISO date.
  if (input.endsAt) {
    const iso = input.endsAt.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return { start: iso, hour: null, label: null };
    }
  }
  return null;
}

function detectBracket(
  input: WeatherMarketInput,
  family: WeatherMarketFamily,
): {
  bracket: WeatherBracketSemantics;
  floor: number | null;
  cap: number | null;
} {
  // "Where will it rain" markets are inherently categorical (named outcomes).
  if (family === "where-rain") {
    return { bracket: "categorical", floor: null, cap: null };
  }
  const strikeType = input.strikeType?.trim().toLowerCase();
  const floor = toFiniteNumber(input.floorStrike);
  const cap = toFiniteNumber(input.capStrike);
  if (strikeType === "less") return { bracket: "less-than", floor: null, cap };
  if (strikeType === "greater") return { bracket: "greater-than", floor, cap: null };
  if (strikeType === "between") return { bracket: "between", floor, cap };
  // Polymarket and rules-prose markets: infer from text.
  const text = joinFields(input.title, input.marketLabel, input.rulesPrimary);
  if (/\bat or above\b|\b>=\b|\babove or equal\b/i.test(text)) {
    return { bracket: "at-or-above", floor, cap: null };
  }
  if (/\bat or below\b|\b<=\b|\bbelow or equal\b/i.test(text)) {
    return { bracket: "at-or-below", floor: null, cap };
  }
  if (/\babove\b|\bgreater than\b|\bmore than\b|\bexceed\b|\b>\b/i.test(text)) {
    return { bracket: "greater-than", floor, cap: null };
  }
  if (/\bbelow\b|\bless than\b|\bfewer than\b|\bunder\b|\b<\b/i.test(text)) {
    return { bracket: "less-than", floor: null, cap };
  }
  // Hurricane/tornado/drought without a numeric threshold are categorical
  // (e.g. "will an EF5 occur", "will there be extreme drought").
  if (family === "hurricane" || family === "tornado" || family === "drought") {
    return { bracket: "categorical", floor: null, cap: null };
  }
  if (input.outcomes && input.outcomes.length > 0 && input.outcomes.every((o) => o === "Yes" || o === "No")) {
    return { bracket: "categorical", floor: null, cap: null };
  }
  return { bracket: "between", floor, cap };
}

function detectUnit(
  family: WeatherMarketFamily,
  text: string,
): WeatherUnit {
  if (family === "where-rain") return "binary";
  if (family === "drought") return "category";
  if (family === "hurricane") {
    if (/\bcategory\b|saffir|cat\s?[1-5]/i.test(text)) return "category";
    return "count";
  }
  if (family === "tornado") {
    if (/\bef\s?(0|1|2|3|4|5)\b|enhanced fujita/i.test(text)) return "category";
    return "count";
  }
  if (family === "monthly-precip" || family === "monthly-snowfall") {
    if (/\bmm\b|millimeter/i.test(text)) return "mm";
    if (/\bcm\b|centimeter/i.test(text)) return "cm";
    return "in";
  }
  // Temperature families.
  if (/°\s?c|\bcelsius\b|\bcentigrade\b/i.test(text)) return "c";
  return "f";
}

function detectPrecision(family: WeatherMarketFamily, unit: WeatherUnit): number {
  switch (family) {
    case "monthly-precip": return unit === "mm" ? 1 : 2;
    case "monthly-snowfall": return 1;
    case "hourly-temp": return 1;
    case "daily-high":
    case "daily-low": return 1;
    case "tornado":
    case "hurricane": return 0;
    default: return 0;
  }
}

function detectRevisionPolicy(
  family: WeatherMarketFamily,
  source: string | null,
  text: string,
): WeatherRevisionPolicy {
  if (family === "hourly-temp") return "fixed-cutoff";
  if (family === "monthly-precip" || family === "monthly-snowfall") return "monthly-total";
  if (family === "hurricane" || family === "tornado") return "season-end";
  if (/preliminary/i.test(text) && /amend|revis/i.test(text)) return "amended";
  if (source && /weather company|nws|noaa/i.test(source)) return "official-final";
  if (/preliminary/i.test(text)) return "preliminary";
  return "unknown";
}

function detectFallbackSource(text: string): string | null {
  // "In the event ... is unavailable, the market will resolve to NWS ..."
  const fallbackMatch = /(?:fallback|backup|in the event of|if[^.]*?is unavailable|if[^.]*?cannot)[^\n]{0,160}?(national weather service|\bnws\b|noaa|weather company|accuweather)/i.exec(text);
  if (fallbackMatch?.[1]) {
    return detectWeatherSource(fallbackMatch[1]);
  }
  // Domestic TWC high/low markets implicitly fall back to NWS.
  if (/weather company|climatological report|\bcli[a-z]{2,4}\b/i.test(text)) {
    return "NWS";
  }
  return null;
}

function resolveStation(
  input: WeatherMarketInput,
  family: WeatherMarketFamily,
): string | null {
  if (family === "where-rain" || family === "hurricane" || family === "tornado" || family === "drought") {
    return null;
  }
  const settlement = resolveWeatherSettlement({
    venue: input.venue,
    seriesTicker: input.seriesTicker,
    eventTicker: input.eventTicker,
    marketId: input.marketId,
    category: input.category,
    title: input.title,
    description: input.description,
    rulesPrimary: input.rulesPrimary,
    rulesSecondary: input.rulesSecondary,
    resolutionSource: input.resolutionSource,
    settlementUrl: input.settlementUrl,
  });
  if (settlement?.stationId) return settlement.stationId;
  // Try to find a station token in the rules (e.g. "(CLILAX)").
  const cliMatch = /\(cli([a-z]{2,5})\)/i.exec(joinFields(input.rulesPrimary, input.rulesSecondary, input.description));
  if (cliMatch?.[1]) {
    return canonicalWeatherStationId(cliMatch[1]) ?? null;
  }
  return null;
}

function resolveTimezone(stationId: string | null): string | null {
  if (!stationId) return null;
  return findWeatherStation(stationId)?.timezone ?? null;
}

/**
 * Core normalizer. Parses a venue-agnostic {@link WeatherMarketInput} into a
 * {@link WeatherMarketSpec}, or returns a `recognized: false` spec when the
 * input is not a weather market.
 */
export function normalizeWeatherMarket(input: WeatherMarketInput): WeatherMarketSpec {
  const rulesText = joinFields(input.rulesPrimary, input.rulesSecondary);
  const sourceText = joinFields(input.resolutionSource, rulesText, input.description);
  const titleText = joinFields(input.title, input.marketLabel, input.eventLabel);
  const fullText = joinFields(sourceText, titleText, input.category);

  const recognized = isWeatherMarket(input);
  if (!recognized) {
    return {
      venue: input.venue,
      family: "daily-high",
      stationId: null,
      source: null,
      dateWindow: null,
      timezone: null,
      unit: "f",
      precision: 0,
      bracket: "categorical",
      floor: null,
      cap: null,
      revisionPolicy: "unknown",
      fallbackSource: null,
      settlementUrl: null,
      marketId: input.marketId,
      sourceExplicit: false,
      recognized: false,
    };
  }

  const detectedSource = detectWeatherSource(sourceText);
  const baseSourceExplicit = detectedSource != null
    || /weather company|climatological report|\bcli[a-z]{2,4}\b/i.test(sourceText)
    || parseKalshiWeatherSeriesTicker(
      input.seriesTicker ?? input.eventTicker ?? input.marketId,
    ) != null;

  // Severe-weather families (hurricane/tornado/drought) are resolved by the
  // dedicated severe module, which enforces the "source must be explicit" rule
  // and excludes daily-weather markets. They take precedence over text patterns.
  const severe = resolveSevereFamily(input);
  let family = familyFromKalshiSeries(
    input.seriesTicker ?? input.eventTicker,
  );
  if (!family && severe) family = severe.family;
  if (!family) family = familyFromText(fullText);
  if (!family) {
    // Series said weather but we could not classify; default by metric.
    const parsed = parseKalshiWeatherSeriesTicker(
      input.seriesTicker ?? input.eventTicker ?? input.marketId,
    );
    family = parsed ? (parsed.metric === "low" ? "daily-low" : "daily-high") : "daily-high";
  }

  const stationId = resolveStation(input, family);
  const dateWindow = detectDateWindow(input, family);
  const timezone = resolveTimezone(stationId);
  const unit = detectUnit(family, fullText);
  const precision = detectPrecision(family, unit);
  const { bracket, floor, cap } = detectBracket(input, family);

  // Source resolution: severe families delegate to the severe source registry;
  // everything else uses the TWC/NWS/NOAA label detector + station inference.
  let source: string | null;
  let sourceExplicit: boolean;
  let settlementUrl: string | null;
  const explicitSettlementUrl = input.settlementUrl?.trim() || null;
  if (severe && family === severe.family) {
    source = severe.source;
    sourceExplicit = true;
    settlementUrl = explicitSettlementUrl ?? severe.sourceUrl;
  } else {
    source = detectedSource
      ?? (input.venue === "kalshi" && stationId ? "The Weather Company" : null)
      ?? detectWeatherSource(titleText);
    sourceExplicit = baseSourceExplicit;
    settlementUrl = explicitSettlementUrl
      ?? (input.venue === "kalshi" && stationId ? TWC_KALSHI_URL : null)
      ?? resolveSettlementUrl(source, sourceText);
  }

  const revisionPolicy = detectRevisionPolicy(family, source, rulesText || titleText);
  const fallbackSource = detectFallbackSource(rulesText || titleText);

  return {
    venue: input.venue,
    family,
    stationId,
    source,
    dateWindow,
    timezone,
    unit,
    precision,
    bracket,
    floor,
    cap,
    revisionPolicy,
    fallbackSource,
    settlementUrl,
    marketId: input.marketId,
    sourceExplicit,
    recognized: true,
  };
}

// ---------------------------------------------------------------------------
// Venue adapters — thin shims that build a WeatherMarketInput from a raw
// venue record and delegate to normalizeWeatherMarket.
// ---------------------------------------------------------------------------

function parseStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/** Normalize a raw Kalshi market record (+ optional event metadata). */
export function normalizeKalshiWeatherMarket(
  record: KalshiMarketRecord,
  eventMeta?: {
    title?: string;
    category?: string;
    series_ticker?: string;
    sub_title?: string;
  },
): WeatherMarketSpec {
  return normalizeWeatherMarket({
    venue: "kalshi",
    marketId: record.ticker,
    title: record.title,
    marketLabel: record.yes_sub_title,
    eventLabel: eventMeta?.title,
    eventTicker: record.event_ticker,
    seriesTicker: eventMeta?.series_ticker,
    category: eventMeta?.category,
    description: eventMeta?.sub_title,
    rulesPrimary: record.rules_primary,
    rulesSecondary: record.rules_secondary,
    strikeType: record.strike_type,
    floorStrike: record.floor_strike,
    capStrike: record.cap_strike,
    endsAt: record.close_time ?? null,
    outcomes: record.yes_sub_title
      ? [record.yes_sub_title, record.no_sub_title ?? "No"]
      : undefined,
  });
}

/** Normalize a raw Polymarket market record (+ optional event). */
export function normalizePolymarketWeatherMarket(
  record: PolymarketMarketRecord,
  event?: PolymarketEventRecord,
): WeatherMarketSpec {
  const hydrated = event ? { ...record, events: [event] } : record;
  return normalizeWeatherMarket({
    venue: "polymarket",
    marketId: record.id ?? record.slug ?? record.question,
    title: record.question,
    marketLabel: record.groupItemTitle,
    eventLabel: event?.title,
    category: event?.tags?.map((tag) => tag.label ?? "").filter(Boolean).join(", "),
    description: record.description ?? event?.description,
    rulesPrimary: record.description,
    resolutionSource: record.resolutionSource ?? event?.resolutionSource,
    outcomes: parseStringArray(hydrated.outcomes),
    endsAt: record.endDate ?? event?.endDate ?? null,
  });
}
