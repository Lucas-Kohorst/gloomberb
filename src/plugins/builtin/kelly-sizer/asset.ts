import { resolveAssetDisplayKind } from "../../../market-data/market/format";
import type { TickerRecord } from "../../../types/ticker";
import { parseOptionSymbol } from "../../../utils/options";
import { KELLY_MODES, type KellySizingMode } from "./types";

/** Tradable quote classes Kelly can size. Macro series (FRED, OWID, polls) are not positions. */
export type KellyAssetClass =
  | "equity"
  | "crypto"
  | "fx"
  | "futures"
  | "option"
  | "prediction"
  | "unknown";

const PREDICTION_CATEGORIES = new Set([
  "PREDICTION",
  "PREDICTIONMARKET",
  "EVENT",
  "EVENTCONTRACT",
  "KALSHI",
  "POLYMARKET",
]);

function normalizeCategory(value?: string): string {
  return (value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
}

function isPredictionSymbol(symbol: string): boolean {
  return /^(KALSHI|POLY|PM)[:/]/.test(symbol);
}

/**
 * Classify from ticker metadata + symbol. Does not infer vol, implied odds, or
 * a 0–1 contract price from a dollar last — only existing quote fields later.
 */
export function classifyKellyAsset(ticker: TickerRecord | null | undefined): KellyAssetClass {
  if (!ticker) return "unknown";
  const category = normalizeCategory(ticker.metadata.assetCategory);
  const symbol = ticker.metadata.ticker.trim().toUpperCase();
  const exchange = ticker.metadata.exchange?.trim().toUpperCase() ?? "";
  if (PREDICTION_CATEGORIES.has(category) || isPredictionSymbol(symbol)) return "prediction";

  const kind = resolveAssetDisplayKind({
    assetCategory: ticker.metadata.assetCategory,
    multiplier: ticker.metadata.positions.find((position) => position.multiplier)?.multiplier,
  });
  if (kind === "crypto") return "crypto";
  if (kind === "cash") return "fx";
  if (kind === "contract") {
    if (category === "OPT" || category === "OPTION" || category === "OPTIONS" || parseOptionSymbol(symbol)) {
      return "option";
    }
    return "futures";
  }
  if (kind === "equity") return "equity";
  if (exchange === "CCC" || /^[A-Z0-9]{2,10}[-/]USD$/.test(symbol)) return "crypto";
  if (exchange === "CCY" || /=X$/.test(symbol)) return "fx";
  if (/=F$/.test(symbol)) return "futures";
  return "unknown";
}

export function kellyAssetLabel(assetClass: KellyAssetClass): string | null {
  switch (assetClass) {
    case "equity":
      return "equity";
    case "crypto":
      return "crypto";
    case "fx":
      return "FX";
    case "futures":
      return "futures";
    case "option":
      return "option";
    case "prediction":
      return "contract";
    case "unknown":
      return null;
  }
}

/** Return-% modes need a tradable last; Odds needs a yes/no contract priced in (0, 1). */
export function isKellyModeAvailable(mode: KellySizingMode, assetClass: KellyAssetClass): boolean {
  const payoff = KELLY_MODES.find((entry) => entry.id === mode)?.payoff;
  if (payoff === "contract") return assetClass === "prediction";
  return assetClass !== "prediction";
}

export function defaultKellyMode(assetClass: KellyAssetClass): KellySizingMode {
  return assetClass === "prediction" ? "prediction-market" : "binary";
}

export function resolveKellyMode(mode: KellySizingMode, assetClass: KellyAssetClass): KellySizingMode {
  return isKellyModeAvailable(mode, assetClass) ? mode : defaultKellyMode(assetClass);
}

/** Use last as a yes-price only when it is already a probability. Never rescale cents. */
export function contractProbabilityFromQuote(price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price) || price <= 0 || price >= 1) return null;
  return price;
}

export function contractMultiplierFromTicker(ticker: TickerRecord | null | undefined): number {
  const multiplier = ticker?.metadata.positions.find((position) => (
    typeof position.multiplier === "number" && Number.isFinite(position.multiplier) && position.multiplier > 0
  ))?.multiplier;
  return multiplier ?? 1;
}
