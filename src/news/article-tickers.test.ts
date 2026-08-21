import { describe, expect, test } from "bun:test";
import {
  buildArticleTickerUniverse,
  extractArticleTickers,
  extractArticleTickersFromParts,
} from "./article-tickers";

const catalog = buildArticleTickerUniverse({
  book: [{ symbol: "HOOD", name: "Robinhood Markets" }],
  catalog: [
    { symbol: "BRK.B", name: "Berkshire Hathaway" },
    { symbol: "BF-B", name: "Brown Forman" },
    { symbol: "SNOW", name: "Snowflake" },
    { symbol: "ARM", name: "Arm Holdings" },
  ],
});

describe("extractArticleTickers", () => {
  test("trusts cashtags, parentheticals, and exchange-prefixed symbols", () => {
    expect(extractArticleTickers("$NVDA rips after (AAPL) and NASDAQ:MSFT guidance", catalog)).toEqual([
      "NVDA",
      "MSFT",
      "AAPL",
    ]);
  });

  test("extracts crypto cashtags", () => {
    expect(extractArticleTickers("Flows into $BTC $ETH and $SOL overnight", catalog)).toEqual([
      "BTC",
      "ETH",
      "SOL",
    ]);
  });

  test("keeps dotted and hyphen cashtags only when they exist in the catalog", () => {
    expect(extractArticleTickers("Buying $BRK.B and $BF-B", catalog)).toEqual(["BRK.B", "BF-B"]);
    expect(extractArticleTickers("Buying $BRK.B and $BF-B")).toEqual([]);
  });

  test("bare tokens match mega-caps or the user book, not the catalog", () => {
    expect(extractArticleTickers("NVDA and HOOD rallied while ARM stalled", catalog)).toEqual([
      "NVDA",
      "HOOD",
    ]);
    expect(extractArticleTickers("ARM stalled", catalog)).toEqual([]);
  });

  test("matches company names from watchlist and catalog, not only mega-caps", () => {
    expect(extractArticleTickers("Robinhood Markets and Snowflake posted results", catalog)).toEqual([
      "HOOD",
      "SNOW",
    ]);
    expect(extractArticleTickers("Nvidia beat earnings", catalog)).toEqual(["NVDA"]);
  });

  test("does not treat CEO, GDP, or THE as tickers", () => {
    expect(extractArticleTickers("CEO says GDP rose as THE market opened", catalog)).toEqual([]);
  });

  test("joins tweet and quoted/retweet text", () => {
    expect(extractArticleTickersFromParts([
      "Agree with this take",
      "Long $NVDA into earnings",
    ], catalog)).toEqual(["NVDA"]);
  });
});

describe("buildArticleTickerUniverse", () => {
  test("copies full book tickers into the catalog, not their first letters", () => {
    const universe = buildArticleTickerUniverse({
      book: [{ symbol: "HOOD", name: "Robinhood Markets" }],
    });
    expect(universe.catalogSymbols.has("HOOD")).toBe(true);
    expect(universe.catalogSymbols.has("H")).toBe(false);
    expect(universe.catalogSymbols.has("M")).toBe(false);
  });
});
