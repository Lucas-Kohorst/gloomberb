import { describe, expect, test } from "bun:test";
import {
  getYahooSymbol,
  getYahooSymbolsToTry,
  tickerHasYahooSuffix,
  yahooSuffixConflictsWithExchange,
  yahooSuffixExchange,
} from "./symbols";

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

  test("does not treat Yahoo's Philippines PSE suffix as the host Prague venue", () => {
    expect(tickerHasYahooSuffix("AC.PS")).toBe(true);
    expect(yahooSuffixExchange("AC.PS")).toBeUndefined();
    expect(yahooSuffixExchange("CEZ.PR")).toBe("PSE");
    expect(yahooSuffixConflictsWithExchange("CEZ.PR", "PSE")).toBe(false);
    expect(yahooSuffixConflictsWithExchange("AC.PS", "PSE")).toBe(true);
    expect(yahooSuffixConflictsWithExchange("7203.T", "TSE")).toBe(true);
    expect(yahooSuffixConflictsWithExchange("7203.T", "JPX")).toBe(false);
    expect(yahooSuffixConflictsWithExchange("RY.TO", "TSX")).toBe(false);
  });
});
