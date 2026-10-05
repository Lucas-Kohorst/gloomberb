import type { InstrumentSearchResult } from "../../types/instrument";
import { scopedBrokerContractIdentityKey } from "../../utils/instrument-identity";

const CONTRACT_TYPES = new Set(["OPT", "OPTION", "OPTIONS", "FOP", "FUT", "FUTURE", "FUTURES", "BOND", "WAR", "WARRANT", "BAG"]);
const normalized = (value?: string) => value?.trim().toUpperCase() ?? "";

/** Broker enrichment of an equity listing still merges with its public result. */
export function searchContractKey(result: Pick<InstrumentSearchResult, "brokerContract" | "type">): string | undefined {
  const contract = result.brokerContract;
  if (!contract) return undefined;
  return CONTRACT_TYPES.has(normalized(contract.secType || result.type))
    || contract.strike != null || !!contract.lastTradeDateOrContractMonth || !!contract.right
    ? scopedBrokerContractIdentityKey(contract) : undefined;
}

export function searchInstrumentKey(result: InstrumentSearchResult): string {
  return [result.symbol, result.exchange, result.type, result.primaryExchange, result.currency]
    .map(normalized).concat(searchContractKey(result) ?? "").join("|");
}
