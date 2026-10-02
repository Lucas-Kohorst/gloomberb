import { describe, expect, test } from "bun:test";
import { classifyInstrumentKind, parseTickerListingQuery } from "./ranking";
import { assetClassesForQuery, parseAssetClassQuery } from "./asset-classes";

describe("asset class query", () => {
  test("a bare code opens the whole list and still names that symbol", () => {
    expect(parseAssetClassQuery("eq")).toEqual({ code: "EQ", symbolQuery: "", showMenu: true });
    expect(assetClassesForQuery("EQ").map((entry) => entry.code)).toEqual([
      "EQ", "CUR", "OPT", "FUT", "IDX", "ETF",
    ]);
    expect(parseTickerListingQuery("EQ").symbol).toBe("EQ");
  });

  test("a code plus a symbol searches the symbol inside that class", () => {
    expect(parseAssetClassQuery("EQ BIRD")).toEqual({
      code: "EQ",
      symbolQuery: "BIRD",
      showMenu: false,
    });
    expect(parseTickerListingQuery("EQ BIRD NASDAQ")).toMatchObject({
      symbol: "BIRD",
      exchangeHints: ["NASDAQ"],
    });
  });

  test("a prefix lists the matching codes and a single letter does not", () => {
    expect(assetClassesForQuery("ET").map((entry) => entry.code)).toEqual(["ETF"]);
    expect(parseAssetClassQuery("E").showMenu).toBe(false);
    expect(parseAssetClassQuery("BIRD").showMenu).toBe(false);
  });
});

describe("instrument class from a provider type", () => {
  test("maps the six command-bar classes", () => {
    expect(classifyInstrumentKind("EQUITY")).toBe("equity");
    expect(classifyInstrumentKind("CURRENCY")).toBe("currency");
    expect(classifyInstrumentKind("OPTION")).toBe("option");
    expect(classifyInstrumentKind("FUTURE")).toBe("future");
    expect(classifyInstrumentKind("INDEX")).toBe("index");
    expect(classifyInstrumentKind("ETF")).toBe("etf");
    expect(classifyInstrumentKind("MUTUALFUND")).toBe("fund");
  });
});
