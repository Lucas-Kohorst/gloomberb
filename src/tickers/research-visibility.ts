import type { TickerRecord } from "../types/ticker";

const ALT_PREFIX = /^(POLY|KALSHI|PM|ADJ|FRED|OWID|POLL|WX|NWS|BENCH|UST):/i;
const PREDICTION_CATEGORIES = new Set([
  "POLYMARKET",
  "KALSHI",
  "PREDICTION",
  "PREDICTIONMARKET",
  "EVENT",
  "EVENTCONTRACT",
]);

function normalizeCategory(value?: string): string {
  return (value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
}

/** Prefixed chart instruments and prediction-market tickers — not equities. */
export function isAltInstrumentTicker(ticker: TickerRecord | null | undefined): boolean {
  if (!ticker) return false;
  if (PREDICTION_CATEGORIES.has(normalizeCategory(ticker.metadata.assetCategory))) return true;
  return ALT_PREFIX.test(ticker.metadata.ticker);
}

/** Analyst, dividends, holders, and other equity-only DES tabs. */
export function isEquityResearchTicker(ticker: TickerRecord | null | undefined): boolean {
  return !!ticker && !isAltInstrumentTicker(ticker);
}
