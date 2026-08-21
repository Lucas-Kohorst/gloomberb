import { listKnownFredSeries } from "../../builtin/econ/fred-series-map";
import {
  ADJACENT_INDEX_CATALOG,
  POLL_SUBJECTS,
  TREASURY_CATALOG,
} from "../../builtin/chart-composer/universal-series";
import {
  findWeatherStation,
  canonicalWeatherStationId,
} from "../../builtin/weather/stations";
import {
  parseKalshiWeatherSeriesTicker,
  resolveWeatherSettlement,
  weatherMetricLabel,
} from "../../builtin/weather/mapping";
import { TWC_KALSHI_URL } from "../../builtin/weather/types";
import type { PredictionMarketSummary } from "../types";

export interface SettlementSeriesMatch {
  id: string;
  label: string;
  source: string;
  expression: string;
  reason: string;
  url?: string;
}

export interface SettlementMatchResult {
  sourceLabel: string | null;
  sourceSnippet: string | null;
  series: SettlementSeriesMatch[];
}

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

const FRED_ALIASES: ReadonlyArray<{
  seriesId: string;
  label: string;
  strong: readonly string[];
  weak?: readonly string[];
}> = [
  {
    seriesId: "CPIAUCSL",
    label: "CPI (CPIAUCSL)",
    strong: ["cpiaucsl", "cpi-u", "consumer price index"],
    weak: ["cpi", "headline cpi"],
  },
  {
    seriesId: "CPILFESL",
    label: "Core CPI (CPILFESL)",
    strong: ["cpilfesl", "core cpi", "core consumer price"],
  },
  {
    seriesId: "UNRATE",
    label: "Unemployment rate (UNRATE)",
    strong: ["unrate", "unemployment rate"],
  },
  {
    seriesId: "PAYEMS",
    label: "Nonfarm payrolls (PAYEMS)",
    strong: ["payems", "nonfarm payroll", "non-farm payroll", "nfp"],
  },
  {
    seriesId: "FEDFUNDS",
    label: "Federal funds rate (FEDFUNDS)",
    strong: ["fedfunds", "federal funds rate", "fed funds"],
  },
  {
    seriesId: "GDP",
    label: "GDP (GDP)",
    strong: ["gross domestic product"],
    weak: ["gdp"],
  },
  {
    seriesId: "PCEPI",
    label: "PCE price index (PCEPI)",
    strong: ["pcepi", "pce price index", "personal consumption expenditures price"],
  },
];

const SETTLEMENT_CONTEXT_RE =
  /\b(resolv|settle|settlement|according to|reported by|published by|source|underlying|index|benchmark|bls|bureau of labor|weather company|nws|noaa|fred|coinbase|binance|cf benchmarks|reference rate|official)\b/i;

function blobFromSummary(
  summary: Pick<
    PredictionMarketSummary,
    | "title"
    | "description"
    | "rulesPrimary"
    | "rulesSecondary"
    | "resolutionSource"
    | "category"
    | "marketLabel"
    | "eventLabel"
  >,
): string {
  return [
    summary.resolutionSource,
    summary.rulesPrimary,
    summary.rulesSecondary,
    summary.description,
    summary.title,
    summary.marketLabel,
    summary.eventLabel,
    summary.category,
  ]
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

function firstMatchingSentence(text: string, token: string): string | null {
  const sentences = text.split(/[\n.]/).map((part) => part.trim()).filter(Boolean);
  const hit = sentences.find((sentence) => hasToken(sentence, token) || sentence.toLowerCase().includes(token.toLowerCase()));
  if (!hit) return null;
  return hit.length > 140 ? `${hit.slice(0, 137)}...` : hit;
}

function pushSeries(rows: SettlementSeriesMatch[], row: SettlementSeriesMatch): void {
  if (rows.some((existing) => existing.expression === row.expression || existing.id === row.id)) {
    return;
  }
  rows.push(row);
}

function matchWeather(summary: PredictionMarketSummary, text: string, rows: SettlementSeriesMatch[]): string | null {
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
  const stationId = settlement?.stationId ?? parsed?.stationId ?? null;
  const metric = settlement?.metric ?? parsed?.metric ?? "high";
  if (!stationId) return null;
  const station = findWeatherStation(stationId);
  const canonical = canonicalWeatherStationId(stationId) ?? stationId;
  const metricLabel = weatherMetricLabel(metric);
  const reason = settlement
    ? `${settlement.cliProduct} ${metricLabel} on ${settlement.date}`
    : `${canonical} ${metricLabel} from market ticker`;
  pushSeries(rows, {
    id: `wx:${canonical}:${metric}`,
    label: `${station?.city ?? canonical} · ${metricLabel}`,
    source: "Weather Company",
    expression: `WX:${canonical}:${metric}`,
    reason,
    url: TWC_KALSHI_URL,
  });
  if (station?.scope === "domestic" && (metric === "high" || metric === "low")) {
    pushSeries(rows, {
      id: `nws:${station.icao}:${metric}`,
      label: `${station.city} · NWS ${metricLabel}`,
      source: "NWS",
      expression: `NWS:${station.icao}:${metric}`,
      reason: `NWS Daily Climate Report ${station.icao}`,
      url: "https://www.weather.gov",
    });
  }
  const cli = settlement?.cliProduct ?? (station ? `CLI${canonical}` : null);
  return cli
    ? `Weather Company ${cli}${settlement?.date ? ` · ${settlement.date}` : ""}`
    : `Weather ${canonical}`;
}

function matchFred(text: string, rows: SettlementSeriesMatch[]): string | null {
  const lower = haystack(text);
  let sourceLabel: string | null = null;
  for (const entry of FRED_ALIASES) {
    const strongHit = entry.strong.some((token) => hasToken(lower, token) || lower.includes(token));
    const weakHit = (entry.weak ?? []).some((token) => hasToken(lower, token));
    const idHit = hasToken(lower, entry.seriesId.toLowerCase());
    const context = SETTLEMENT_CONTEXT_RE.test(text) || /inflation|labor|payroll|price index|bls|cpi/i.test(text);
    if (idHit || strongHit || (weakHit && context)) {
      pushSeries(rows, {
        id: `fred:${entry.seriesId}`,
        label: entry.label,
        source: "FRED",
        expression: `FRED:${entry.seriesId}`,
        reason: firstMatchingSentence(text, entry.seriesId)
          ?? firstMatchingSentence(text, entry.strong[0] ?? entry.seriesId)
          ?? `Rules mention ${entry.label}`,
        url: `https://fred.stlouisfed.org/series/${entry.seriesId}`,
      });
      sourceLabel ??= entry.label;
    }
  }
  for (const known of listKnownFredSeries()) {
    if (hasToken(lower, known.seriesId.toLowerCase())) {
      pushSeries(rows, {
        id: `fred:${known.seriesId}`,
        label: known.label,
        source: "FRED",
        expression: `FRED:${known.seriesId}`,
        reason: `Rules cite FRED ${known.seriesId}`,
        url: `https://fred.stlouisfed.org/series/${known.seriesId}`,
      });
      sourceLabel ??= known.label;
    }
  }
  for (const treasury of TREASURY_CATALOG) {
    const maturity = treasury.maturity.toLowerCase();
    if (
      hasToken(lower, treasury.seriesId.toLowerCase())
      || (hasToken(lower, `${maturity} treasury`) || /\b10-?year\b/i.test(text) && maturity === "10y")
    ) {
      if (maturity === "10y" && !/\b(10-?year|10y|ust|treasury)\b/i.test(text) && !hasToken(lower, treasury.seriesId.toLowerCase())) {
        continue;
      }
      pushSeries(rows, {
        id: `ust:${treasury.maturity}`,
        label: treasury.label,
        source: "FRED",
        expression: `UST:${treasury.maturity}`,
        reason: `Treasury ${treasury.maturity}`,
        url: `https://fred.stlouisfed.org/series/${treasury.seriesId}`,
      });
    }
  }
  return sourceLabel;
}

function matchCrypto(text: string, rows: SettlementSeriesMatch[]): string | null {
  const lower = haystack(text);
  let sourceLabel: string | null = null;
  for (const coin of CRYPTO_SERIES) {
    const hit = coin.tokens.some((token) => hasToken(lower, token))
      || hasToken(lower, coin.symbol.toLowerCase())
      || (coin.symbol === "BTC-USD" && hasToken(lower, "btc") && /\b(bitcoin|btc-usd|coinbase|binance|cf benchmark|crypto|btc)\b/i.test(text));
    if (!hit) continue;
    if (coin.symbol === "BTC-USD" && !/\b(bitcoin|btc|xbt|crypto|coinbase|binance|cf benchmark)\b/i.test(text)) {
      continue;
    }
    pushSeries(rows, {
      id: `crypto:${coin.symbol}`,
      label: `${coin.name} (${coin.symbol})`,
      source: "Yahoo",
      expression: `${coin.symbol}:price`,
      reason: firstMatchingSentence(text, coin.name)
        ?? firstMatchingSentence(text, coin.symbol)
        ?? `Rules mention ${coin.name}`,
    });
    sourceLabel ??= `${coin.name} ${coin.symbol}`;
  }
  return sourceLabel;
}

function matchPolls(text: string, rows: SettlementSeriesMatch[]): void {
  const lower = haystack(text);
  if (!/\bpoll|approval|favorab|votehub|survey\b/i.test(text)) return;
  for (const subject of POLL_SUBJECTS) {
    if (!hasToken(lower, subject.subject.toLowerCase())) continue;
    for (const choice of subject.choices) {
      pushSeries(rows, {
        id: `poll:${subject.subject}:${choice}`,
        label: `${subject.subject} · ${choice}`,
        source: "VoteHub",
        expression: `POLL:${subject.subject}:${choice}`,
        reason: `Poll subject ${subject.subject}`,
      });
    }
  }
}

function matchAdjacentIndices(text: string, rows: SettlementSeriesMatch[]): void {
  const lower = haystack(text);
  for (const index of ADJACENT_INDEX_CATALOG) {
    const hit = [index.indexId, index.ticker, ...index.aliases].some((token) => hasToken(lower, token));
    if (!hit) continue;
    pushSeries(rows, {
      id: `adj:${index.indexId}`,
      label: index.name,
      source: "Adjacent",
      expression: `ADJ:${index.indexId}`,
      reason: `Adjacent index ${index.ticker}`,
      url: "https://adjacent.markets",
    });
  }
}

function extractSnippet(text: string): string | null {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const hit = lines.find((line) => SETTLEMENT_CONTEXT_RE.test(line));
  if (!hit) return lines[0]?.slice(0, 160) ?? null;
  return hit.length > 180 ? `${hit.slice(0, 177)}...` : hit;
}

export function matchSettlementSeries(
  summary: Pick<
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
  >,
): SettlementMatchResult {
  const full = summary as PredictionMarketSummary;
  const text = blobFromSummary(full);
  const series: SettlementSeriesMatch[] = [];
  const weatherLabel = matchWeather(full, text, series);
  const fredLabel = matchFred(text, series);
  const cryptoLabel = matchCrypto(text, series);
  matchPolls(text, series);
  matchAdjacentIndices(text, series);
  const sourceLabel = weatherLabel ?? fredLabel ?? cryptoLabel ?? summary.resolutionSource?.trim() ?? null;
  return {
    sourceLabel,
    sourceSnippet: extractSnippet(text),
    series,
  };
}
