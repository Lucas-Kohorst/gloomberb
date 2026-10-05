import { expect, test } from "bun:test";
import type { Quote, TickerFinancials } from "../../../types/financials";
import type { TickerRecord } from "../../../types/ticker";
import {
  buildPortfolioHeatmapAssets,
  fallbackHeatmapCollectionId,
  heatmapFollowsCollection,
  heatmapPortfolioPanes,
  heatmapPortfolioSignature,
  parseHeatmapPortfolioSignature,
  resolveHeatmapPortfolioSource,
} from "./portfolio";

function ticker(symbol: string, overrides: Partial<TickerRecord["metadata"]> = {}): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange: "NASDAQ",
      currency: "USD",
      name: symbol,
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      ...overrides,
    },
  };
}

function quote(symbol: string, patch: Partial<Quote> = {}): TickerFinancials {
  return {
    annualStatements: [],
    quarterlyStatements: [],
    priceHistory: [],
    quote: {
      symbol,
      price: 10,
      currency: "USD",
      change: 1,
      changePercent: 10,
      lastUpdated: 1,
      ...patch,
    },
  };
}

test("a focused portfolio pane wins, and the last one wins after focus leaves", () => {
  const panes = [
    { instanceId: "portfolio-list:main", collectionId: "main" },
    { instanceId: "portfolio-list:extra", collectionId: "growth" },
  ];
  expect(resolveHeatmapPortfolioSource(panes, "portfolio-list:extra", "portfolio-list:main")?.collectionId).toBe("growth");
  expect(resolveHeatmapPortfolioSource(panes, "market-heatmap:1", "portfolio-list:extra")?.collectionId).toBe("growth");
  expect(resolveHeatmapPortfolioSource(panes, null, null)?.instanceId).toBe("portfolio-list:main");
  expect(resolveHeatmapPortfolioSource([], "portfolio-list:main", null)).toBeNull();
});

test("portfolio pane state overrides the instance param", () => {
  const panes = heatmapPortfolioPanes(
    [{ instanceId: "portfolio-list:main", paneId: "portfolio-list", params: { collectionId: "main" } }],
    { "portfolio-list:main": { collectionId: "watchlist" } },
  );
  expect(panes).toEqual([{ instanceId: "portfolio-list:main", collectionId: "watchlist" }]);
  const signature = heatmapPortfolioSignature({
    focusedPaneId: "market-heatmap:1",
    config: { layout: { instances: [
      { instanceId: "portfolio-list:main", paneId: "portfolio-list", params: { collectionId: "main" } },
      { instanceId: "market-heatmap:1", paneId: "market-heatmap" },
    ] } },
    paneState: { "portfolio-list:main": { collectionId: "watchlist" } },
  });
  expect(parseHeatmapPortfolioSignature(signature)).toEqual({
    focusedPaneId: "market-heatmap:1",
    panes: [{ instanceId: "portfolio-list:main", collectionId: "watchlist" }],
  });
});

test("linking follows a later list and ignores the list already on screen", () => {
  expect(heatmapFollowsCollection(true, null, "main")).toBe(false);
  expect(heatmapFollowsCollection(true, "main", "main")).toBe(false);
  expect(heatmapFollowsCollection(false, "main", "growth")).toBe(false);
  expect(heatmapFollowsCollection(true, "main", "growth")).toBe(true);
  expect(fallbackHeatmapCollectionId({ portfolios: [], watchlists: [{ id: "watchlist" }] })).toBe("watchlist");
});

test("portfolio tiles use position value and watchlist tiles use market cap", () => {
  const held = ticker("AAPL", {
    portfolios: ["main"],
    positions: [{ portfolio: "main", shares: 10, marketValue: 5_000, broker: "manual" }],
  });
  const larger = ticker("MSFT", {
    portfolios: ["main"],
    positions: [{ portfolio: "main", shares: 2, marketValue: -20_000, broker: "manual" }],
  });
  const quoted = new Map<string, TickerFinancials>([
    ["AAPL", quote("AAPL", { changePercent: -2, change: -4, price: 200 })],
    ["MSFT", quote("MSFT")],
  ]);
  const portfolio = buildPortfolioHeatmapAssets({
    tickers: [held, larger],
    financials: quoted,
    collectionId: "main",
    kind: "portfolio",
  });
  expect(portfolio.map((asset) => asset.symbol)).toEqual(["MSFT", "AAPL"]);
  expect(portfolio[0]).toMatchObject({ size: 20_000, weight: 20_000, sizeCaption: "Value", showSize: true, hasChange: true });
  expect(portfolio[1]).toMatchObject({ changePercent: -2, hasChange: true, weight: 5_000 });

  const listed = ticker("SPY", { watchlists: ["watchlist"] });
  const unquoted = ticker("IWM", { watchlists: ["watchlist"] });
  const watchlist = buildPortfolioHeatmapAssets({
    tickers: [unquoted, listed],
    financials: new Map([["SPY", { ...quote("SPY"), fundamentals: { marketCap: 400, marketCapCurrency: "USD" } }]]),
    collectionId: "watchlist",
    kind: "watchlist",
  });
  expect(watchlist.map((asset) => [asset.symbol, asset.showSize, asset.sizeCaption])).toEqual([
    ["SPY", true, undefined],
    ["IWM", false, undefined],
  ]);
  expect(watchlist[0]?.size).toBe(400);
  expect(watchlist[0]?.weight).toBe(20);
  expect(watchlist[1]?.size).toBe(400);
  expect(watchlist[1]?.weight).toBe(20);
});
