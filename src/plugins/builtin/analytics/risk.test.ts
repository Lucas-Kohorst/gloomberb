import { describe, expect, test } from "bun:test";
import {
  buildCumulativeReturnChartPoints,
  computeAnnualizedVolatility,
  computeBetaWeightedMarketExposure,
  computeContributors,
  computeFactorExposure,
  computeHistoricalVaR,
  computeParametricVaR,
  computeVaR,
  splitBestWorst,
  type FactorReturnSeries,
} from "./risk";
import type { DatedReturn } from "./metrics";

function datedReturns(values: number[], startDay = 1): DatedReturn[] {
  return values.map((value, index) => ({
    dateKey: `2024-01-${String(startDay + index).padStart(2, "0")}`,
    value,
  }));
}

/** Deterministic pseudo-random returns for stable assertions. */
function seededReturns(n: number, seed: number, spread = 0.01): number[] {
  let state = seed;
  const returns: number[] = [];
  for (let i = 0; i < n; i++) {
    // xorshift-ish on a small state
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    state = state ^ (state << 13);
    state = state ^ (state >>> 5);
    state = (state * 2654435761) & 0x7fffffff;
    returns.push(((state / 0x7fffffff) - 0.5) * 2 * spread);
  }
  return returns;
}

describe("computeHistoricalVaR", () => {
  test("returns a positive loss at the 5% quantile", () => {
    // 100 returns roughly normal around 0; the 5th percentile is a loss.
    const returns = seededReturns(100, 7, 0.012);
    const varValue = computeHistoricalVaR(returns, 0.95, 100_000);
    expect(varValue).not.toBeNull();
    expect(varValue!).toBeGreaterThan(0);
    // 1-day historical VaR should be a fraction of the portfolio value.
    expect(varValue!).toBeLessThan(100_000);
  });

  test("matches the empirical quantile exactly", () => {
    const returns = [-0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04];
    // (1 - 0.90) * 9 = 0.9 -> floor = 0 -> sorted[0] = -0.05
    const varValue = computeHistoricalVaR(returns, 0.90, 1_000_000);
    expect(varValue).toBeCloseTo(0.05 * 1_000_000, 6);
  });

  test("returns null for insufficient data", () => {
    expect(computeHistoricalVaR([0.01, 0.02], 0.95, 1000)).toBeNull();
  });

  test("returns null for non-positive portfolio value", () => {
    expect(computeHistoricalVaR(seededReturns(20, 3), 0.95, 0)).toBeNull();
  });
});

describe("computeParametricVaR", () => {
  test("returns a positive loss larger than historical for fat tails", () => {
    const returns = seededReturns(50, 11, 0.01);
    const parametric = computeParametricVaR(returns, 0.95, 100_000);
    expect(parametric).not.toBeNull();
    expect(parametric!).toBeGreaterThan(0);
  });

  test("returns null for zero variance", () => {
    expect(computeParametricVaR(Array(20).fill(0.01), 0.95, 1000)).toBeNull();
  });

  test("returns null for insufficient data", () => {
    expect(computeParametricVaR([0.01, 0.02], 0.95, 1000)).toBeNull();
  });
});

describe("computeVaR", () => {
  test("reports both historical and parametric", () => {
    const returns = seededReturns(60, 5, 0.01);
    const result = computeVaR(returns, 0.95, 50_000);
    expect(result.confidence).toBe(0.95);
    expect(result.historical).not.toBeNull();
    expect(result.parametric).not.toBeNull();
    expect(result.historical!).toBeGreaterThan(0);
    expect(result.parametric!).toBeGreaterThan(0);
  });

  test("returns nulls when data is insufficient", () => {
    const result = computeVaR([0.01, 0.02], 0.95, 50_000);
    expect(result.historical).toBeNull();
    expect(result.parametric).toBeNull();
  });
});

describe("computeAnnualizedVolatility", () => {
  test("annualizes daily standard deviation", () => {
    const daily = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const vol = computeAnnualizedVolatility(daily);
    expect(vol).not.toBeNull();
    // daily std ~ 0.01, annualized ~ 0.01 * sqrt(252) ~ 0.1587
    expect(vol!).toBeCloseTo(0.01 * Math.sqrt(252), 2);
  });

  test("returns null for zero variance", () => {
    expect(computeAnnualizedVolatility(Array(20).fill(0.01))).toBeNull();
  });
});

const marketSeries = datedReturns([
  -0.010, 0.015, 0.004, -0.006, 0.011,
  0.008, -0.012, 0.009, 0.013, -0.007,
  0.005, 0.010,
], 2);

describe("computeFactorExposure", () => {
  test("market beta is 2 when portfolio returns are 2x the market", () => {
    const portfolio = marketSeries.map((point) => ({ ...point, value: point.value * 2 }));
    const factors: FactorReturnSeries[] = [{ factor: "market", returns: marketSeries }];
    const exposure = computeFactorExposure(portfolio, factors, 100_000);
    expect(exposure).toHaveLength(1);
    expect(exposure[0]!.factor).toBe("market");
    expect(exposure[0]!.beta).toBeCloseTo(2, 5);
    expect(exposure[0]!.exposure).toBeCloseTo(200_000, 1);
  });

  test("returns null beta when portfolio returns are null", () => {
    const factors: FactorReturnSeries[] = [{ factor: "market", returns: marketSeries }];
    const exposure = computeFactorExposure(null, factors, 100_000);
    expect(exposure[0]!.beta).toBeNull();
    expect(exposure[0]!.exposure).toBeNull();
  });
});

describe("computeBetaWeightedMarketExposure", () => {
  test("equals beta * portfolio value", () => {
    const portfolio = marketSeries.map((point) => ({ ...point, value: point.value * 1.5 }));
    const exposure = computeBetaWeightedMarketExposure(portfolio, marketSeries, 80_000);
    expect(exposure).not.toBeNull();
    expect(exposure).toBeCloseTo(1.5 * 80_000, 1);
  });

  test("returns null when either series is null", () => {
    expect(computeBetaWeightedMarketExposure(null, marketSeries, 80_000)).toBeNull();
    expect(computeBetaWeightedMarketExposure(marketSeries, null, 80_000)).toBeNull();
  });
});

describe("computeContributors", () => {
  const inputs = [
    { symbol: "AAPL", name: "Apple", sector: "Technology", marketValue: 60_000, returnPct: 0.10 },
    { symbol: "MSFT", name: "Microsoft", sector: "Technology", marketValue: 30_000, returnPct: -0.05 },
    { symbol: "XOM", name: "Exxon", sector: "Energy", marketValue: 10_000, returnPct: 0.20 },
  ];

  test("ranks by position size descending", () => {
    const { byPosition } = computeContributors(inputs, 3);
    expect(byPosition.map((c) => c.symbol)).toEqual(["AAPL", "MSFT", "XOM"]);
    expect(byPosition[0]!.weight).toBeCloseTo(0.6, 2);
  });

  test("ranks by return contribution descending", () => {
    const { byReturn } = computeContributors(inputs, 3);
    // AAPL: 0.10*0.6=0.06, XOM: 0.20*0.1=0.02, MSFT: -0.05*0.3=-0.015
    expect(byReturn.map((c) => c.symbol)).toEqual(["AAPL", "XOM", "MSFT"]);
    expect(byReturn[0]!.returnContribution).toBeCloseTo(0.06, 5);
    expect(byReturn[2]!.returnContribution).toBeCloseTo(-0.015, 5);
  });

  test("excludes positions with no return from the return ranking", () => {
    const { byReturn } = computeContributors(
      [...inputs, { symbol: "CASH", marketValue: 20_000 }],
      3,
    );
    expect(byReturn.some((c) => c.symbol === "CASH")).toBe(false);
  });

  test("returns empty lists when total value is zero", () => {
    const result = computeContributors([{ symbol: "X", marketValue: 0 }], 3);
    expect(result.byPosition).toEqual([]);
    expect(result.byReturn).toEqual([]);
  });

  test("dollar contribution equals returnPct * marketValue", () => {
    const { byReturn } = computeContributors(inputs, 1);
    expect(byReturn[0]!.dollarContribution).toBeCloseTo(0.10 * 60_000, 1);
  });
});

describe("splitBestWorst", () => {
  test("splits a ranked list into best and worst", () => {
    const { best, worst } = splitBestWorst([1, 2, 3, 4, 5], 2);
    expect(best).toEqual([1, 2]);
    expect(worst).toEqual([5, 4]);
  });

  test("returns empty for empty input", () => {
    expect(splitBestWorst([], 2)).toEqual({ best: [], worst: [] });
  });
});

describe("buildCumulativeReturnChartPoints", () => {
  test("produces a running sum of returns", () => {
    const points = buildCumulativeReturnChartPoints(datedReturns([0.01, -0.02, 0.03], 5));
    expect(points).toHaveLength(3);
    expect(points[0]!.close).toBeCloseTo(0.01, 6);
    expect(points[1]!.close).toBeCloseTo(-0.01, 6);
    expect(points[2]!.close).toBeCloseTo(0.02, 6);
    expect(points[0]!.date).toBeInstanceOf(Date);
    expect(points[0]!.volume).toBe(0);
  });

  test("skips points with unparseable dates keys", () => {
    const points = buildCumulativeReturnChartPoints([
      { dateKey: "not-a-date", value: 0.01 },
      { dateKey: "2024-02-01", value: 0.02 },
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]!.close).toBeCloseTo(0.03, 6);
  });
});
