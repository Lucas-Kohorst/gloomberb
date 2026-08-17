import { describe, expect, test } from "bun:test";
import { completeExpression, splitCurrentLeg } from "./series-suggestions";
import { buildChartSeriesAssistContext, formatParsedSeriesExpression } from "../../../../plugins/builtin/chart-composer/series-catalog";

describe("chart series command-bar autocomplete", () => {
  test("treats the whole input as the current leg with no separator", () => {
    expect(splitCurrentLeg("AAPL")).toEqual({ prefix: "", leg: "AAPL" });
    expect(splitCurrentLeg("AAPL:price")).toEqual({ prefix: "", leg: "AAPL:price" });
  });

  test("splits a multi-series list on the last comma", () => {
    expect(splitCurrentLeg("AAPL:price, MSFT")).toEqual({ prefix: "AAPL:price,", leg: " MSFT" });
  });

  test("splits a ratio on the slash", () => {
    expect(splitCurrentLeg("AAPL:price / MSFT")).toEqual({ prefix: "AAPL:price /", leg: " MSFT" });
  });

  test("splits a spread on the whitespace-dash-whitespace, not a bare dash", () => {
    expect(splitCurrentLeg("AAPL:price - MSFT")).toEqual({ prefix: "AAPL:price - ", leg: "MSFT" });
    // A dash inside a token (e.g. a series id) must not split.
    expect(splitCurrentLeg("FRED:WALCL")).toEqual({ prefix: "", leg: "FRED:WALCL" });
  });

  test("completes a leg by replacing the in-progress text", () => {
    expect(completeExpression("", "MSFT:price")).toBe("MSFT:price");
    expect(completeExpression("AAPL:price,", "MSFT:price")).toBe("AAPL:price, MSFT:price");
    expect(completeExpression("AAPL:price /", "MSFT:price")).toBe("AAPL:price / MSFT:price");
    expect(completeExpression("AAPL:price - ", "MSFT:price")).toBe("AAPL:price - MSFT:price");
  });

  test("formats parsed expressions back into command-bar text", () => {
    expect(formatParsedSeriesExpression({ kind: "economic", provider: "fred", seriesId: "CPIAUCSL" }))
      .toBe("FRED:CPIAUCSL");
    expect(formatParsedSeriesExpression({ kind: "security", symbol: "AAPL", fieldId: "fundamental.totalRevenue" }))
      .toBe("AAPL:fundamental.totalRevenue");
    expect(formatParsedSeriesExpression({ kind: "security", symbol: "AAPL", exchange: "NASDAQ", fieldId: "market.ohlcv" }))
      .toBe("AAPL:XNAS:market.ohlcv");
  });

  test("builds an AI assist context naming chart fields and syntax", () => {
    const ctx = buildChartSeriesAssistContext();
    expect(ctx).toContain("revenue");
    expect(ctx).toContain("eps");
    expect(ctx).toContain("FRED:seriesId");
    expect(ctx).toContain("KALSHI:ticker");
    expect(ctx).toContain("A / B");
  });
});
