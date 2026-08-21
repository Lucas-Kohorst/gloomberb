import type { InstrumentSearchResult } from "../../types/instrument";
import { canonicalCryptoInstrument, COINGECKO_EXCHANGE, isCryptoSearchType } from "../../sources/coingecko/ids";
import {
  buildSymbolAliases,
  compactSearchText,
  normalizeSearchText,
  normalizeTickerSymbol,
} from "./ranking";

export function getSearchResultSymbol(result: InstrumentSearchResult): string {
  const raw = normalizeTickerSymbol(result.brokerContract?.localSymbol || result.symbol);
  const exchange = isCryptoSearchType(result.type) || isCryptoSearchType(result.brokerContract?.secType)
    ? COINGECKO_EXCHANGE
    : result.exchange;
  return canonicalCryptoInstrument(raw, exchange)?.symbol ?? raw;
}

export function shouldReplaceTickerName(currentName: string, symbol: string, nextName: string): boolean {
  if (!currentName.trim()) return true;
  if (currentName.trim() === nextName.trim()) return false;
  return isLowQualityTickerName(currentName, symbol) && !isLowQualityTickerName(nextName, symbol);
}

export function isLowQualityTickerName(name: string, symbol: string): boolean {
  const trimmedName = name.trim();
  if (!trimmedName) return true;
  const normalizedName = normalizeSearchText(trimmedName);
  return buildSymbolAliases(symbol).some((alias) =>
    normalizedName === normalizeSearchText(alias)
    || compactSearchText(trimmedName) === compactSearchText(alias)
  );
}
