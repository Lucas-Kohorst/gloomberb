import { afterEach, describe, expect, test } from "bun:test";
import type { InstrumentSearchResult } from "../../../../types/instrument";
import type { PluginRegistry } from "../../../registry";
import { setSharedRegistryForTests } from "../../../registry";
import { createTestDataProvider, createTestQuote } from "../../../../test-support/data-provider";
import { createTestTicker } from "../../../../test-support/ticker";
import {
  exchangeLabelFromValidation,
  isPlausibleTickerQuery,
  resolveQuickAddValidation,
  tickerNameFromValidation,
} from "./resolution";

const nyse: InstrumentSearchResult = {
  providerId: "test", symbol: "NET", name: "Cloudflare", exchange: "NYSE", currency: "USD", type: "STK",
};
const lse: InstrumentSearchResult = {
  providerId: "test", symbol: "NET", name: "Netcall Plc", exchange: "LSE", currency: "GBP", type: "STK",
};

function quoteFor(exchange = "") {
  if (exchange === "NYSE") {
    return createTestQuote({
      symbol: "NET", listingExchangeName: "NYSE", currency: "USD",
      price: 200, changePercent: 1.5, volume: 8_000_000, name: "Cloudflare",
    });
  }
  return createTestQuote({
    symbol: "NET", listingExchangeName: "LSE", currency: "GBP",
    price: 1.26, changePercent: 0.4, volume: 15_000, name: "Netcall Plc",
  });
}

function install(search: InstrumentSearchResult[]) {
  setSharedRegistryForTests({
    marketData: createTestDataProvider({
      search: async () => search,
      getQuote: async (_symbol, exchange) => quoteFor(exchange),
    }),
  } as PluginRegistry);
}

afterEach(() => {
  setSharedRegistryForTests(undefined);
});

describe("quick-add venue resolution", () => {
  test("a bare symbol previews the busiest venue, not the saved company's quote", async () => {
    install([lse, nyse]);
    const saved = createTestTicker("NET", "Netcall Plc", {
      exchange: "LSE", currency: "GBP", watchlists: ["watchlist"],
    });
    const validation = await resolveQuickAddValidation({
      query: "NET",
      collectionId: "watchlist",
      collectionKind: "watchlist",
      tickers: new Map([[saved.metadata.ticker, saved]]),
      financials: new Map([["NET", { quote: quoteFor("LSE") }]]),
    });
    expect(validation.status).toBe("ready");
    if (validation.status !== "ready") return;
    expect(validation.ticker).toBeNull();
    expect(validation.quote?.price).toBe(200);
    expect(tickerNameFromValidation(validation)).toBe("Cloudflare");
    expect(exchangeLabelFromValidation(validation)).toBe("NYSE");
  });

  test("a trailing colon lists the venues and an exchange prefix narrows to one", async () => {
    install([lse, nyse]);
    const saved = createTestTicker("NET", "Netcall Plc", { exchange: "LSE", currency: "GBP" });
    const tickers = new Map([[saved.metadata.ticker, saved]]);
    const listed = await resolveQuickAddValidation({
      query: "NET:",
      collectionId: "watchlist",
      collectionKind: "watchlist",
      tickers,
      financials: new Map(),
    });
    expect(listed.status).toBe("choose");
    if (listed.status !== "choose") return;
    expect(listed.listings.map((listing) => listing.exchange)).toEqual(["NYSE", "LSE"]);
    expect(listed.listings.map((listing) => listing.id)).toEqual(["NET:XNYS", "NET:XLON"]);

    const narrowed = await resolveQuickAddValidation({
      query: "NET:N",
      collectionId: "watchlist",
      collectionKind: "watchlist",
      tickers,
      financials: new Map([["NET", { quote: quoteFor("LSE") }]]),
    });
    expect(narrowed.status).toBe("ready");
    if (narrowed.status !== "ready") return;
    expect(tickerNameFromValidation(narrowed)).toBe("Cloudflare");
    expect(narrowed.quote?.price).toBe(200);

    const both = await resolveQuickAddValidation({
      query: "NET:X",
      collectionId: "watchlist",
      collectionKind: "watchlist",
      tickers,
      financials: new Map(),
    });
    expect(both.status).toBe("choose");
    if (both.status !== "choose") return;
    expect(both.listings.map((listing) => listing.exchange)).toEqual(["NYSE", "LSE"]);
  });

  test("rejects a colon only when it is not a listing prompt", () => {
    expect(isPlausibleTickerQuery("NET:")).toBe(true);
    expect(isPlausibleTickerQuery("NET:XNYS")).toBe(true);
    expect(isPlausibleTickerQuery("NET:NYSE")).toBe(true);
    expect(isPlausibleTickerQuery(":NET")).toBe(false);
  });
});
