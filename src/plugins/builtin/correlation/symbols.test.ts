import { describe, expect, test } from "bun:test";
import { displaySymbol } from "./matrix/model";
import { getCorrelationPaneSettings } from "./settings";
import {
  buildCorrelationChartSpec,
  canonicalizeCorrelationSymbol,
  isCorrelationPredictionSeries,
  parseCorrelationSymbolsInput,
} from "./symbols";

describe("parseCorrelationSymbolsInput", () => {
  test("accepts mixed equity and prediction-market series without uppercasing POLY ids", () => {
    expect(parseCorrelationSymbolsInput(
      " aapl, POLY:fed-cut-september, KALSHI:kxpresperson, ADJ:Red, PM:polymarket:will-fed-cut ",
    )).toEqual([
      "AAPL",
      "POLY:fed-cut-september",
      "KALSHI:KXPRESPERSON",
      "ADJ:red",
      "POLY:will-fed-cut",
    ]);
  });

  test("deduplicates equity tickers case-insensitively and keeps series order", () => {
    expect(parseCorrelationSymbolsInput("msft, AAPL, msft, POLY:fed-cut")).toEqual([
      "MSFT",
      "AAPL",
      "POLY:fed-cut",
    ]);
  });

  test("rejects empty lists and lists beyond the maximum size", () => {
    expect(() => parseCorrelationSymbolsInput(" , \n ")).toThrow("Enter at least one ticker or prediction-market series.");
    expect(() => parseCorrelationSymbolsInput("A,B,C,D,E,F,G,H,I,J,K", 10))
      .toThrow("You can compare up to 10 series.");
  });

  test("rejects chart series that are not tickers or prediction markets", () => {
    expect(() => parseCorrelationSymbolsInput("AAPL, FRED:CPIAUCSL"))
      .toThrow(/POLY:|KALSHI:|ADJ:/);
  });
});

describe("canonicalizeCorrelationSymbol", () => {
  test("maps PM prefixes onto chart-composer expressions", () => {
    expect(canonicalizeCorrelationSymbol("poly:fed-cut-september")).toBe("POLY:fed-cut-september");
    expect(canonicalizeCorrelationSymbol("kalshi:kxpresperson")).toBe("KALSHI:KXPRESPERSON");
    expect(canonicalizeCorrelationSymbol("adj:Red")).toBe("ADJ:red");
    expect(canonicalizeCorrelationSymbol("AAPL:price")).toBe("AAPL");
  });
});

describe("isCorrelationPredictionSeries", () => {
  test("detects POLY, KALSHI, and Adjacent matrix members", () => {
    expect(isCorrelationPredictionSeries("POLY:fed-cut-september")).toBe(true);
    expect(isCorrelationPredictionSeries("KALSHI:KXPRESPERSON")).toBe(true);
    expect(isCorrelationPredictionSeries("ADJ:red")).toBe(true);
    expect(isCorrelationPredictionSeries("AAPL")).toBe(false);
  });
});

describe("buildCorrelationChartSpec", () => {
  test("resolves mixed CORR members onto daily chart-composer series", () => {
    const spec = buildCorrelationChartSpec(
      ["AAPL", "POLY:fed-cut-september", "KALSHI:KXPRESPERSON", "ADJ:red"],
      "1Y",
    );
    expect(spec.viewport).toEqual({ range: "1Y", resolution: "1d" });
    expect(spec.series.map((series) => series.source.kind)).toEqual([
      "security",
      "prediction-market",
      "prediction-market",
      "adjacent-index",
    ]);
    expect(spec.series[1]).toMatchObject({
      source: { kind: "prediction-market", venue: "polymarket", marketId: "fed-cut-september" },
    });
    expect(spec.series[2]).toMatchObject({
      source: { kind: "prediction-market", venue: "kalshi", marketId: "KXPRESPERSON" },
    });
    expect(spec.series[3]).toMatchObject({
      source: { kind: "adjacent-index", indexId: "red" },
    });
  });
});

describe("getCorrelationPaneSettings", () => {
  test("keeps prediction-market series from symbolsText", () => {
    const settings = getCorrelationPaneSettings({
      symbolsText: "AAPL, POLY:fed-cut-september, ADJ:red",
    });
    expect(settings.symbolsError).toBeNull();
    expect(settings.symbols).toEqual(["AAPL", "POLY:fed-cut-september", "ADJ:red"]);
  });
});

describe("displaySymbol", () => {
  test("labels PM matrix members by market or index id", () => {
    expect(displaySymbol("AAPL")).toBe("AAPL");
    expect(displaySymbol("POLY:fed-cut-september")).toBe("fed-cut-");
    expect(displaySymbol("KALSHI:KXPRESPERSON")).toBe("KXPRESPE");
    expect(displaySymbol("ADJ:red")).toBe("RED");
  });
});
