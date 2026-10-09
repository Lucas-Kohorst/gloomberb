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

describe("quick-add listing resolution", () => {
  test("a bare symbol previews the saved listing, not another venue's quote", async () => {
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
    expect(validation.status).toBe("duplicate");
    if (validation.status !== "duplicate") return;
    expect(validation.ticker).toBe(saved);
    expect(validation.quote?.price).toBe(1.26);
    expect(tickerNameFromValidation(validation)).toBe("Netcall Plc");
    expect(exchangeLabelFromValidation(validation)).toBe("LSE");
  });

  test("a symbol whose default listing is unknown asks which one instead of failing", async () => {
    setSharedRegistryForTests({
      marketData: createTestDataProvider({
        search: async () => [lse, nyse],
        getQuote: async () => { throw new Error("quote unavailable"); },
      }),
    } as PluginRegistry);
    const validation = await resolveQuickAddValidation({
      query: "NET",
      collectionId: "watchlist",
      collectionKind: "watchlist",
      tickers: new Map(),
      financials: new Map(),
    });
    expect(validation).toEqual({ status: "choose", query: "NET" });
  });

  test("a qualified listing neither borrows nor duplicates another listing saved under its symbol", async () => {
    setSharedRegistryForTests({
      marketData: createTestDataProvider({
        search: async () => [lse, nyse],
        getQuote: async (_symbol, exchange) => createTestQuote({
          symbol: "NET", listingExchangeName: exchange, currency: exchange === "NYSE" ? "USD" : "GBP",
          price: exchange === "NYSE" ? 200 : 1.26,
        }),
      }),
    } as PluginRegistry);
    const saved = createTestTicker("NET", "Cloudflare", { exchange: "NYSE", currency: "USD", watchlists: ["watchlist"] });
    const validation = await resolveQuickAddValidation({
      query: "NET.LON",
      collectionId: "watchlist",
      collectionKind: "watchlist",
      tickers: new Map([[saved.metadata.ticker, saved]]),
      financials: new Map([["NET", { quote: createTestQuote({ symbol: "NET", price: 200, currency: "USD" }) }]]),
    });
    expect(validation.status).toBe("ready");
    if (validation.status !== "ready") return;
    expect(validation.ticker).toBeNull();
    expect(validation.quote?.price).toBe(1.26);
    expect(tickerNameFromValidation(validation)).toBe("Netcall Plc");
    expect(exchangeLabelFromValidation(validation)).toBe("LSE");
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
    if (listed.status !== "choose" || !("listings" in listed)) return;
    expect(listed.listings.map((listing) => listing.exchange)).toEqual(["LSE", "NYSE"]);
    expect(listed.listings.map((listing) => listing.id)).toEqual(["NET:XLON", "NET:XNYS"]);

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
    if (both.status !== "choose" || !("listings" in both)) return;
    expect(both.listings.map((listing) => listing.exchange)).toEqual(["LSE", "NYSE"]);
  });

  test("rejects a colon only when it is not a listing prompt", () => {
    expect(isPlausibleTickerQuery("NET:")).toBe(true);
    expect(isPlausibleTickerQuery("NET:XNYS")).toBe(true);
    expect(isPlausibleTickerQuery("NET:NYSE")).toBe(true);
    expect(isPlausibleTickerQuery(":NET")).toBe(false);
  });
});
