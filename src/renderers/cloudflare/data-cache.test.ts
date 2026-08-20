import { describe, expect, test } from "bun:test";
import {
  applyHostedSharedVendorKeys,
  hostedPublicGetCacheTtlSeconds,
} from "./data-cache";

describe("hosted data cache", () => {
  test("caches VoteHub, Adjacent, and Artificial Analysis GETs for shared hosted users", () => {
    expect(hostedPublicGetCacheTtlSeconds({ url: "https://api.votehub.com/polls" })).toBe(300);
    expect(hostedPublicGetCacheTtlSeconds({ url: "https://api.adjacent.markets/api/v1/indices" })).toBe(60);
    expect(hostedPublicGetCacheTtlSeconds({
      url: "https://artificialanalysis.ai/api/v2/language/models/free",
    })).toBe(900);
  });

  test("does not share a cache entry when the client sent its own vendor key", () => {
    expect(hostedPublicGetCacheTtlSeconds({
      url: "https://api.adjacent.markets/api/v1/indices",
      init: { headers: { Authorization: "Bearer user-key" } },
    })).toBeNull();
    expect(hostedPublicGetCacheTtlSeconds({
      url: "https://artificialanalysis.ai/api/v2/language/models/free",
      init: { headers: { "x-api-key": "user-key" } },
    })).toBeNull();
  });

  test("caches Yahoo, Nasdaq Trader, and stockanalysis GETs used by SI/DVD/HALT/IPO", () => {
    expect(hostedPublicGetCacheTtlSeconds({
      url: "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
    })).toBe(60);
    expect(hostedPublicGetCacheTtlSeconds({
      url: "https://www.nasdaqtrader.com/rss.aspx?feed=currenthalts",
    })).toBe(60);
    expect(hostedPublicGetCacheTtlSeconds({
      url: "https://stockanalysis.com/api/screener/s/f/ipo-date/desc",
    })).toBe(120);
  });

  test("does not cache Yahoo crumb requests", () => {
    expect(hostedPublicGetCacheTtlSeconds({
      url: "https://query1.finance.yahoo.com/v1/test/getcrumb",
    })).toBeNull();
  });

  test("caches OWID grapher GETs for six hours", () => {
    expect(hostedPublicGetCacheTtlSeconds({
      url: "https://ourworldindata.org/grapher/life-expectancy.csv",
    })).toBe(21600);
  });

  test("does not cache RSS hosts", () => {
    expect(hostedPublicGetCacheTtlSeconds({ url: "https://feeds.bbci.co.uk/news/rss.xml" })).toBeNull();
    expect(hostedPublicGetCacheTtlSeconds({ url: "https://www.theverge.com/rss/index.xml" })).toBeNull();
  });

  test("injects Worker Adjacent and Artificial Analysis keys when the client omitted them", () => {
    const adjacent = applyHostedSharedVendorKeys(
      { url: "https://api.adjacent.markets/api/v1/indices" },
      { ADJACENT_API_KEY: "adj-secret" },
    );
    expect(adjacent.init?.headers?.Authorization).toBe("Bearer adj-secret");

    const aa = applyHostedSharedVendorKeys(
      { url: "https://artificialanalysis.ai/api/v2/language/models/free" },
      { ARTIFICIAL_ANALYSIS_API_KEY: "aa-secret" },
    );
    expect(aa.init?.headers?.["x-api-key"]).toBe("aa-secret");
  });

  test("leaves a caller-supplied vendor key untouched", () => {
    const adjacent = applyHostedSharedVendorKeys(
      {
        url: "https://api.adjacent.markets/api/v1/indices",
        init: { headers: { Authorization: "Bearer user-key" } },
      },
      { ADJACENT_API_KEY: "adj-secret" },
    );
    expect(adjacent.init?.headers?.Authorization).toBe("Bearer user-key");
  });
});
