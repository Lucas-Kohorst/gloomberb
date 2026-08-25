import { describe, expect, test } from "bun:test";
import { applyBrokerInstanceRemovalToTickers } from "./plugin-bindings";
import type { TickerPosition, TickerRecord } from "../../types/ticker";

function position(partial: Partial<TickerPosition> & { brokerInstanceId: string }): TickerPosition {
  return {
    portfolio: `${partial.brokerInstanceId}-port`,
    shares: 1,
    avgCost: 10,
    broker: "robinhood",
    ...partial,
  };
}

function record(partial: Partial<TickerRecord["metadata"]> & { ticker: string }): TickerRecord {
  return {
    metadata: {
      ticker: partial.ticker,
      exchange: "NASDAQ",
      currency: "USD",
      name: partial.ticker,
      sector: "",
      industry: "",
      assetCategory: "equity",
      isin: "",
      cusip: "",
      portfolios: [],
      watchlists: [],
      positions: [],
      custom: {},
      tags: [],
      broker_contracts: [],
      ...partial,
    },
  };
}

describe("applyBrokerInstanceRemovalToTickers", () => {
  test("deletes tickers that only exist because of that broker instance", () => {
    const { nextTickers, removedSymbols, changedTickers } = applyBrokerInstanceRemovalToTickers(
      [
        record({
          ticker: "HOOD",
          portfolios: ["rh-1-port"],
          positions: [position({ brokerInstanceId: "rh-1", portfolio: "rh-1-port" })],
        }),
        record({ ticker: "AAPL", watchlists: ["watchlist"] }),
      ],
      "rh-1",
      new Set(["rh-1-port"]),
    );
    expect(removedSymbols).toEqual(["HOOD"]);
    expect(changedTickers).toEqual([]);
    expect([...nextTickers.keys()]).toEqual(["AAPL"]);
  });

  test("strips the broker position but keeps a watchlist ticker", () => {
    const { nextTickers, removedSymbols, changedTickers } = applyBrokerInstanceRemovalToTickers(
      [
        record({
          ticker: "NVDA",
          watchlists: ["watchlist"],
          positions: [
            position({ brokerInstanceId: "rh-1", portfolio: "rh-1-port", shares: 1, marketValue: 50 }),
            position({
              brokerInstanceId: "alp-1",
              broker: "alpaca",
              portfolio: "alp-1-port",
              shares: 3,
              marketValue: 150,
            }),
          ],
        }),
      ],
      "rh-1",
      new Set(["rh-1-port"]),
    );
    expect(removedSymbols).toEqual([]);
    expect(changedTickers).toHaveLength(1);
    expect(changedTickers[0]?.metadata.positions).toEqual([
      position({
        brokerInstanceId: "alp-1",
        broker: "alpaca",
        portfolio: "alp-1-port",
        shares: 3,
        marketValue: 150,
      }),
    ]);
    expect(nextTickers.get("NVDA")?.metadata.positions).toEqual(changedTickers[0]?.metadata.positions);
    expect(nextTickers.get("NVDA")?.metadata.watchlists).toEqual(["watchlist"]);
  });

  test("leaves unrelated tickers untouched", () => {
    const rows = [
      record({ ticker: "SPY", watchlists: ["watchlist"] }),
      record({ ticker: "QQQ", watchlists: ["watchlist"] }),
    ];
    const { nextTickers, removedSymbols, changedTickers } = applyBrokerInstanceRemovalToTickers(
      rows,
      "missing-broker",
      new Set(),
    );
    expect(removedSymbols).toEqual([]);
    expect(changedTickers).toEqual([]);
    expect(nextTickers.get("SPY")).toBe(rows[0]);
    expect(nextTickers.get("QQQ")).toBe(rows[1]);
  });
});
