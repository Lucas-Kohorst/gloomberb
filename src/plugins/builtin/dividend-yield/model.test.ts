import { describe, expect, test } from "bun:test";
import {
  buildDividendMetrics,
  buildYieldChartPoints,
  dividendGrowth,
  indicatedAnnualFromPayments,
  inferFrequency,
  trailingAnnualFromPayments,
} from "./model";
import type { DividendPayment } from "./types";

function payment(exDate: string, amount: number): DividendPayment {
  return {
    exDate: new Date(`${exDate}T00:00:00.000Z`),
    recordDate: null,
    paymentDate: null,
    declarationDate: null,
    amount,
    currency: "USD",
    type: "cash",
  };
}

const QUARTERLY: DividendPayment[] = [
  payment("2026-06-24", 0.405),
  payment("2026-03-25", 0.402),
  payment("2025-12-24", 0.406),
  payment("2025-09-24", 0.403),
  payment("2025-06-25", 0.402),
];

// nextPayDate depends on the wall clock (an estimated date only counts while it
// is still in the future), so freeze "now" just after the newest known ex-date.
// The estimate always lands on 2026-09-23 without drifting with the test run.
const NOW = Date.parse("2026-06-25T00:00:00.000Z");

describe("dividend metrics from payments", () => {
  test("treats Yahoo zeros as missing and fills trailing/forward from the schedule", () => {
    const metrics = buildDividendMetrics(QUARTERLY, {
      trailingAnnualDividendRate: 0,
      trailingAnnualDividendYield: 0,
      forwardAnnualDividendRate: 0,
      payoutRatio: 0,
      exDividendDate: 0,
      dividendDate: 0,
    }, 16.22, NOW);

    expect(inferFrequency(QUARTERLY)).toBe("quarterly");
    expect(trailingAnnualFromPayments(QUARTERLY)).toBeCloseTo(1.616);
    expect(indicatedAnnualFromPayments(QUARTERLY)).toBeCloseTo(1.62);
    expect(metrics.trailingRate).toBeCloseTo(1.616);
    expect(metrics.forwardRate).toBeCloseTo(1.62);
    expect(metrics.trailingYield).toBeCloseTo(1.616 / 16.22);
    expect(metrics.forwardYield).toBeCloseTo(1.62 / 16.22);
    expect(metrics.growth1Y).toBeNull();
    expect(metrics.growth3Y).toBeNull();
    expect(metrics.payoutRatio).toBeNull();
    expect(metrics.nextPayDate?.toISOString().slice(0, 10)).toBe("2026-09-23");
  });

  test("stops proposing a next payment once its estimated date is in the past", () => {
    const lateNow = Date.parse("2027-01-01T00:00:00.000Z");
    const metrics = buildDividendMetrics(QUARTERLY, {
      trailingAnnualDividendRate: 0,
      trailingAnnualDividendYield: 0,
      forwardAnnualDividendRate: 0,
      payoutRatio: 0,
      exDividendDate: 0,
      dividendDate: 0,
    }, 16.22, lateNow);
    expect(metrics.nextPayDate).toBeNull();
  });

  test("needs a full prior year of payments before showing 1Y growth", () => {
    expect(dividendGrowth(QUARTERLY, 1)).toBeNull();
    const eightQuarters = [
      ...QUARTERLY,
      payment("2025-03-25", 0.4),
      payment("2024-12-24", 0.4),
      payment("2024-09-24", 0.4),
    ];
    expect(dividendGrowth(eightQuarters, 1)).not.toBeNull();
  });

  test("builds a trailing-yield series from price history instead of a 6-point stub", () => {
    const points = buildYieldChartPoints(QUARTERLY, 16.22, [
      { date: new Date("2025-09-30T00:00:00.000Z"), close: 16 },
      { date: new Date("2025-12-31T00:00:00.000Z"), close: 16 },
      { date: new Date("2026-03-31T00:00:00.000Z"), close: 16 },
      { date: new Date("2026-06-30T00:00:00.000Z"), close: 16.22 },
    ]);
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points[points.length - 1]!.close).toBeGreaterThan(5);
  });
});
