import type { PricePoint } from "../types/financials";
import type { TimeRange } from "./range";
import type { ManualChartResolution } from "./resolution";

const MAX_PARSED_HISTORY = 32;
const parsedHistory = new Map<string, PricePoint[]>();

export function parsedPriceHistoryKey(
  symbol: string,
  exchange: string,
  range: TimeRange,
  resolution?: ManualChartResolution,
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
  if (parsedHistory.has(key)) parsedHistory.delete(key);
  parsedHistory.set(key, points);
  while (parsedHistory.size > MAX_PARSED_HISTORY) {
    const oldest = parsedHistory.keys().next().value;
    if (oldest === undefined) break;
    parsedHistory.delete(oldest);
  }
}

export function readParsedPriceHistory(key: string): PricePoint[] | undefined {
  return parsedHistory.get(key);
}
