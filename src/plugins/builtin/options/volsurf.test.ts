import { expect, test } from "bun:test";
import {
  blackScholesCall,
  blackScholesPut,
} from "../options-calc/blackscholes";
import type { OptionContract, OptionsChain } from "../../../types/financials";
import {
  computeVolSurface,
  contractMarketPrice,
  formatIvCell,
  normalizeIv,
  quantizeVolSurfaceSpot,
  volSurfaceCellBackground,
  volSurfaceCellText,
  yearsToExpiry,
} from "./volsurf";

const NOW_MS = Date.UTC(2026, 0, 15); // fixed "now" for deterministic expiry
const SPOT = 100;
const RISK_FREE_RATE = 0.05;
const SIGMA = 0.25;

function makeContract(
  strike: number,
  side: "C" | "P",
  expirationSec: number,
  price: number,
): OptionContract {
  return {
    contractSymbol: `TEST${side}${strike}${expirationSec}`,
    strike,
    currency: "USD",
    lastPrice: price,
    change: 0,
    percentChange: 0,
    volume: 1000,
    openInterest: 5000,
    bid: price - 0.05,
    ask: price + 0.05,
    impliedVolatility: SIGMA,
    inTheMoney: side === "C" ? strike < SPOT : strike > SPOT,
    expiration: expirationSec,
    lastTradeDate: expirationSec - 86400,
  };
}

function bsPrice(strike: number, expirationSec: number, side: "C" | "P"): number {
  const t = yearsToExpiry(expirationSec, NOW_MS);
  const inputs = {
    spot: SPOT,
    strike,
    timeToExpiry: t,
    riskFreeRate: RISK_FREE_RATE,
    volatility: SIGMA,
    dividendYield: 0,
  };
  return side === "C" ? blackScholesCall(inputs).price : blackScholesPut(inputs).price;
}

function makeChain(strikes: number[], expirationSec: number): OptionsChain {
  return {
    underlyingSymbol: "TEST",
    expirationDates: [expirationSec],
    calls: strikes.map((k) => makeContract(k, "C", expirationSec, bsPrice(k, expirationSec, "C"))),
    puts: strikes.map((k) => makeContract(k, "P", expirationSec, bsPrice(k, expirationSec, "P"))),
  };
}

test("contractMarketPrice prefers mid bid/ask, falls back to last", () => {
  expect(contractMarketPrice({ bid: 1.0, ask: 1.2, lastPrice: 5 })).toBe(1.1);
  expect(contractMarketPrice({ bid: 0, ask: 0, lastPrice: 3 })).toBe(3);
  expect(contractMarketPrice({ bid: 0, ask: 0, lastPrice: 0 })).toBeNull();
});

test("yearsToExpiry is floored to one day", () => {
  const oneDay = 1 / 365;
  const twoDaysSec = Math.floor(NOW_MS / 1000) + 2 * 24 * 3600;
  expect(yearsToExpiry(twoDaysSec, NOW_MS)).toBeGreaterThan(oneDay);
  expect(yearsToExpiry(Math.floor(NOW_MS / 1000), NOW_MS)).toBeCloseTo(oneDay, 6);
});

test("computeVolSurface recovers the input volatility across strikes", () => {
  const strikes = [80, 90, 100, 110, 120];
  const expirationSec = Math.floor((NOW_MS + 365 * 24 * 3600 * 1000) / 1000);
  const chains = new Map<number, OptionsChain>([[expirationSec, makeChain(strikes, expirationSec)]]);

  const surface = computeVolSurface(chains, {
    spot: SPOT,
    riskFreeRate: RISK_FREE_RATE,
    now: NOW_MS,
  });

  expect(surface.strikes).toEqual(strikes);
  expect(surface.expirations).toEqual([expirationSec]);
  expect(surface.minIv).not.toBeNull();
  expect(surface.maxIv).not.toBeNull();

  // Every marketable cell should back-solve to within 1% of the input sigma.
  for (const row of surface.cells) {
    for (const cell of row) {
      if (!cell) continue;
      expect(Math.abs(cell.impliedVolatility - SIGMA)).toBeLessThan(0.01);
    }
  }
});

test("computeVolSurface unions strikes and sorts expirations ascending", () => {
  const expA = Math.floor((NOW_MS + 30 * 24 * 3600 * 1000) / 1000);
  const expB = Math.floor((NOW_MS + 90 * 24 * 3600 * 1000) / 1000);
  const chainA = makeChain([95, 105], expA);
  const chainB = makeChain([100, 110], expB);
  const chains = new Map<number, OptionsChain>([
    [expB, chainB],
    [expA, chainA],
  ]);

  const surface = computeVolSurface(chains, { spot: SPOT, now: NOW_MS });

  expect(surface.expirations).toEqual([expA, expB]);
  expect(surface.strikes).toEqual([95, 100, 105, 110]);
  // cells grid is [strikeIndex][expirationIndex]
  expect(surface.cells.length).toBe(4);
  expect(surface.cells[0]!.length).toBe(2);
  // Strike 100 only exists in the later expiration; the earlier cell is null.
  const strike100Index = surface.strikes.indexOf(100);
  expect(surface.cells[strike100Index]![0]).toBeNull();
  expect(surface.cells[strike100Index]![1]).not.toBeNull();
});

test("computeVolSurface returns null cells when spot is missing", () => {
  const expirationSec = Math.floor((NOW_MS + 365 * 24 * 3600 * 1000) / 1000);
  const chains = new Map<number, OptionsChain>([[expirationSec, makeChain([100], expirationSec)]]);

  const surface = computeVolSurface(chains, { spot: null, now: NOW_MS });
  expect(surface.cells[0]![0]).toBeNull();
  expect(surface.minIv).toBeNull();
  expect(surface.maxIv).toBeNull();
});

test("computeVolSurface skips contracts with no market price", () => {
  const expirationSec = Math.floor((NOW_MS + 365 * 24 * 3600 * 1000) / 1000);
  const chain = makeChain([100], expirationSec);
  // Wipe every price field.
  chain.calls[0]!.bid = 0;
  chain.calls[0]!.ask = 0;
  chain.calls[0]!.lastPrice = 0;
  chain.puts[0]!.bid = 0;
  chain.puts[0]!.ask = 0;
  chain.puts[0]!.lastPrice = 0;
  const chains = new Map<number, OptionsChain>([[expirationSec, chain]]);

  const surface = computeVolSurface(chains, { spot: SPOT, now: NOW_MS });
  expect(surface.cells[0]![0]).toBeNull();
});

test("normalizeIv clamps to [0,1] and handles degenerate ranges", () => {
  expect(normalizeIv(0.2, 0.1, 0.3)).toBeCloseTo(0.5, 6);
  expect(normalizeIv(0.05, 0.1, 0.3)).toBe(0);
  expect(normalizeIv(0.4, 0.1, 0.3)).toBe(1);
  expect(normalizeIv(0.2, 0.1, 0.1)).toBe(0);
  expect(normalizeIv(0.2, null, null)).toBe(0);
});

test("volSurfaceCellBackground and text produce valid hex colors", () => {
  const bg = volSurfaceCellBackground(0.3, 0.1, 0.3);
  const text = volSurfaceCellText(0.3, 0.1, 0.3);
  expect(bg).toMatch(/^#[0-9a-f]{6}$/i);
  expect(text).toMatch(/^#[0-9a-f]{6}$/i);
  // Low vs high IV should differ.
  const lowBg = volSurfaceCellBackground(0.1, 0.1, 0.3);
  const highBg = volSurfaceCellBackground(0.3, 0.1, 0.3);
  expect(lowBg).not.toBe(highBg);
});

test("formatIvCell formats decimals as percentages", () => {
  expect(formatIvCell(0.235)).toBe("23.5");
  expect(formatIvCell(0.2)).toBe("20.0");
  expect(formatIvCell(null)).toBe("—");
  expect(formatIvCell(Number.NaN)).toBe("—");
});

test("VolSurface cells expose strike, expiration, and solved type", () => {
  const expirationSec = Math.floor((NOW_MS + 365 * 24 * 3600 * 1000) / 1000);
  const chains = new Map<number, OptionsChain>([[expirationSec, makeChain([100], expirationSec)]]);
  const surface = computeVolSurface(chains, { spot: SPOT, now: NOW_MS });
  const cell = surface.cells[0]![0]!;
  expect(cell.strike).toBe(100);
  expect(cell.expiration).toBe(expirationSec);
  expect(cell.type === "call" || cell.type === "put").toBe(true);
});

test("quantizeVolSurfaceSpot buckets penny ticks together", () => {
  expect(quantizeVolSurfaceSpot(null)).toBeNull();
  expect(quantizeVolSurfaceSpot(0)).toBeNull();
  expect(quantizeVolSurfaceSpot(100.02)).toBe(100);
  expect(quantizeVolSurfaceSpot(100.04)).toBe(100);
  expect(quantizeVolSurfaceSpot(100.2)).toBe(100.2);
});
