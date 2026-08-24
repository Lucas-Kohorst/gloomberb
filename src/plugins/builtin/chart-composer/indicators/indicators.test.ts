import { describe, expect, test } from "bun:test";
import {
  INDICATORS,
  INDICATOR_REGISTRY,
  getIndicator,
  emaArray,
  smaArray,
  wilderSmooth,
  type OHLCV,
} from "./index";
import { sma } from "./sma";
import { ema } from "./ema";
import { rsi } from "./rsi";
import { macd } from "./macd";
import { bollinger } from "./bollinger";
import { vwap } from "./vwap";
import { atr } from "./atr";
import { stochastic } from "./stochastic";
import { adx } from "./adx";

/** Build OHLCV bars from close prices (high/low/close = close, volume 0). */
function closesBars(closes: number[]): OHLCV[] {
  return closes.map((close, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 1)),
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
}

function candleBars(rows: Array<{ h: number; l: number; c: number; v?: number }>): OHLCV[] {
  return rows.map((row, i) => ({
    date: new Date(Date.UTC(2024, 0, i + 1)),
    open: row.c,
    high: row.h,
    low: row.l,
    close: row.c,
    volume: row.v ?? 0,
  }));
}

/** Strip leading nulls and return the numeric values for assertion. */
function definedValues(series: { values: (number | null)[] }): number[] {
  return series.values.filter((value): value is number => value !== null);
}

describe("indicator shared helpers", () => {
  test("smaArray is null until period and averages the trailing window", () => {
    expect(smaArray([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  test("emaArray seeds from the first period SMA then recurses", () => {
    expect(emaArray([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  test("wilderSmooth seeds on the first period values then smooths", () => {
    // gains of 1 each: seed (1+1)/2 = 1 at index 2, then stays 1.
    const values = [NaN, 1, 1, 1, 1];
    expect(wilderSmooth(values, 2, 1)).toEqual([null, null, 1, 1, 1]);
  });
});

describe("SMA", () => {
  test("simple moving average over close", () => {
    const out = sma(closesBars([1, 2, 3, 4, 5]), { period: 3 });
    expect(out.sma.values).toEqual([null, null, 2, 3, 4]);
    expect(out.sma.timestamps).toHaveLength(5);
  });
});

describe("EMA", () => {
  test("exponential moving average over close", () => {
    const out = ema(closesBars([1, 2, 3, 4, 5]), { period: 3 });
    expect(out.ema.values).toEqual([null, null, 2, 3, 4]);
  });
});

describe("RSI", () => {
  test("all gains produce RSI 100", () => {
    const out = rsi(closesBars([1, 2, 3, 4, 5]), { period: 2 });
    expect(out.rsi.values).toEqual([null, null, 100, 100, 100]);
  });

  test("all losses produce RSI 0", () => {
    const out = rsi(closesBars([5, 4, 3, 2, 1]), { period: 2 });
    expect(out.rsi.values).toEqual([null, null, 0, 0, 0]);
  });

  test("alternating series produces known RSI values", () => {
    const out = rsi(closesBars([1, 2, 1, 2, 1, 2]), { period: 2 });
    const values = out.rsi.values;
    expect(values.slice(0, 2)).toEqual([null, null]);
    expect(values[2]).toBeCloseTo(50, 10);
    expect(values[3]).toBeCloseTo(75, 10);
    expect(values[4]).toBeCloseTo(37.5, 10);
    expect(values[5]).toBeCloseTo(68.75, 10);
  });
});

describe("MACD", () => {
  test("linear series yields a constant MACD line with a lagged signal", () => {
    // closes slope 2 → EMA(3) and EMA(4) both linear, MACD line constant 1.
    const out = macd(closesBars([2, 4, 6, 8, 10, 12]), { fast: 3, slow: 4, signal: 2 });
    expect(out.macd.values).toEqual([null, null, null, 1, 1, 1]);
    expect(out.signal.values).toEqual([null, null, null, null, 1, 1]);
    expect(out.histogram.values).toEqual([null, null, null, null, 0, 0]);
  });

  test("produces macd, signal, and histogram outputs", () => {
    expect(Object.keys(macd(closesBars([1, 2, 3, 4, 5, 6, 7]), {}))).toEqual([
      "macd",
      "signal",
      "histogram",
    ]);
  });
});

describe("Bollinger Bands", () => {
  test("middle is the SMA and bands are stdDev away", () => {
    const out = bollinger(closesBars([1, 2, 3, 4, 5]), { period: 3, stdDev: 2 });
    expect(out.middle.values).toEqual([null, null, 2, 3, 4]);
    const dev = 2 * Math.sqrt(2 / 3);
    expect(out.upper.values[2]).toBeCloseTo(2 + dev, 10);
    expect(out.lower.values[2]).toBeCloseTo(2 - dev, 10);
    expect(out.upper.values[4]).toBeCloseTo(4 + dev, 10);
    expect(out.lower.values[4]).toBeCloseTo(4 - dev, 10);
  });
});

describe("VWAP", () => {
  test("cumulative within a session, resetting across days", () => {
    const bars = candleBars([
      { h: 3, l: 1, c: 2, v: 100 },
      { h: 4, l: 2, c: 3, v: 100 },
      { h: 5, l: 3, c: 4, v: 100 },
      { h: 6, l: 4, c: 5, v: 200 },
    ]);
    // First three bars share a session; the fourth starts a new UTC day.
    const day1 = new Date(Date.UTC(2024, 0, 1));
    bars[0]!.date = day1;
    bars[1]!.date = day1;
    bars[2]!.date = day1;
    bars[3]!.date = new Date(Date.UTC(2024, 0, 2));
    const out = vwap(bars, {});
    expect(out.vwap.values).toEqual([2, 2.5, 3, 5]);
  });

  test("missing volume yields null", () => {
    const bars = candleBars([{ h: 3, l: 1, c: 2 }, { h: 4, l: 2, c: 3 }]);
    const out = vwap(bars, {});
    expect(out.vwap.values).toEqual([null, null]);
  });
});

describe("ATR", () => {
  test("Wilder average true range over hand-computed bars", () => {
    const bars = candleBars([
      { h: 12, l: 10, c: 11 },
      { h: 15, l: 11, c: 13 },
      { h: 14, l: 9, c: 10 },
      { h: 16, l: 12, c: 14 },
      { h: 13, l: 11, c: 12 },
    ]);
    const out = atr(bars, { period: 3 });
    expect(out.atr.values.slice(0, 3)).toEqual([null, null, null]);
    expect(out.atr.values[3]).toBeCloseTo(5, 10);
    expect(out.atr.values[4]).toBeCloseTo(13 / 3, 10);
  });
});

describe("Stochastic", () => {
  test("%K tracks the close position and %D smooths it", () => {
    const bars = candleBars([
      { h: 5, l: 1, c: 3 },
      { h: 6, l: 2, c: 4 },
      { h: 7, l: 3, c: 7 },
      { h: 8, l: 4, c: 4 },
      { h: 9, l: 5, c: 9 },
    ]);
    const out = stochastic(bars, { period: 3, smooth: 2 });
    expect(out.k.values.slice(0, 2)).toEqual([null, null]);
    expect(out.k.values[2]).toBeCloseTo(100, 10);
    expect(out.k.values[3]).toBeCloseTo(100 / 3, 10);
    expect(out.k.values[4]).toBeCloseTo(100, 10);
    // %D is the 2-bar SMA of %K starting one bar later.
    expect(out.d.values[3]).toBeCloseTo((100 + 100 / 3) / 2, 10);
    expect(out.d.values[4]).toBeCloseTo((100 / 3 + 100) / 2, 10);
  });
});

describe("ADX", () => {
  test("strong uptrend drives ADX to 100 with +DI only", () => {
    const bars = candleBars([
      { h: 10, l: 5, c: 8 },
      { h: 12, l: 6, c: 10 },
      { h: 14, l: 7, c: 12 },
      { h: 16, l: 8, c: 14 },
      { h: 18, l: 9, c: 16 },
      { h: 20, l: 10, c: 18 },
    ]);
    const out = adx(bars, { period: 3 });
    expect(definedValues(out.minusDI)).toEqual([0, 0, 0]);
    expect(out.plusDI.values.slice(0, 3)).toEqual([null, null, null]);
    expect(out.plusDI.values[3]).toBeCloseTo((200 / 7), 6);
    expect(out.adx.values.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(out.adx.values[5]).toBeCloseTo(100, 10);
  });
});

describe("indicator registry and expression builder", () => {
  test("registry contains all nine indicators with stable ids", () => {
    expect(INDICATORS.map((definition) => definition.id)).toEqual([
      "sma", "ema", "rsi", "macd", "bollinger", "vwap", "atr", "stochastic", "adx",
    ]);
    for (const definition of INDICATORS) {
      expect(INDICATOR_REGISTRY[definition.id]).toBe(definition);
    }
  });

  test("getIndicator is case-insensitive", () => {
    expect(getIndicator("SMA")?.id).toBe("sma");
    expect(getIndicator("Bollinger")?.id).toBe("bollinger");
    expect(getIndicator("missing")).toBeUndefined();
  });

  test("each indicator applies via the registry and returns its declared outputs", () => {
    for (const definition of INDICATORS) {
      const out = definition.apply(closesBars([1, 2, 3, 4, 5, 6, 7, 8]), definition.defaultParams);
      expect(Object.keys(out).sort()).toEqual([...definition.outputs].sort());
      for (const series of Object.values(out)) {
        expect(series.timestamps).toHaveLength(8);
        expect(series.values).toHaveLength(8);
      }
    }
  });

});
