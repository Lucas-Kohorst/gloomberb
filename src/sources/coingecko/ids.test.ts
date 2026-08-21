import { describe, expect, test } from "bun:test";
import {
  canonicalCryptoInstrument,
  isCryptoMarketInstrument,
  parseCryptoPair,
  resolveCoinGeckoPair,
} from "./ids";

describe("CoinGecko pair mapping", () => {
  test("maps hyphen, slash, compact, and Yahoo =X pairs onto CoinGecko ids", () => {
    expect(resolveCoinGeckoPair("BTC-USD")).toEqual({
      id: "bitcoin",
      base: "BTC",
      vsCurrency: "usd",
      symbol: "BTC-USD",
    });
    expect(resolveCoinGeckoPair("ETH/USD")).toMatchObject({ id: "ethereum", symbol: "ETH-USD" });
    expect(resolveCoinGeckoPair("SOL/USD")).toMatchObject({ id: "solana", symbol: "SOL-USD" });
    expect(resolveCoinGeckoPair("ZEC/USD")).toMatchObject({ id: "zcash", symbol: "ZEC-USD" });
    expect(resolveCoinGeckoPair("SOLUSD")).toMatchObject({ id: "solana", symbol: "SOL-USD" });
    expect(resolveCoinGeckoPair("SOLUSD=X")).toMatchObject({ id: "solana", symbol: "SOL-USD" });
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

  test("canonicalizes screenshot ticker forms onto BTC-USD / CCC", () => {
    expect(canonicalCryptoInstrument("BTC-USD")).toEqual({ symbol: "BTC-USD", exchange: "CCC" });
    expect(canonicalCryptoInstrument("SOL/USD")).toEqual({ symbol: "SOL-USD", exchange: "CCC" });
    expect(canonicalCryptoInstrument("ZEC/USD", "CCY")).toEqual({ symbol: "ZEC-USD", exchange: "CCC" });
    expect(canonicalCryptoInstrument("BTC", "CCC")).toEqual({ symbol: "BTC-USD", exchange: "CCC" });
    expect(canonicalCryptoInstrument("BTCUSD")).toEqual({ symbol: "BTC-USD", exchange: "CCC" });
  });

  test("does not treat equities or fiat FX as crypto", () => {
    expect(isCryptoMarketInstrument("AAPL", "NASDAQ")).toBe(false);
    expect(resolveCoinGeckoPair("AAPL", "NASDAQ")).toBeNull();
    expect(parseCryptoPair("AAPL")).toBeNull();
    expect(isCryptoMarketInstrument("COIN", "NASDAQ")).toBe(false);
    expect(canonicalCryptoInstrument("EURUSD=X")).toBeNull();
    expect(parseCryptoPair("EURUSD=X")).toBeNull();
  });

  test("recognizes unmapped hyphenated USD pairs as crypto instruments", () => {
    expect(isCryptoMarketInstrument("FOO-USD")).toBe(true);
    expect(resolveCoinGeckoPair("FOO-USD")).toBeNull();
    expect(canonicalCryptoInstrument("FOO-USD")).toEqual({ symbol: "FOO-USD", exchange: "CCC" });
  });

  test("treats slash and compact pairs as crypto even without a CCC exchange", () => {
    expect(isCryptoMarketInstrument("SOL/USD")).toBe(true);
    expect(isCryptoMarketInstrument("ZEC/USD", "CCY")).toBe(true);
    expect(isCryptoMarketInstrument("BTCUSD=X")).toBe(true);
  });
});
