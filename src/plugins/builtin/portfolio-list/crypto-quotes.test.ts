import { afterEach, describe, expect, test } from "bun:test";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { isCryptoMarketInstrument } from "../../../sources/coingecko/ids";
import { AssetDataRouter } from "../../../sources/provider-router";
import { fallbackProvider, makeQuote } from "../../../sources/provider-router/test-support";
import type { DataProvider } from "../../../types/data-provider";
import type { TickerRecord } from "../../../types/ticker";
import { getColumnValue, type ColumnContext } from "./metrics";

const columnContext: ColumnContext = {
  activeTab: "main",
  baseCurrency: "USD",
  exchangeRates: new Map([["USD", 1]]),
  now: Date.now(),
};

function ticker(symbol: string, exchange: string, name: string): TickerRecord {
  return {
    metadata: {
      ticker: symbol,
      exchange,
      currency: "USD",
      name,
      assetCategory: isCryptoMarketInstrument(symbol, exchange) ? "CRYPTO" : "STK",
      positions: [],
      portfolios: ["main"],
      watchlists: [],
      custom: {},
      tags: [],
    },
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 600));
}

describe("portfolio table crypto quotes", () => {
  afterEach(() => {
    setSharedMarketDataCoordinator(null);
  });

  test("fills LAST and CHG% for BTC-USD ETH-USD ZEC-USD on a mixed hosted book", async () => {
    const prices: Record<string, { price: number; changePercent: number }> = {
      HOOD: { price: 98.5, changePercent: 0.4 },
      "BTC-USD": { price: 111_000, changePercent: 1.8 },
      "ETH-USD": { price: 4_200, changePercent: -0.6 },
      "ZEC-USD": { price: 42.5, changePercent: 3.1 },
    };
    const yahooProvider: DataProvider = {
      ...fallbackProvider,
      id: "yahoo",
      async getQuote(symbol) {
        const row = prices[symbol]!;
        return makeQuote({ symbol, providerId: "yahoo", ...row });
      },
      async getQuotesBatch(targets) {
        return targets.map((target) => {
          const row = prices[target.symbol]!;
          return { target, quote: makeQuote({ symbol: target.symbol, providerId: "yahoo", ...row }) };
        });
      },
      subscribeQuotes(targets, onQuote) {
        for (const target of targets) {
          const row = prices[target.symbol]!;
          onQuote(target, makeQuote({ symbol: target.symbol, providerId: "yahoo", ...row }));
        }
        return () => {};
      },
    };
    const cloudProvider: DataProvider = {
      ...fallbackProvider,
      id: "gloomberb-cloud",
      priority: 100,
      async getQuote() {
        throw new Error("Cloud unavailable");
      },
      async getQuotesBatch() {
        throw new Error("Cloud unavailable");
      },
      subscribeQuotes() {
        return () => {};
      },
    };

    const router = new AssetDataRouter(yahooProvider, [cloudProvider]);
    const coordinator = new MarketDataCoordinator(router);
    setSharedMarketDataCoordinator(coordinator);

    const rows = [
      ticker("HOOD", "NASDAQ", "Robinhood"),
      ticker("BTC-USD", "CCC", "Bitcoin USD"),
      ticker("ETH-USD", "CCC", "Ethereum USD"),
      ticker("ZEC-USD", "CCC", "Zcash USD"),
    ];
    coordinator.subscribeQuotes(rows.map((row) => ({
      instrument: { symbol: row.metadata.ticker, exchange: row.metadata.exchange },
      priority: { surface: "portfolio", visible: true, weight: 80 },
    })));
    await flush();

    for (const row of rows) {
      const financials = coordinator.getTickerFinancialsSync({
        symbol: row.metadata.ticker,
        exchange: row.metadata.exchange,
      });
      const last = getColumnValue({ id: "price", label: "LAST", width: 10, align: "right" }, row, financials ?? undefined, columnContext);
      const chg = getColumnValue({ id: "change_pct", label: "CHG%", width: 8, align: "right" }, row, financials ?? undefined, columnContext);
      expect(last.text).not.toBe("—");
      expect(chg.text).not.toBe("—");
      expect(financials?.quote?.price).toBe(prices[row.metadata.ticker]!.price);
      expect(financials?.quote?.changePercent).toBe(prices[row.metadata.ticker]!.changePercent);
      expect(financials?.quote?.providerId).toBe("yahoo");
    }
  });
});
