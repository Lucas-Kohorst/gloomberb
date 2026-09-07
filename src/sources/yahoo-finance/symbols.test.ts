import { describe, expect, test } from "bun:test";
import { getYahooSymbol, getYahooSymbolsToTry } from "./symbols";

describe("Yahoo symbol routing", () => {
  test("canonicalizes MIC aliases before applying exchange suffixes", () => {
    expect(getYahooSymbol("VOD", "XLON")).toBe("VOD.L");
    expect(getYahooSymbolsToTry("0700", "XHKG")).toEqual(["0700.HK"]);
    expect(getYahooSymbolsToTry("SHOP", "XTSE")).toEqual(["SHOP.TO"]);
  });

  test("keeps bare US equities and caret indexes unexpanded without an exchange", () => {
    expect(getYahooSymbolsToTry("COIN", "")).toEqual(["COIN"]);
    expect(getYahooSymbolsToTry("AAPL", "")).toEqual(["AAPL"]);
    expect(getYahooSymbolsToTry("VIX", "")).toEqual(["^VIX"]);
    expect(getYahooSymbolsToTry("^TNX", "")).toEqual(["^TNX"]);
  });

  test("preserves a dotted US equity ahead of its hyphenated Yahoo form", () => {
    expect(getYahooSymbolsToTry("BRK.B", "")).toEqual(["BRK-B", "BRK.B"]);
  });
});
