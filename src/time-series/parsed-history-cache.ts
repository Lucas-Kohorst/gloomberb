import type { PricePoint } from "../types/financials";

const parsedHistory = new Map<string, PricePoint[]>();

export function parsedPriceHistoryKey(
  symbol: string,
  exchange: string,
  range: string,
  resolution?: string,
): string {
  return [
    symbol.trim().toUpperCase(),
    exchange.trim().toUpperCase(),
    range,
    resolution ?? "",
  ].join("|");
}

export function rememberParsedPriceHistory(key: string, points: PricePoint[]): void {
  if (points.length === 0) return;
  parsedHistory.set(key, points);
}

export function readParsedPriceHistory(key: string): PricePoint[] | undefined {
  return parsedHistory.get(key);
}
