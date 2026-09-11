import { describe, expect, test } from "bun:test";
import {
  bookPageUrl,
  bookUrl,
  computeBookStats,
  parseCboeBook,
} from "./client";
import { normalizeCboeMarket } from "./types";

/** Live-shaped AAPL payload captured from www.cboe.com/json/bzx/book/AAPL. */
const AAPL_FIXTURE = {
  success: true,
  reload: 5000,
  data: {
    symbol: "AAPL",
    auction: false,
    company: "APPLE INC COM",
    prev: 316.22,
    open: 317.2,
    high: 319.14,
    low: 309.91,
    last: 315.86,
    change: -0.36,
    volume: 3255462,
    ordersOrTrades: 3333149,
    asks: [
      [141, 316.0],
      [40, 316.61],
      [10, 316.66],
      [2, 316.98],
      [3, 317.28],
    ],
    bids: [
      [50, 315.9],
      [1, 315.8],
      [10, 315.77],
      [3, 315.69],
      [12, 315.58],
    ],
    trades: [
      ["16:19:09", "1", "315.86000000", "16:19:09.625000"],
      ["16:19:09", "50", "315.94000000", "16:19:09.230000"],
      ["16:18:24", "40", "316.00000000", "16:18:24.460000"],
    ],
    timestamp: "16:19:43",
    tick_type: "",
    status: "PostMarketCloseReceived",
  },
};

describe("parseCboeBook", () => {
  test("parses a live-shaped book envelope", () => {
    const book = parseCboeBook(AAPL_FIXTURE);
    expect(book.symbol).toBe("AAPL");
    expect(book.company).toBe("APPLE INC COM");
    expect(book.last).toBeCloseTo(315.86, 6);
    expect(book.asks).toHaveLength(5);
    expect(book.bids).toHaveLength(5);
    expect(book.asks[0]).toEqual({ shares: 141, price: 316.0 });
    expect(book.bids[0]).toEqual({ shares: 50, price: 315.9 });
    expect(book.timestamp).toBe("16:19:43");
    expect(book.status).toBe("PostMarketCloseReceived");
  });

  test("reads the tape as [time, shares, price]", () => {
    // The second tuple field is the small lot ("1") and the third is the
    // quote-near price ("315.86"); swapping them would price shares at $1.
    const book = parseCboeBook(AAPL_FIXTURE);
    expect(book.trades[0]).toEqual({ time: "16:19:09", shares: 1, price: 315.86 });
    expect(book.trades[1]).toEqual({ time: "16:19:09", shares: 50, price: 315.94 });
  });

  test("sorts asks ascending and bids descending", () => {
    const book = parseCboeBook({
      data: {
        symbol: "MSFT",
        asks: [
          [1, 492.28],
          [1, 492.15],
          [299, 492.25],
        ],
        bids: [
          [1, 490.5],
          [3, 491.6],
          [448, 491.0],
        ],
        trades: [],
      },
    });
    expect(book.asks.map((level) => level.price)).toEqual([492.15, 492.25, 492.28]);
    expect(book.bids.map((level) => level.price)).toEqual([491.6, 491.0, 490.5]);
  });

  test("coerces numeric strings and drops malformed levels", () => {
    const book = parseCboeBook({
      data: {
        symbol: "AAPL",
        asks: [["100", "316.00"], ["bad", 1], [5, -2], null],
        bids: [[50, "315.90"], [], [10]],
        trades: [["16:19:09", "10", "315.90"], ["bad"], null],
      },
    });
    expect(book.asks).toEqual([{ shares: 100, price: 316 }]);
    expect(book.bids).toEqual([{ shares: 50, price: 315.9 }]);
    expect(book.trades).toEqual([{ time: "16:19:09", shares: 10, price: 315.9 }]);
  });

  test("tolerates a missing envelope", () => {
    const book = parseCboeBook({});
    expect(book.symbol).toBe("");
    expect(book.asks).toEqual([]);
    expect(book.bids).toEqual([]);
    expect(book.trades).toEqual([]);
    expect(book.last).toBeNull();
  });
});

describe("computeBookStats", () => {
  test("derives spread, mid, and bps from the best pair", () => {
    const book = parseCboeBook(AAPL_FIXTURE);
    const stats = computeBookStats(book);
    expect(stats.bestBid).toBeCloseTo(315.9, 6);
    expect(stats.bestAsk).toBeCloseTo(316.0, 6);
    expect(stats.spread).toBeCloseTo(0.1, 6);
    expect(stats.mid).toBeCloseTo(315.95, 6);
    expect(stats.spreadBps).toBeCloseTo((0.1 / 315.95) * 10_000, 6);
  });

  test("returns nulls when either side is missing", () => {
    expect(
      computeBookStats({ asks: [], bids: [{ shares: 1, price: 10 }] }),
    ).toEqual({ bestBid: 10, bestAsk: null, spread: null, spreadBps: null, mid: null });
    expect(computeBookStats({ asks: [], bids: [] }).spread).toBeNull();
  });
});

describe("book endpoints", () => {
  test("builds per-market book and page URLs", () => {
    expect(bookUrl("aapl", "edgx")).toBe("https://www.cboe.com/json/edgx/book/AAPL");
    expect(bookPageUrl("AAPL", "bzx")).toBe(
      "https://www.cboe.com/us/equities/market_statistics/book/AAPL/?mkt=bzx",
    );
  });

  test("falls back to bzx for unknown markets", () => {
    expect(normalizeCboeMarket("E D G X")).toBe("bzx");
    expect(bookUrl("MSFT", "bogus" as never)).toBe("https://www.cboe.com/json/bzx/book/MSFT");
  });
});
