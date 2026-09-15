import { canonicalExchange, parsePublicTickerKey } from "../utils/exchanges";
import { createProviderMiss } from "./provider-errors";
import { yahooSuffixConflictsWithExchange, yahooSuffixExchange } from "./yahoo-finance/symbols";

/** Explicit public qualifications must agree; bare suffixes outrank remembered metadata. */
export function publicListingTarget(symbol: string, exchange?: string) {
  const parsed = parsePublicTickerKey(symbol);
  if (parsed.exchange && yahooSuffixConflictsWithExchange(parsed.symbol, parsed.exchange)) {
    throw createProviderMiss(`Listing suffix conflicts with exchange ${parsed.exchange}: ${symbol}`);
  }
  return {
    symbol: parsed.symbol,
    exchange: parsed.exchange ?? yahooSuffixExchange(parsed.symbol) ?? (exchange ? canonicalExchange(exchange) : exchange),
  };
}

/** Preserve a provider's venue spelling when the symbol itself has no listing hint. */
export function publicListingExchange(symbol: string, exchange?: string): string | undefined {
  const parsed = parsePublicTickerKey(symbol);
  return parsed.exchange || yahooSuffixExchange(parsed.symbol)
    ? publicListingTarget(symbol, exchange).exchange : exchange;
}

/** Keep each caller's target object when normalized requests are returned out of order. */
export function mapListingTargets<T extends { symbol: string; exchange?: string }>(
  targets: T[],
  resolveExchange: (target: T) => string | undefined = (target) => publicListingTarget(target.symbol, target.exchange).exchange,
) {
  const originals = new Map<T, T>();
  const valid: T[] = [];
  const invalid: Array<{ target: T; error: unknown }> = [];
  for (const target of targets) {
    try {
      const exchange = resolveExchange(target);
      const resolved = exchange === target.exchange ? target : { ...target, exchange };
      originals.set(resolved, target);
      valid.push(resolved);
    } catch (error) { invalid.push({ target, error }); }
  }
  return { valid, invalid, original: (target: T) => originals.get(target) ?? target };
}
