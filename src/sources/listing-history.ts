import type { PricePoint, TickerFinancials } from "../types/financials";
import { canonicalExchange, parsePublicTickerKey } from "../utils/exchanges";
import { getPricePointTimestamp } from "../utils/price-history";
import { HistoryCoverageError } from "./history-coverage";

const CIRCLE_IPO_MONTH = Date.parse("2025-06-01");
const CIRCLE_FIRST_SESSION_END = Date.parse("2025-06-06");

export function hasCircleOfferingPriceHistory(
  points: readonly PricePoint[],
  target: { symbol: string; exchange?: string },
  sourceKey: string,
): boolean {
  if (sourceKey !== "provider:gloomberb-cloud") return false;
  const parsed = parsePublicTickerKey(target.symbol);
  const exchange = canonicalExchange(parsed.exchange || target.exchange);
  if (parsed.symbol !== "CRCL" || (exchange && exchange !== "NYSE")) return false;
  return points.some((point) => {
    const time = getPricePointTimestamp(point);
    return time >= CIRCLE_IPO_MONTH && time < CIRCLE_FIRST_SESSION_END
      && point.open === 31 && point.low === 31;
  });
}

export function assertTradingPriceHistory(
  points: PricePoint[],
  target: { symbol: string; exchange?: string },
  sourceKey: string,
): PricePoint[] {
  if (hasCircleOfferingPriceHistory(points, target, sourceKey)) {
    throw new HistoryCoverageError({
      message: "CRCL NYSE history includes the June 4, 2025 IPO offer price as market history. Trading began June 5; the affected source window is unavailable.",
    });
  }
  return points;
}

export function sanitizeListingFinancialHistory(
  value: TickerFinancials,
  target: { symbol: string; exchange?: string },
  sourceKey: string,
): TickerFinancials {
  return hasCircleOfferingPriceHistory(value.priceHistory, target, sourceKey)
    ? { ...value, priceHistory: [] }
    : value;
}
