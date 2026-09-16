import { expect, test } from "bun:test";
import type { TickerFinancials } from "../../types/financials";
import { retractKnownCloudValuation } from "./valuation-observations";

const financials = (overrides: Partial<TickerFinancials> = {}): TickerFinancials => ({
  quote: { symbol: "SAP", listingExchangeName: "NYSE", currency: "USD", price: 200, change: 1, changePercent: 0.5 },
  fundamentals: { sharesOutstanding: 1_154_204_232, enterpriseValue: 4_095_338_359_014 },
  annualStatements: [],
  quarterlyStatements: [],
  priceHistory: [],
  ...overrides,
});

test("retracts the exact SAP enterprise value fingerprint", () => {
  expect(retractKnownCloudValuation(financials()).fundamentals?.enterpriseValue).toBeUndefined();
});

test("does not retract a different value or listing", () => {
  expect(retractKnownCloudValuation(financials({ fundamentals: { sharesOutstanding: 1_154_204_232, enterpriseValue: 200 } })).fundamentals?.enterpriseValue).toBe(200);
  expect(retractKnownCloudValuation(financials({ quote: { ...financials().quote!, listingExchangeName: "XETRA" } })).fundamentals?.enterpriseValue).toBe(4_095_338_359_014);
});
