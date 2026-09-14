import { describe, expect, test } from "bun:test";
import {
  buildEulerpoolUrl,
  parseEulerpoolCashFlow,
  parseEulerpoolIncome,
  parseEulerpoolProfile,
  setEulerpoolApiKeyResolver,
  statementAmount,
} from "./client";

const INCOME_FIXTURE = [
  {
    costOfGoodsSold: 16,
    ebit: 11,
    grossIncome: 34,
    netIncome: 6,
    period: "1983-06-30T00:00:00.000Z",
    pretaxIncome: 11,
    researchDevelopment: 7,
    revenue: 50,
    sgaExpense: 17,
    ticker: "MSFT",
    diluted_eps: 0.12,
  },
  {
    ebit: 20,
    grossIncome: 40,
    netIncome: 10,
    period: "1984-06-30T00:00:00.000Z",
    revenue: 60,
    ticker: "MSFT",
  },
];

const CASH_FIXTURE = [
  {
    ticker: "MSFT",
    period: "1987-06-30T00:00:00.000Z",
    netOperatingCashFlow: 59,
    capex: -58,
    netInvestingCashFlow: -101,
    netCashFinancingActivities: 29,
    fcf: 1,
    year: 1987,
  },
];

describe("buildEulerpoolUrl", () => {
  test("encodes the identifier on the v1 equity path", () => {
    setEulerpoolApiKeyResolver(() => undefined);
    expect(buildEulerpoolUrl("equity/profile", "AAPL")).toBe(
      "https://api.eulerpool.com/api/1/equity/profile/AAPL",
    );
  });

  test("attaches token when a key is configured", () => {
    setEulerpoolApiKeyResolver(() => "ep_live_test");
    expect(new URL(buildEulerpoolUrl("equity/incomestatement", "AAPL")).searchParams.get("token")).toBe(
      "ep_live_test",
    );
    setEulerpoolApiKeyResolver(() => undefined);
  });
});

describe("parseEulerpoolIncome", () => {
  test("sorts newest first and keeps documented line items", () => {
    const periods = parseEulerpoolIncome(INCOME_FIXTURE);
    expect(periods.map((period) => period.year)).toEqual([1984, 1983]);
    expect(periods[1]).toMatchObject({
      ticker: "MSFT",
      revenue: 50,
      grossIncome: 34,
      ebit: 11,
      netIncome: 6,
      dilutedEps: 0.12,
    });
  });
});

describe("parseEulerpoolCashFlow", () => {
  test("reads operating, capex, and fcf", () => {
    const periods = parseEulerpoolCashFlow(CASH_FIXTURE);
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({
      year: 1987,
      operating: 59,
      capex: -58,
      fcf: 1,
    });
  });
});

describe("parseEulerpoolProfile", () => {
  test("accepts mixed key casing and falls back to the query ticker", () => {
    const profile = parseEulerpoolProfile({
      Name: "Apple Inc.",
      ticker: "AAPL",
      isin: "US0378331005",
      sector: "Technology",
      industry: "Consumer Electronics",
      country: "US",
    }, "MSFT");
    expect(profile).toMatchObject({
      ticker: "AAPL",
      name: "Apple Inc.",
      isin: "US0378331005",
      sector: "Technology",
    });
  });
});

describe("statementAmount", () => {
  test("scales documented million-unit figures", () => {
    expect(statementAmount(50)).toBe(50_000_000);
    expect(statementAmount(null)).toBeNull();
  });
});
