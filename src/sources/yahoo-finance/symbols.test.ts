import { describe, expect, test } from "bun:test";
import { getYahooSymbol, getYahooSymbolsToTry } from "./symbols";

describe("Yahoo symbol routing", () => {
  test("canonicalizes MIC aliases before applying exchange suffixes", () => {
    expect(getYahooSymbol("VOD", "XLON")).toBe("VOD.L");
    expect(getYahooSymbolsToTry("0700", "XHKG")).toEqual(["0700.HK"]);
    expect(getYahooSymbolsToTry("SHOP", "XTSE")).toEqual(["SHOP.TO"]);
  });
});
