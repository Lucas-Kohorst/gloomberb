import { expect, test } from "bun:test";
import { assertTradingPriceHistory, hasCircleOfferingPriceHistory } from "./listing-history";

const point = (date: string, open: number, low: number) => ({
  date: new Date(`${date}T00:00:00Z`),
  open,
  low,
  close: open,
});

test("recognizes and rejects the Cloud CRCL IPO offer price", () => {
  const history = [point("2025-06-04", 31, 31)];
  expect(hasCircleOfferingPriceHistory(history, { symbol: "CRCL", exchange: "NYSE" }, "provider:gloomberb-cloud")).toBe(true);
  expect(() => assertTradingPriceHistory(history, { symbol: "CRCL", exchange: "NYSE" }, "provider:gloomberb-cloud")).toThrow("IPO offer price");
});

test("does not reject other listings, providers, or valid CRCL sessions", () => {
  const valid = [point("2025-06-05", 69, 64)];
  expect(hasCircleOfferingPriceHistory(valid, { symbol: "CRCL", exchange: "NYSE" }, "provider:gloomberb-cloud")).toBe(false);
  expect(hasCircleOfferingPriceHistory([point("2025-06-04", 31, 31)], { symbol: "CRCL", exchange: "NASDAQ" }, "provider:gloomberb-cloud")).toBe(false);
  expect(hasCircleOfferingPriceHistory([point("2025-06-04", 31, 31)], { symbol: "CRCL", exchange: "NYSE" }, "provider:yahoo")).toBe(false);
});
