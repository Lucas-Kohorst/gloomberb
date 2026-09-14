import { describe, expect, test } from "bun:test";
import type { CorporateActionsData } from "../../../types/financials";
import { buildPortfolioEventRows, resolvePortfolioEventsCollectionId } from "./portfolio-events-model";

type CollectionConfig = Parameters<typeof resolvePortfolioEventsCollectionId>[0];

function collections(portfolios: string[], watchlists: string[]): CollectionConfig {
  return {
    portfolios: portfolios.map((id) => ({ id, name: id })),
    watchlists: watchlists.map((id) => ({ id, name: id })),
  } as CollectionConfig;
}

function actions(symbol: string, date: string): CorporateActionsData {
  return {
    symbol,
    currency: "USD",
    dividends: [{ exDate: date, amount: 0.25 }],
    splits: [],
    earnings: [],
  };
}

describe("portfolio event rows", () => {
  test("normalizes symbols, deduplicates repeated collection entries, and sorts by date", () => {
    const rows = buildPortfolioEventRows([
      { symbol: " msft ", currency: "USD", data: actions("MSFT", "2026-06-01") },
      { symbol: "AAPL", currency: "USD", data: actions("AAPL", "2026-05-01") },
      { symbol: "MSFT", currency: "USD", data: actions("MSFT", "2026-06-01") },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => `${row.symbol}:${row.date}`)).toEqual([
      "AAPL:2026-05-01",
      "MSFT:2026-06-01",
    ]);
    expect(rows.map((row) => row.id)).toEqual([
      "AAPL:div:2026-05-01",
      "MSFT:div:2026-06-01",
    ]);
  });
});

describe("portfolio events scope", () => {
  const config = collections(["book", "second"], ["main"]);

  test("prefers the pane setting, then the followed pane, then the first book", () => {
    expect(resolvePortfolioEventsCollectionId(config, { collectionId: " main " }, null)).toBe("main");
    expect(resolvePortfolioEventsCollectionId(config, undefined, "second")).toBe("second");
    expect(resolvePortfolioEventsCollectionId(config, undefined, null)).toBe("book");
    expect(resolvePortfolioEventsCollectionId(collections([], ["main"]), undefined, null)).toBe("main");
  });

  test("falls through a collection id that no longer exists", () => {
    expect(resolvePortfolioEventsCollectionId(config, { collectionId: "deleted" }, "main")).toBe("main");
    expect(resolvePortfolioEventsCollectionId(config, { collectionId: "deleted" }, null)).toBe("book");
    expect(resolvePortfolioEventsCollectionId(collections([], []), undefined, null)).toBeNull();
  });
});
