import { describe, expect, test } from "bun:test";
import type { InstrumentSearchResult } from "../../../types/instrument";
import {
  catalogBondHits,
  isBondLikeSearchResult,
  searchBonds,
} from "./search";

function instrument(overrides: Partial<InstrumentSearchResult>): InstrumentSearchResult {
  return {
    providerId: "yahoo",
    symbol: "TLT",
    name: "iShares 20+ Year Treasury Bond ETF",
    exchange: "NGM",
    type: "ETF",
    ...overrides,
  };
}

describe("bond search", () => {
  test("catalog includes treasury, corporate, credit, and rate futures", () => {
    const ids = catalogBondHits().map((hit) => hit.arg);
    expect(ids).toContain("UST:10Y");
    expect(ids).toContain("FRED:BAMLC0A1CAAAEY");
    expect(ids).toContain("FRED:BAMLH0A0HYM2");
    expect(ids).toContain("FUT:ZN");
  });

  test("empty query lists catalog series and skips live search", async () => {
    let called = false;
    const result = await searchBonds("", {
      searchInstruments: async () => {
        called = true;
        return [instrument({})];
      },
    });
    expect(called).toBe(false);
    expect(result.hits.every((hit) => hit.kind === "series")).toBe(true);
    expect(result.hits.length).toBeGreaterThan(8);
  });

  test("filters catalog by all-words query and ranks exact maturity first", async () => {
    const result = await searchBonds("10y");
    expect(result.hits[0]?.arg).toBe("UST:10Y");
    expect(result.hits.every((hit) => hit.searchText.includes("10y") || hit.arg.toLowerCase().includes("10y")))
      .toBe(true);
  });

  test("keeps bond-like live instruments and drops equities", async () => {
    const result = await searchBonds("treasury", {
      searchInstruments: async () => [
        instrument({}),
        instrument({ symbol: "AAPL", name: "Apple Inc.", type: "EQUITY", exchange: "NMS" }),
        instrument({ symbol: "912810SX7", name: "United States Treasury Bond", type: "BOND", exchange: "BOND" }),
      ],
    });
    const symbols = result.hits.filter((hit) => hit.kind === "instrument").map((hit) => hit.symbol);
    expect(symbols).toContain("TLT");
    expect(symbols).toContain("912810SX7");
    expect(symbols).not.toContain("AAPL");
  });

  test("isBondLikeSearchResult accepts BOND types and treasury names only", () => {
    expect(isBondLikeSearchResult(instrument({ type: "BOND", name: "US Treasury", symbol: "912810SX7" }))).toBe(true);
    expect(isBondLikeSearchResult(instrument({}))).toBe(true);
    expect(isBondLikeSearchResult(instrument({ symbol: "AAPL", name: "Apple Inc.", type: "EQUITY" }))).toBe(false);
  });

  test("live search failure still returns catalog hits", async () => {
    const result = await searchBonds("aaa", {
      searchInstruments: async () => {
        throw new Error("yahoo down");
      },
    });
    expect(result.instrumentError).toBe("yahoo down");
    expect(result.hits.some((hit) => hit.arg === "FRED:BAMLC0A1CAAAEY")).toBe(true);
  });
});
