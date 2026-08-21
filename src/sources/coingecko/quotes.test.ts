import { describe, expect, test } from "bun:test";
import { mapCoinGeckoSimpleQuote, mapCoinGeckoCoinQuote } from "./quotes";

describe("CoinGecko quote adapter", () => {
  test("maps LAST, CHG%, and MCAP from simple/price", () => {
    const quote = mapCoinGeckoSimpleQuote({
      symbol: "BTC-USD",
      vsCurrency: "usd",
      now: 1_700_000_000_000,
      price: {
        usd: 100_000,
        usd_market_cap: 2_000_000_000_000,
        usd_24h_vol: 40_000_000_000,
        usd_24h_change: 10,
        last_updated_at: 1_700_000_000,
      },
    });

    expect(quote).toMatchObject({
      symbol: "BTC-USD",
      providerId: "coingecko",
      price: 100_000,
      changePercent: 10,
      marketCap: 2_000_000_000_000,
      volume: 40_000_000_000,
      currency: "USD",
      exchangeName: "CCC",
      listingExchangeName: "CCC",
      marketState: "REGULAR",
      dataSource: "delayed",
    });
    expect(quote.previousClose).toBeCloseTo(90_909.0909, 3);
    expect(quote.change).toBeCloseTo(9_090.909, 3);
  });

  test("maps coin market_data into a DES quote", () => {
    const quote = mapCoinGeckoCoinQuote({
      symbol: "ETH-USD",
      vsCurrency: "usd",
      coin: {
        name: "Ethereum",
        market_data: {
          current_price: { usd: 3_500 },
          price_change_24h_in_currency: { usd: 50 },
          price_change_percentage_24h: 1.45,
          market_cap: { usd: 420_000_000_000 },
          total_volume: { usd: 20_000_000_000 },
          high_24h: { usd: 3_560 },
          low_24h: { usd: 3_410 },
        },
      },
    });

    expect(quote).toMatchObject({
      symbol: "ETH-USD",
      name: "Ethereum",
      price: 3_500,
      change: 50,
      changePercent: 1.45,
      marketCap: 420_000_000_000,
      high: 3_560,
      low: 3_410,
      providerId: "coingecko",
    });
  });
});
