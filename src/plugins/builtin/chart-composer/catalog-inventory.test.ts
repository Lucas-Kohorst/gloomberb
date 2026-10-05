import { describe, expect, test } from "bun:test";
import {
  catalogEmptyCopy,
  catalogExpressionForRow,
  catalogRowsForResolvedInstruments,
  filterCatalogRows,
  listStaticCatalogInventory,
  looksLikeCatalogTickerQuery,
  parseCatalogQuery,
} from "./catalog-inventory";
import { defillamaSeriesCatalog } from "../defillama/catalog";
import { fredSeriesCatalog } from "../econ/fred-series-map";

const AAPL = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };
const MSFT = { symbol: "MSFT", exchange: "NASDAQ", name: "Microsoft Corp." };

describe("data catalog inventory", () => {
  test("lists equity fields once and asks for a ticker when graphing", () => {
    const rows = listStaticCatalogInventory([AAPL, MSFT]);
    const securities = filterCatalogRows(rows, "securities", "");
    expect(securities.some((row) => row.label === "Close")).toBe(true);
    expect(securities.every((row) => row.needsTicker && row.expression.startsWith("TICKER:"))).toBe(true);
    expect(securities.every((row) => !row.label.includes("AAPL") && !row.label.includes("MSFT"))).toBe(true);
    expect(securities.filter((row) => row.label === "Close")).toHaveLength(1);

    const close = securities.find((row) => row.label === "Close");
    expect(catalogExpressionForRow(close!, "aapl")).toBe("AAPL:close");
    expect(catalogExpressionForRow(close!, "")).toBeNull();
    expect(securities.find((row) => row.id === "field:market.ohlcv")?.expression).toBe("TICKER:price");
  });

  test("options tab lists contract market fields and asks for an option symbol", () => {
    const rows = listStaticCatalogInventory([AAPL]);
    const options = filterCatalogRows(rows, "options", "");
    expect(options.some((row) => row.label === "Close")).toBe(true);
    expect(options.some((row) => row.label === "Volume")).toBe(true);
    expect(options.every((row) => row.needsTicker && row.expression.startsWith("TICKER:"))).toBe(true);
    expect(options.every((row) => row.kind === "Options" && row.sourceId === "option")).toBe(true);
    expect(options.some((row) => row.label === "PEG Ratio")).toBe(false);

    const close = options.find((row) => row.label === "Close");
    expect(catalogExpressionForRow(close!, "AAPL 260618C00200000")).toBe("AAPL260618C00200000:close");
    expect(catalogExpressionForRow(close!, "aapl260618c00200000")).toBe("AAPL260618C00200000:close");
    expect(catalogExpressionForRow(close!, "")).toBeNull();
  });

  test("crypto tab keeps prices and DeFi fundamentals out of the equity field picker", () => {
    const rows = listStaticCatalogInventory([
      AAPL,
      { symbol: "ETH-USD", exchange: "CCC", name: "Ethereum USD" },
    ], [defillamaSeriesCatalog]);
    const crypto = filterCatalogRows(rows, "crypto", "");
    expect(crypto.some((row) => row.expression === "LLAMA:chain:ethereum:tvl")).toBe(true);
    expect(crypto.some((row) => row.expression === "LLAMA:protocol:aave:tvl")).toBe(true);
    expect(crypto.some((row) => row.expression === "ETH-USD:price")).toBe(true);
    expect(crypto.some((row) => row.expression === "BTC-USD:price")).toBe(true);
    expect(crypto.every((row) => !row.needsTicker)).toBe(true);
    expect(filterCatalogRows(rows, "securities", "").some((row) => ["crypto", "defillama"].includes(row.sourceId))).toBe(false);
  });

  test("FRED tab includes mapped series and treasuries; futures stay on their own tab", () => {
    const rows = listStaticCatalogInventory([], [fredSeriesCatalog]);
    const fred = filterCatalogRows(rows, "fred", "");
    const seriesIds = fred.filter((row) => row.sourceId === "fred").map((row) => row.expression);
    expect(new Set(seriesIds).size).toBe(seriesIds.length);
    expect(fred.some((row) => row.expression === "FRED:CPIAUCSL")).toBe(true);
    expect(fred.some((row) => row.expression === "UST:10Y" && row.kind === "Treasury")).toBe(true);
    expect(fred.every((row) => row.sourceId === "fred" || row.sourceId === "treasury")).toBe(true);

    const futures = filterCatalogRows(rows, "futures", "");
    expect(futures.some((row) => row.expression === "FUT:ES")).toBe(true);
    expect(futures.every((row) => row.sourceId === "futures")).toBe(true);
    expect(futures.some((row) => row.sourceId === "treasury")).toBe(false);
  });

  test("resolves a ticker query onto chartable rows without treating field names as tickers", () => {
    expect(looksLikeCatalogTickerQuery("AAPL")).toBe(true);
    expect(looksLikeCatalogTickerQuery("btc-usd")).toBe(true);
    expect(looksLikeCatalogTickerQuery("close")).toBe(false);
    expect(looksLikeCatalogTickerQuery("price")).toBe(false);

    const resolved = catalogRowsForResolvedInstruments([AAPL]);
    expect(resolved.some((row) => row.expression === "AAPL:close")).toBe(true);
    expect(resolved.some((row) => row.expression === "AAPL:price")).toBe(true);
    expect(resolved.every((row) => !row.needsTicker && row.label.startsWith("AAPL"))).toBe(true);
    expect(filterCatalogRows(resolved, "securities", "AAPL").some((row) => row.expression === "AAPL:close")).toBe(true);
  });

  test("ticker:valuation keeps that symbol's multiples and the macro valuation set", () => {
    expect(parseCatalogQuery("dkng:valuation")).toEqual({ text: "dkng", filter: "valuation" });
    expect(parseCatalogQuery("DKNG:Valuations")).toEqual({ text: "DKNG", filter: "valuation" });
    expect(parseCatalogQuery("brk.b:securities")).toEqual({ text: "brk.b", filter: "securities" });
    expect(parseCatalogQuery("FRED:CPIAUCSL")).toEqual({ text: "FRED:CPIAUCSL", filter: null });
    expect(parseCatalogQuery("DKNG:close")).toEqual({ text: "DKNG:close", filter: null });
    expect(parseCatalogQuery("life expectancy")).toEqual({ text: "life expectancy", filter: null });

    const dkng = catalogRowsForResolvedInstruments([{ symbol: "DKNG", name: "DraftKings Inc." }]);
    const valuation = filterCatalogRows(dkng, "valuation", "dkng");
    expect(valuation.map((row) => row.expression).sort()).toEqual([
      "DKNG:dividendYield",
      "DKNG:earningsYield",
      "DKNG:evEbitda",
      "DKNG:evSales",
      "DKNG:forwardPE",
      "DKNG:pegRatio",
      "DKNG:priceFcf",
      "DKNG:priceSales",
      "DKNG:trailingPE",
    ]);
    expect(valuation.every((row) => row.kind === "Valuation" && row.sourceId === "security")).toBe(true);

    const catalog = listStaticCatalogInventory();
    const tab = filterCatalogRows(catalog, "valuation", "");
    expect(tab.some((row) => row.expression === "TICKER:trailingPE" && row.kind === "Valuation")).toBe(true);
    expect(tab.some((row) => row.sourceId === "valuation")).toBe(true);
    expect(tab.some((row) => row.expression === "TICKER:close" || row.expression === "TICKER:eps")).toBe(false);
    expect(filterCatalogRows(catalog, "securities", "").some((row) => row.expression === "TICKER:trailingPE")).toBe(true);
  });

  test("empty copy covers loading and query misses without a retry hint", () => {
    expect(catalogEmptyCopy(true, "AAPL")).toEqual({ title: "Loading catalog…" });
    expect(catalogEmptyCopy(false, "AAPL")).toEqual({
      title: 'No series matching "AAPL"',
      hint: "Press / to search.",
    });
    expect(catalogEmptyCopy(false, "")).toEqual({
      title: "No series",
      hint: "Press / to search.",
    });
  });
});
