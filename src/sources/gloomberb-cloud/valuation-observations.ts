import type { TickerFinancials } from "../../types/financials";
import { canonicalExchange, parsePublicTickerKey } from "../../utils/exchanges";

/** Retire the exact mapped SAP enterprise-value observation still served by older Cloud responses. */
export function retractKnownCloudValuation(
  financials: TickerFinancials,
  target?: { symbol: string; exchange?: string },
): TickerFinancials {
  const fundamentals = financials.fundamentals;
  if (!fundamentals || fundamentals.sharesOutstanding !== 1_154_204_232) return financials;
  const quote = financials.quote;
  const identity = parsePublicTickerKey(quote?.symbol ?? target?.symbol ?? "");
  const venue = canonicalExchange(quote?.listingExchangeName || quote?.exchangeName || identity.exchange || target?.exchange);
  if (identity.symbol !== "SAP" || (venue && venue !== "NYSE") || quote?.currency !== "USD") return financials;
  if (fundamentals.enterpriseValue !== 4_095_338_359_014) return financials;
  const { enterpriseValue: _enterpriseValue, ...remaining } = fundamentals;
  return { ...financials, fundamentals: remaining };
}
