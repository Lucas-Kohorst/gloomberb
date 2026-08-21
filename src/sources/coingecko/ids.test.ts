import { describe, expect, test } from "bun:test";
import {
  isCryptoMarketInstrument,
  parseCryptoPair,
  resolveCoinGeckoPair,
} from "./ids";

describe("CoinGecko pair mapping", () => {
  test("maps common hyphen, slash, and compact pairs onto CoinGecko ids", () => {
    expect(resolveCoinGeckoPair("BTC-USD")).toEqual({
      id: "bitcoin",
      base: "BTC",
      vsCurrency: "usd",
      symbol: "BTC-USD",
    });
    expect(resolveCoinGeckoPair("ETH/USD")).toMatchObject({ id: "ethereum", symbol: "ETH-USD" });
    expect(resolveCoinGeckoPair("SOLUSD")).toMatchObject({ id: "solana", symbol: "SOL-USD" });
    expect(resolveCoinGeckoPair("ETHUSDT")).toMatchObject({ id: "ethereum", vsCurrency: "usdt", symbol: "ETH-USDT" });
    expect(resolveCoinGeckoPair("ZEC-USD")).toMatchObject({ id: "zcash" });
  });

  test("maps a bare CCC ticker onto the USD pair", () => {
    expect(resolveCoinGeckoPair("BTC", "CCC")).toEqual({
      id: "bitcoin",
      base: "BTC",
      vsCurrency: "usd",
      symbol: "BTC-USD",
    });
  });

  test("does not treat equities as crypto", () => {
    expect(isCryptoMarketInstrument("AAPL", "NASDAQ")).toBe(false);
    expect(resolveCoinGeckoPair("AAPL", "NASDAQ")).toBeNull();
    expect(parseCryptoPair("AAPL")).toBeNull();
    expect(isCryptoMarketInstrument("COIN", "NASDAQ")).toBe(false);
  });

  test("recognizes unmapped hyphenated USD pairs as crypto instruments", () => {
    expect(isCryptoMarketInstrument("FOO-USD")).toBe(true);
    expect(resolveCoinGeckoPair("FOO-USD")).toBeNull();
  });
});
