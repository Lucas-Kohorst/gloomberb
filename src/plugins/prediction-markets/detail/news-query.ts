import type { NewsQuery } from "../../../news/types";
import type { PredictionMarketSummary } from "../types";
import { matchSettlementSeries } from "./settlement-match";

const IGNORED_EXPRESSION_PREFIXES = new Set([
  "FRED",
  "UST",
  "WX",
  "NWS",
  "POLL",
  "ADJ",
]);

type NewsSummaryFields = Pick<
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

interface SettlementNewsTicker {
  symbol: string;
  crypto: boolean;
}

function tickerFromSettlementExpression(expression: string): SettlementNewsTicker | null {
  const colon = expression.indexOf(":");
  if (colon <= 0) return null;
  const prefix = expression.slice(0, colon).toUpperCase();
  if (IGNORED_EXPRESSION_PREFIXES.has(prefix)) return null;
  if (!expression.toLowerCase().endsWith(":price")) return null;
  const raw = expression.slice(0, -":price".length).toUpperCase();
  if (!raw) return null;
  if (raw.endsWith("-USD")) {
    const symbol = raw.slice(0, -"-USD".length);
    if (!symbol) return null;
    return { symbol, crypto: true };
  }
  return { symbol: raw, crypto: false };
}

export function buildPredictionNewsQuery(
  summary: NewsSummaryFields,
): NewsQuery | null {
  const { series } = matchSettlementSeries(summary);
  const seen = new Set<string>();
  const equities: string[] = [];
  const cryptos: string[] = [];

  for (const row of series) {
    const parsed = tickerFromSettlementExpression(row.expression);
    if (!parsed || seen.has(parsed.symbol)) continue;
    seen.add(parsed.symbol);
    if (parsed.crypto) cryptos.push(parsed.symbol);
    else equities.push(parsed.symbol);
  }

  const primary = equities[0] ?? cryptos[0];
  if (!primary) return null;

  const tickerRelations = [...equities, ...cryptos].filter((symbol) => symbol !== primary);
  return {
    feed: "ticker",
    ticker: primary,
    tickerTier: "primary",
    ...(tickerRelations.length > 0 ? { tickerRelations } : {}),
    limit: 50,
  };
}
