import type { OptionContract } from "../../../types/financials";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VOL_PERCENT = 20;

export type OvmeOptionType = "call" | "put";

export interface OvmeSeed {
  spot: number;
  strike: number;
  daysToExpiry: number;
  volatility: number;
  type: OvmeOptionType;
  marketPrice: number | null;
  dividendYield: number;
}

export function daysToExpiry(expirationUnixSec: number, now = Date.now()): number {
  return Math.max(1, Math.round((expirationUnixSec * 1000 - now) / DAY_MS));
}

export function contractMarketPrice(contract: Pick<OptionContract, "bid" | "ask" | "lastPrice">): number | null {
  if (contract.bid > 0 && contract.ask > 0) return (contract.bid + contract.ask) / 2;
  if (contract.lastPrice > 0) return contract.lastPrice;
  return null;
}

/** Yahoo IV/yield are decimals (0.40). Calc inputs store percent (40). */
export function ivToInputPercent(iv: number | null | undefined): number {
  if (iv == null || !Number.isFinite(iv) || iv <= 0) return DEFAULT_VOL_PERCENT;
  return iv * 100;
}

export function buildOvmeSeed(options: {
  contract: OptionContract;
  type: OvmeOptionType;
  spot: number | null;
  dividendYield?: number | null;
  now?: number;
}): OvmeSeed {
  const spot = options.spot != null && Number.isFinite(options.spot) && options.spot > 0
    ? options.spot
    : options.contract.strike;
  const dividendYield = options.dividendYield != null && Number.isFinite(options.dividendYield)
    ? options.dividendYield * 100
    : 0;
  return {
    spot,
    strike: options.contract.strike,
    daysToExpiry: daysToExpiry(options.contract.expiration, options.now),
    volatility: ivToInputPercent(options.contract.impliedVolatility),
    type: options.type,
    marketPrice: contractMarketPrice(options.contract),
    dividendYield,
  };
}

export function serializeOvmeSeed(seed: OvmeSeed): Record<string, string> {
  return {
    spot: String(seed.spot),
    strike: String(seed.strike),
    daysToExpiry: String(seed.daysToExpiry),
    volatility: String(seed.volatility),
    type: seed.type,
    marketPrice: seed.marketPrice == null ? "" : String(seed.marketPrice),
    dividendYield: String(seed.dividendYield),
  };
}

function finiteNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOvmeSeed(values: Record<string, string> | undefined): OvmeSeed | null {
  if (!values) return null;
  const spot = finiteNumber(values.spot);
  const strike = finiteNumber(values.strike);
  const daysToExpiryValue = finiteNumber(values.daysToExpiry);
  const volatility = finiteNumber(values.volatility);
  const type = values.type === "put" ? "put" : values.type === "call" ? "call" : null;
  if (spot == null || strike == null || daysToExpiryValue == null || volatility == null || !type) {
    return null;
  }
  return {
    spot,
    strike,
    daysToExpiry: daysToExpiryValue,
    volatility,
    type,
    marketPrice: finiteNumber(values.marketPrice),
    dividendYield: finiteNumber(values.dividendYield) ?? 0,
  };
}
