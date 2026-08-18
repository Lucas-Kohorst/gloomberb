import { describe, expect, test } from "bun:test";
import type { OptionContract } from "../../../types/financials";
import {
  buildOvmeSeed,
  contractMarketPrice,
  daysToExpiry,
  ivToInputPercent,
  parseOvmeSeed,
  serializeOvmeSeed,
} from "./seed";

function contract(overrides: Partial<OptionContract> = {}): OptionContract {
  return {
    contractSymbol: "AAPL260821C00180000",
    strike: 180,
    currency: "USD",
    lastPrice: 4.2,
    change: 0,
    percentChange: 0,
    volume: 10,
    openInterest: 100,
    bid: 4.1,
    ask: 4.3,
    impliedVolatility: 0.32,
    inTheMoney: true,
    expiration: 1_787_299_200,
    lastTradeDate: 0,
    ...overrides,
  };
}

describe("OVME seed from a chain contract", () => {
  test("days-to-expiry is at least 1 and uses unix seconds", () => {
    const now = Date.UTC(2026, 7, 1);
    expect(daysToExpiry(Date.UTC(2026, 7, 31) / 1000, now)).toBe(30);
    expect(daysToExpiry(Date.UTC(2026, 6, 1) / 1000, now)).toBe(1);
  });

  test("market price prefers bid/ask mid over last", () => {
    expect(contractMarketPrice({ bid: 4.1, ask: 4.3, lastPrice: 9 })).toBeCloseTo(4.2);
    expect(contractMarketPrice({ bid: 0, ask: 0, lastPrice: 4.2 })).toBe(4.2);
    expect(contractMarketPrice({ bid: 0, ask: 0, lastPrice: 0 })).toBeNull();
  });

  test("Yahoo decimal IV becomes percent input", () => {
    expect(ivToInputPercent(0.32)).toBeCloseTo(32);
    expect(ivToInputPercent(0)).toBe(20);
  });

  test("fills spot, strike, expiry, IV, and type once", () => {
    const seed = buildOvmeSeed({
      contract: contract(),
      type: "call",
      spot: 195.5,
      dividendYield: 0.0034,
      now: Date.UTC(2026, 7, 1),
    });
    expect(seed.spot).toBe(195.5);
    expect(seed.strike).toBe(180);
    expect(seed.type).toBe("call");
    expect(seed.dividendYield).toBeCloseTo(0.34);
    expect(seed.volatility).toBeCloseTo(32);
    expect(seed.marketPrice).toBeCloseTo(4.2);
    expect(parseOvmeSeed(serializeOvmeSeed(seed))).toEqual(seed);
  });
});
