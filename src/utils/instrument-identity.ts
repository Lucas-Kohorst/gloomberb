import type { BrokerContractRef } from "../types/instrument";

const normalized = (value: string | undefined): string => value?.trim().toUpperCase() ?? "";

/** Source-declared contract identity, independent of UI symbols and routing priority. */
export function brokerContractIdentityKey(contract: BrokerContractRef): string {
  if (contract.conId != null) return String(contract.conId);
  // A local symbol alone need not identify the supplied expiry, strike or deliverable.
  // Version this fallback so old symbol-only cache entries cannot supply its prices.
  return `definition-v1:${JSON.stringify([
    normalized(contract.localSymbol), normalized(contract.symbol), normalized(contract.secType),
    normalized(contract.exchange), normalized(contract.primaryExchange), normalized(contract.currency),
    normalized(contract.lastTradeDateOrContractMonth), normalized(contract.right),
    contract.strike == null ? null : Number.isFinite(contract.strike) ? contract.strike : String(contract.strike),
    normalized(contract.multiplier), normalized(contract.tradingClass),
  ])}`;
}

export function scopedBrokerContractIdentityKey(contract: BrokerContractRef): string {
  return JSON.stringify([contract.brokerId, contract.brokerInstanceId ?? "", brokerContractIdentityKey(contract)]);
}

export function instrumentIdentityKey(instrument: {
  symbol: string;
  exchange?: string;
  brokerId?: string;
  brokerInstanceId?: string;
  instrument?: BrokerContractRef | null;
}): string {
  return [
    normalized(instrument.symbol), normalized(instrument.exchange),
    instrument.brokerId ?? "", instrument.brokerInstanceId ?? "",
    instrument.instrument ? brokerContractIdentityKey(instrument.instrument) : "",
  ].join("|");
}
