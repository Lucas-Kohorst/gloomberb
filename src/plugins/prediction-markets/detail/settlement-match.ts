import { CRYPTO_CASHTAGS, extractArticleTickersFromParts } from "../../../news/article-tickers";
import { listKnownFredSeries } from "../../builtin/econ/fred-series-map";
import {
  ADJACENT_INDEX_CATALOG,
  POLL_SUBJECTS,
  TREASURY_CATALOG,
  findTreasuryCatalogEntry,
  findVolCatalogEntry,
} from "../../builtin/chart-composer/universal-series";
import {
  WEATHER_STATIONS,
  findWeatherStation,
  canonicalWeatherStationId,
} from "../../builtin/weather/stations";
import {
  parseKalshiWeatherSeriesTicker,
  resolveWeatherSettlement,
  weatherMetricLabel,
} from "../../builtin/weather/mapping";
import { TWC_KALSHI_URL, type WeatherMetric } from "../../builtin/weather/types";
import type { PredictionMarketSummary } from "../types";

/** How the matcher found a row. Higher precision first. */
export type SettlementMatchRank = "rules" | "map" | "ticker" | "alias";

export interface SettlementSeriesMatch {
  id: string;
  label: string;
  source: string;
  expression: string;
  reason: SettlementMatchRank;
  url?: string;
  /** Longer explanation of source/station/metric for the detail line. */
  description?: string;
}

export interface SettlementMatchResult {
  sourceLabel: string | null;
  sourceSnippet: string | null;
  series: SettlementSeriesMatch[];
}

const RANK_WEIGHT: Record<SettlementMatchRank, number> = {
  rules: 4,
  map: 3,
  ticker: 2,
  alias: 1,
};

const CRYPTO_SERIES: ReadonlyArray<{
  symbol: string;
  name: string;
  tokens: readonly string[];
}> = [
  { symbol: "BTC-USD", name: "Bitcoin", tokens: ["bitcoin", "btc-usd", "btcusd", "xbtusd", "xbt"] },
  { symbol: "ETH-USD", name: "Ethereum", tokens: ["ethereum", "ether", "eth-usd", "ethusd"] },
  { symbol: "SOL-USD", name: "Solana", tokens: ["solana", "sol-usd"] },
  { symbol: "XRP-USD", name: "XRP", tokens: ["xrp-usd", "ripple"] },
];

const SECURITY_ALIASES: ReadonlyArray<{
  symbol: string;
  label: string;
  names: readonly string[];
  related?: ReadonlyArray<{ symbol: string; label: string }>;
}> = [
  {
    symbol: "MSTR",
    label: "Strategy (MSTR)",
    names: ["microstrategy", "strategy inc", "strategy, inc"],
    related: [
      { symbol: "STRF", label: "Strategy Strife (STRF)" },
      { symbol: "STRC", label: "Strategy Stretch (STRC)" },
      { symbol: "STRK", label: "Strategy Strike (STRK)" },
      { symbol: "STRD", label: "Strategy Stride (STRD)" },
    ],
  },
];

const EQUITY_TICKER_RE = /^[A-Z]{1,5}(?:[.-][A-Z0-9]+)?$/;

const FRED_ALIASES: ReadonlyArray<{
  seriesId: string;
  label: string;
  /** Resolution-source / rules phrases (rank `map`). */
  map: readonly string[];
  /** Weaker tokens, rules-only (rank `alias`). */
  alias?: readonly string[];
}> = [
  {
    seriesId: "CPIAUCSL",
    label: "CPI (CPIAUCSL)",
    map: ["cpi-u", "cpi u", "bls cpi", "headline cpi", "consumer price index for all urban", "consumer price index"],
    alias: ["cpi"],
  },
  {
    seriesId: "CPILFESL",
    label: "Core CPI (CPILFESL)",
    map: ["cpilfesl", "core cpi", "core consumer price"],
  },
  {
    seriesId: "UNRATE",
    label: "Unemployment rate (UNRATE)",
    map: ["unrate", "unemployment rate"],
    alias: ["unemployment"],
  },
  {
    seriesId: "PAYEMS",
    label: "Nonfarm payrolls (PAYEMS)",
    map: ["payems", "nonfarm payroll", "non-farm payroll", "nfp"],
  },
  {
    seriesId: "FEDFUNDS",
    label: "Federal funds rate (FEDFUNDS)",
    map: [
      "fedfunds",
      "federal funds rate",
      "fed funds rate",
      "fed funds",
      "fomc",
      "federal open market committee",
      "fed rate",
      "fed cut",
      "fed hike",
    ],
  },
  {
    seriesId: "DFEDTARU",
    label: "Fed funds target upper (DFEDTARU)",
    map: ["dfedtaru", "federal funds target", "fed funds target"],
  },
  {
    seriesId: "GDP",
    label: "GDP (GDP)",
    map: ["gross domestic product", "gdp q/q", "advance gdp", "final gdp", "real gdp"],
  },
  {
    seriesId: "PCEPI",
    label: "PCE price index (PCEPI)",
    map: ["pcepi", "pce price index", "personal consumption expenditures price"],
  },
];

const EXPLICIT_EXPRESSION_RE =
  /\b((?:FRED|UST|WX|NWS|POLL|ADJ|OWID|FUT|BENCH):[A-Za-z0-9][A-Za-z0-9._:-]{0,80}|[A-Z]{3,5}-USD)\b/gi;

const SETTLEMENT_CONTEXT_RE =
  /\b(resolv|settle|settlement|according to|reported by|published by|source|underlying|index|benchmark|bls|bureau of labor|weather company|nws|noaa|fred|coinbase|binance|cf benchmarks|reference rate|official)\b/i;

const ELECTION_RE =
  /\b(election|electoral college|presidential|president of the united states|who will win the presidency|white house race|senate control|house control|governor's race)\b/i;

const GDP_PRINT_RE =
  /\b(gross domestic product|real gdp|gdp\s*(q\/q|print|growth|advance|final|prelim)|fred:\s*gdp)\b/i;

type SummaryFields = Pick<
  PredictionMarketSummary,
  | "venue"
  | "marketId"
  | "title"
  | "marketLabel"
  | "eventLabel"
  | "eventTicker"
  | "seriesTicker"
  | "category"
  | "description"
  | "rulesPrimary"
  | "rulesSecondary"
  | "resolutionSource"
  | "url"
>;

function joinFields(...values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => !!value && value.trim().length > 0)
    .join("\n");
}

function haystack(value: string): string {
  return value.toLowerCase();
}

function hasToken(text: string, token: string): boolean {
  const escaped = token.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function hasPhrase(text: string, phrase: string): boolean {
  if (hasToken(text, phrase) || haystack(text).includes(phrase.toLowerCase())) return true;
  const pattern = phrase
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[\s-]+/g, "[\\s-]+");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(text);
}

function isElectionMarket(text: string): boolean {
  return ELECTION_RE.test(text) && !GDP_PRINT_RE.test(text);
}

function knownFredById(): Map<string, { seriesId: string; label: string }> {
  const map = new Map<string, { seriesId: string; label: string }>();
  for (const entry of FRED_ALIASES) {
    map.set(entry.seriesId.toUpperCase(), { seriesId: entry.seriesId, label: entry.label });
  }
  for (const known of listKnownFredSeries()) {
    if (!map.has(known.seriesId.toUpperCase())) {
      map.set(known.seriesId.toUpperCase(), known);
    }
  }
  for (const treasury of TREASURY_CATALOG) {
    map.set(treasury.seriesId.toUpperCase(), {
      seriesId: treasury.seriesId,
      label: treasury.label,
    });
  }
  return map;
}

function pushSeries(rows: SettlementSeriesMatch[], row: SettlementSeriesMatch): void {
  const existing = rows.find((item) => item.expression === row.expression || item.id === row.id);
  if (existing) {
    if (RANK_WEIGHT[row.reason] > RANK_WEIGHT[existing.reason]) {
      existing.id = row.id;
      existing.label = row.label;
      existing.source = row.source;
      existing.expression = row.expression;
      existing.reason = row.reason;
      existing.url = row.url;
    }
    return;
  }
  rows.push(row);
}

function fredUrl(seriesId: string): string {
  return `https://fred.stlouisfed.org/series/${seriesId}`;
}

function pushFred(
  rows: SettlementSeriesMatch[],
  seriesId: string,
  label: string,
  reason: SettlementMatchRank,
): void {
  const treasury = TREASURY_CATALOG.find((entry) => entry.seriesId.toUpperCase() === seriesId.toUpperCase());
  if (treasury) {
    pushSeries(rows, {
      id: `ust:${treasury.maturity}`,
      label: treasury.label,
      source: "FRED",
      expression: `UST:${treasury.maturity}`,
      reason,
      url: fredUrl(treasury.seriesId),
    });
    return;
  }
  pushSeries(rows, {
    id: `fred:${seriesId}`,
    label,
    source: "FRED",
    expression: `FRED:${seriesId}`,
    reason,
    url: fredUrl(seriesId),
  });
}

function matchExplicitExpressions(text: string, rows: SettlementSeriesMatch[]): void {
  const fredIds = knownFredById();
  EXPLICIT_EXPRESSION_RE.lastIndex = 0;
  for (const match of text.matchAll(EXPLICIT_EXPRESSION_RE)) {
    const raw = match[1];
    if (!raw) continue;
    const upper = raw.toUpperCase();
    if (upper.startsWith("FRED:")) {
      const seriesId = upper.slice("FRED:".length);
      const known = fredIds.get(seriesId);
      pushFred(rows, seriesId, known?.label ?? seriesId, "rules");
      continue;
    }
    if (upper.startsWith("UST:")) {
      const maturity = raw.slice("UST:".length);
      const treasury = findTreasuryCatalogEntry(maturity) ?? TREASURY_CATALOG.find(
        (entry) => entry.maturity.toLowerCase() === maturity.toLowerCase(),
      );
      if (!treasury) continue;
      pushFred(rows, treasury.seriesId, treasury.label, "rules");
      continue;
    }
    if (upper.endsWith("-USD") && CRYPTO_SERIES.some((coin) => coin.symbol === upper)) {
      const coin = CRYPTO_SERIES.find((entry) => entry.symbol === upper)!;
      pushSeries(rows, {
        id: `crypto:${coin.symbol}`,
        label: `${coin.name} (${coin.symbol})`,
        source: "Yahoo",
        expression: `${coin.symbol}:price`,
        reason: "rules",
      });
    }
  }

  for (const [seriesId, known] of fredIds) {
    // Short FRED ids (GDP, PI, IR) are too easy to false-positive without a prefix.
    if (seriesId.length < 5) continue;
    if (!hasToken(text, seriesId)) continue;
    pushFred(rows, known.seriesId, known.label, "rules");
  }
}

function matchResolutionMap(text: string, rows: SettlementSeriesMatch[]): void {
  const lower = haystack(text);
  for (const entry of FRED_ALIASES) {
    if (entry.seriesId === "GDP" && isElectionMarket(text)) continue;
    if (entry.seriesId === "CPIAUCSL" && /core cpi|cpilfesl/i.test(text) && !hasPhrase(lower, "cpi-u")) {
      continue;
    }
    if (entry.map.some((phrase) => hasPhrase(lower, phrase))) {
      pushFred(rows, entry.seriesId, entry.label, "map");
    }
  }
}

const FOMC_RE =
  /\b(fomc|federal open market committee|fed funds|federal funds|fed rate|fed cut|fed hike)\b/i;

function matchFomcCompanions(text: string, rows: SettlementSeriesMatch[]): void {
  if (!FOMC_RE.test(text)) return;
  pushFred(rows, "FEDFUNDS", "Federal funds rate (FEDFUNDS)", "map");
  pushFred(rows, "DFEDTARU", "Fed funds target upper (DFEDTARU)", "map");
  const treasury = findTreasuryCatalogEntry("10Y");
  if (treasury) {
    pushFred(rows, treasury.seriesId, treasury.label, "alias");
  }
}

function matchWeakAliases(rulesText: string, rows: SettlementSeriesMatch[]): void {
  if (!SETTLEMENT_CONTEXT_RE.test(rulesText)) return;
  const lower = haystack(rulesText);
  for (const entry of FRED_ALIASES) {
    if (entry.seriesId === "GDP" && isElectionMarket(rulesText)) continue;
    if (entry.seriesId === "CPIAUCSL" && /core cpi|cpilfesl/i.test(rulesText)) continue;
    const aliases = entry.alias ?? [];
    if (aliases.some((token) => hasToken(lower, token))) {
      pushFred(rows, entry.seriesId, entry.label, "alias");
    }
  }
}

// ---------------------------------------------------------------------------
// Weather settlement detection
// ---------------------------------------------------------------------------

/** Title/rules phrases that signal a temperature / precip market. */
const WEATHER_TITLE_RE =
  /\b(temperature|daily\s+high|daily\s+low|max(?:imum)?\s+temp|min(?:imum)?\s+temp|precipitation|rainfall|snowfall|how\s+much\s+(?:rain|snow)|inches\s+of\s+(?:rain|snow))\b/i;

/** Explicit settlement-source mentions (Weather Company, NWS, NOAA, CLI). */
const WEATHER_SOURCE_RE =
  /\b(weather\s+company|weather\.com|weather\.gov|national\s+weather\s+service|\bnws\b|\bnoaa\b|climatological\s+report|hong kong observatory|weather underground)\b/i;

const WEATHER_CATEGORY_RE = /\b(weather|climate)\b/i;

const WEATHER_METRIC_PATTERNS: ReadonlyArray<{ re: RegExp; metric: WeatherMetric }> = [
  { re: /\b(low(?:est)?\s+temp|daily\s+low|min(?:imum)?\s+temp|low\s+temperature)\b/i, metric: "low" },
  { re: /\b(precip(?:itation)?|rain(?:fall)?|snow(?:fall)?)\b/i, metric: "precip" },
  { re: /\b(hourly\s+temp|temp(?:erature)?\s+at\s+\d+)\b/i, metric: "hourly" },
];

function detectWeatherMetric(text: string): WeatherMetric {
  for (const { re, metric } of WEATHER_METRIC_PATTERNS) {
    if (re.test(text)) return metric;
  }
  return "high";
}

/**
 * Text-based weather detection for venues without Kalshi-style tickers
 * (e.g. Polymarket). Requires a weather context keyword AND a matching
 * station city name to avoid false positives on non-weather markets.
 */
function detectWeatherFromText(summary: SummaryFields): {
  stationId: string;
  metric: WeatherMetric;
  hasExplicitSource: boolean;
} | null {
  const text = joinFields(
    summary.title,
    summary.description,
    summary.rulesPrimary,
    summary.rulesSecondary,
    summary.resolutionSource,
    summary.category,
  );
  const hasExplicitSource = WEATHER_SOURCE_RE.test(text);
  const hasWeatherContext =
    WEATHER_TITLE_RE.test(text)
    || hasExplicitSource
    || WEATHER_CATEGORY_RE.test(summary.category ?? "");
  if (!hasWeatherContext) return null;
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");

  for (const station of WEATHER_STATIONS) {
    const cleanCity = station.city
      .replace(/\s*\(.*\)\s*/, "")
      .replace(/,\s*[A-Z]{2}$/, "")
      .trim();
    const cityVariants = [
      cleanCity,
      station.id,
      station.icao,
      ...station.aliases,
    ];
    if (cleanCity.includes(",")) {
      cityVariants.push(cleanCity.split(",")[0]!.trim());
    }
    if (cleanCity === "New York City") cityVariants.push("New York");

    const matched = cityVariants.some((name) => {
      const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return normalizedName.length >= 3 && normalizedText.includes(normalizedName);
    });
    if (!matched) continue;

    return {
      stationId: station.id,
      metric: detectWeatherMetric(text),
      hasExplicitSource,
    };
  }
  return null;
}

function matchWeather(summary: SummaryFields, rows: SettlementSeriesMatch[]): string | null {
  const settlement = resolveWeatherSettlement({
    venue: summary.venue,
    seriesTicker: summary.seriesTicker,
    eventTicker: summary.eventTicker,
    marketId: summary.marketId,
    category: summary.category,
    title: summary.title,
    description: summary.description,
    rulesPrimary: summary.rulesPrimary,
    rulesSecondary: summary.rulesSecondary,
    resolutionSource: summary.resolutionSource,
  });
  const parsed = parseKalshiWeatherSeriesTicker(
    summary.seriesTicker ?? summary.eventTicker ?? summary.marketId,
  );
  let stationId = settlement?.stationId ?? parsed?.stationId ?? null;
  let metric: WeatherMetric = settlement?.metric ?? parsed?.metric ?? "high";
  let detected: { stationId: string; metric: WeatherMetric; hasExplicitSource: boolean } | null = null;
  if (!stationId) {
    detected = detectWeatherFromText(summary);
    if (detected) {
      stationId = detected.stationId;
      metric = detected.metric;
    }
  }
  if (!stationId) return null;
  const station = findWeatherStation(stationId);
  const canonical = canonicalWeatherStationId(stationId) ?? stationId;
  const metricLabel = weatherMetricLabel(metric);
  const structured = Boolean(settlement || parsed);
  const reason: SettlementMatchRank =
    structured || (detected?.hasExplicitSource ?? false) ? "map" : "alias";
  const cityLabel = station?.city ?? canonical;
  const cliProduct = settlement?.cliProduct ?? (station ? `CLI${canonical}` : null);

  pushSeries(rows, {
    id: `wx:${canonical}:${metric}`,
    label: `${canonical} · ${metricLabel}`,
    source: "Weather Company",
    expression: `WX:${canonical}:${metric}`,
    reason,
    url: TWC_KALSHI_URL,
    description: `Weather Company ${cliProduct ?? `CLI${canonical}`} ${metricLabel.toLowerCase()} for ${cityLabel}`,
  });
  if (station?.scope === "domestic" && (metric === "high" || metric === "low")) {
    pushSeries(rows, {
      id: `nws:${station.icao}:${metric}`,
      label: `${station.icao} · NWS ${metricLabel}`,
      source: "NWS",
      expression: `NWS:${station.icao}:${metric}`,
      reason,
      url: "https://www.weather.gov",
      description: `NWS ${station.icao} Daily Climate Report first-final ${metricLabel.toLowerCase()} print for ${cityLabel}`,
    });
  }

  if (settlement) {
    return cliProduct
      ? `Weather Company ${cliProduct}${settlement.date ? ` · ${settlement.date}` : ""}`
      : `Weather ${canonical}`;
  }
  if (detected) {
    return detected.hasExplicitSource
      ? (summary.resolutionSource?.trim() || `Weather Company ${cliProduct ?? canonical}`)
      : `Weather ${canonical}`;
  }
  return cliProduct ? `Weather Company ${cliProduct}` : `Weather ${canonical}`;
}

function cryptoFromToken(token: string): (typeof CRYPTO_SERIES)[number] | null {
  const lower = token.toLowerCase();
  const upper = token.toUpperCase();
  return CRYPTO_SERIES.find((coin) => (
    coin.symbol === upper
    || coin.symbol === `${upper}-USD`
    || coin.tokens.some((item) => item === lower)
    || CRYPTO_CASHTAGS.has(upper) && coin.symbol.startsWith(`${upper}-`)
  )) ?? null;
}

function matchTitleTickers(titleText: string, rows: SettlementSeriesMatch[]): void {
  const tickers = extractArticleTickersFromParts([titleText]);
  for (const ticker of tickers) {
    const coin = cryptoFromToken(ticker);
    if (coin) {
      pushSeries(rows, {
        id: `crypto:${coin.symbol}`,
        label: `${coin.name} (${coin.symbol})`,
        source: "Yahoo",
        expression: `${coin.symbol}:price`,
        reason: "ticker",
      });
      continue;
    }
    const treasury = findTreasuryCatalogEntry(ticker);
    if (treasury) {
      pushFred(rows, treasury.seriesId, treasury.label, "ticker");
      continue;
    }
    const vol = findVolCatalogEntry(ticker);
    if (vol) {
      pushFred(rows, vol.seriesId, vol.label, "ticker");
      continue;
    }
    if (!EQUITY_TICKER_RE.test(ticker) || CRYPTO_CASHTAGS.has(ticker)) continue;
    const entry = SECURITY_ALIASES.find((item) => item.symbol === ticker);
    if (entry) {
      pushPrimarySecurity(rows, entry, "ticker");
      continue;
    }
    pushEquity(rows, ticker, ticker, "ticker");
  }
}

function pushEquity(
  rows: SettlementSeriesMatch[],
  symbol: string,
  label: string,
  reason: SettlementMatchRank,
): void {
  pushSeries(rows, {
    id: `equity:${symbol}`,
    label,
    source: "Yahoo",
    expression: `${symbol}:price`,
    reason,
  });
}

function pushPrimarySecurity(
  rows: SettlementSeriesMatch[],
  entry: (typeof SECURITY_ALIASES)[number],
  reason: SettlementMatchRank,
): void {
  pushEquity(rows, entry.symbol, entry.label, reason);
  for (const related of entry.related ?? []) {
    pushEquity(rows, related.symbol, related.label, "alias");
  }
}

function matchSecurityAliases(text: string, rows: SettlementSeriesMatch[]): void {
  const lower = haystack(text);
  for (const entry of SECURITY_ALIASES) {
    if (!entry.names.some((name) => hasPhrase(lower, name))) continue;
    pushPrimarySecurity(rows, entry, "map");
  }
}

function matchCryptoPhrases(text: string, rank: SettlementMatchRank, rows: SettlementSeriesMatch[]): void {
  const lower = haystack(text);
  for (const coin of CRYPTO_SERIES) {
    const hit = coin.tokens.some((token) => hasToken(lower, token))
      || hasToken(lower, coin.symbol.toLowerCase())
      || (coin.symbol === "BTC-USD" && hasToken(lower, "btc"));
    if (!hit) continue;
    pushSeries(rows, {
      id: `crypto:${coin.symbol}`,
      label: `${coin.name} (${coin.symbol})`,
      source: "Yahoo",
      expression: `${coin.symbol}:price`,
      reason: rank,
    });
  }
}

function matchPolls(text: string, rows: SettlementSeriesMatch[]): void {
  if (!/\b(poll|approval|favorab|votehub|survey)\b/i.test(text)) return;
  const lower = haystack(text);
  for (const subject of POLL_SUBJECTS) {
    const names = subject.subject.toLowerCase().split(/\s+/).filter((part) => part.length >= 4);
    const hit = hasToken(lower, subject.subject.toLowerCase())
      || names.some((name) => hasToken(lower, name));
    if (!hit) continue;
    for (const choice of subject.choices) {
      pushSeries(rows, {
        id: `poll:${subject.subject}:${choice}`,
        label: `${subject.subject} · ${choice}`,
        source: "VoteHub",
        expression: `POLL:${subject.subject}:${choice}`,
        reason: "alias",
      });
    }
  }
}

function matchAdjacentIndices(text: string, rows: SettlementSeriesMatch[]): void {
  const lower = haystack(text);
  for (const index of ADJACENT_INDEX_CATALOG) {
    const precise = [index.indexId, index.ticker, `${index.ticker} index`, `${index.indexId} index`];
    const hit = precise.some((token) => hasToken(lower, token))
      || /\badjacent\b/i.test(text) && index.aliases.some((alias) => hasToken(lower, alias));
    if (!hit) continue;
    pushSeries(rows, {
      id: `adj:${index.indexId}`,
      label: index.name,
      source: "Adjacent",
      expression: `ADJ:${index.indexId}`,
      reason: hasToken(lower, index.indexId) || hasToken(lower, index.ticker) ? "map" : "alias",
      url: "https://adjacent.markets",
    });
  }
}

function matchTreasuryPhrases(text: string, rank: SettlementMatchRank, rows: SettlementSeriesMatch[]): void {
  const lower = haystack(text);
  for (const treasury of TREASURY_CATALOG) {
    const maturity = treasury.maturity.toLowerCase();
    const phrases = [
      treasury.seriesId.toLowerCase(),
      `${maturity} treasury`,
      `${maturity} yield`,
      `${maturity.replace(/y$/, "-year")} treasury`,
    ];
    if (maturity === "10y") phrases.push("10-year treasury", "10 year treasury", "10-year yield");
    if (!phrases.some((phrase) => hasPhrase(lower, phrase))) continue;
    pushFred(rows, treasury.seriesId, treasury.label, rank);
  }
}

function extractSnippet(text: string): string | null {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const hit = lines.find((line) => SETTLEMENT_CONTEXT_RE.test(line));
  const chosen = hit ?? lines[0] ?? null;
  if (!chosen) return null;
  return chosen.length > 180 ? `${chosen.slice(0, 177)}...` : chosen;
}

export function matchSettlementSeries(summary: SummaryFields): SettlementMatchResult {
  const rulesText = joinFields(
    summary.resolutionSource,
    summary.rulesPrimary,
    summary.rulesSecondary,
  );
  const titleText = joinFields(summary.title, summary.marketLabel, summary.eventLabel);
  const fullText = joinFields(rulesText, summary.description, titleText, summary.category);
  const series: SettlementSeriesMatch[] = [];

  const weatherLabel = matchWeather(summary, series);
  matchExplicitExpressions(rulesText, series);
  matchResolutionMap(joinFields(rulesText, titleText), series);
  matchFomcCompanions(joinFields(rulesText, titleText, summary.description), series);
  matchCryptoPhrases(rulesText, "map", series);
  matchTreasuryPhrases(rulesText, "map", series);
  matchTitleTickers(joinFields(titleText, rulesText), series);
  matchCryptoPhrases(titleText, "ticker", series);
  matchSecurityAliases(joinFields(titleText, rulesText), series);
  matchWeakAliases(rulesText, series);
  matchPolls(fullText, series);
  matchAdjacentIndices(fullText, series);

  series.sort((left, right) => {
    const rank = RANK_WEIGHT[right.reason] - RANK_WEIGHT[left.reason];
    if (rank !== 0) return rank;
    return left.label.localeCompare(right.label);
  });

  const snippetSource = rulesText || summary.description || "";
  const sourceSnippet = extractSnippet(snippetSource);
  const sourceLabel = summary.resolutionSource?.trim()
    || weatherLabel
    || series[0]?.label
    || sourceSnippet
    || null;

  return {
    sourceLabel,
    sourceSnippet,
    series,
  };
}
