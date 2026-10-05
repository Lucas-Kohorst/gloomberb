import type { PaneBinding } from "../types/config";
import type { BrokerContractRef, InstrumentSearchResult, TickerListingRef } from "../types/instrument";
import { publicTickerKey } from "../utils/exchanges";

export function tickerSelectionFromSearchResult(result?: InstrumentSearchResult): {
  instrument?: BrokerContractRef | null; listing?: TickerListingRef;
} {
  if (!result) return {};
  return {
    instrument: result.brokerContract ?? null,
    listing: { name: result.name, exchange: result.exchange, currency: result.currency, type: result.type },
  };
}

/** Public shares carry a listing key; broker routes remain local layout context. */
export function publicTickerBindingSymbol(binding?: PaneBinding): string | null {
  if (binding?.kind !== "fixed" || binding.instrument || !binding.symbol.trim()) return null;
  return binding.listing?.exchange
    ? publicTickerKey(binding.symbol, binding.listing.exchange)
    : binding.symbol.trim().toUpperCase();
}
