import { describe, expect, test } from "bun:test";
import { completeExpression, splitCurrentLeg } from "./series-suggestions";
import {
  buildChartSeriesAssistContext,
  buildSeriesCatalogSuggestions,
  formatParsedSeriesExpression,
  looksLikeCatalogSeriesQuery,
} from "../../../../plugins/builtin/chart-composer/series-catalog";
import {
  localCatalogSuggestions,
  shouldSearchRegisteredCatalogs,
} from "../../../../plugins/builtin/chart-composer/catalog-providers";
import { defillamaSeriesCatalog } from "../../../../plugins/builtin/defillama/catalog";
import { fredSeriesCatalog } from "../../../../plugins/builtin/econ/fred-series-map";
import { owidSeriesCatalog } from "../../../../plugins/builtin/owid/catalog";
import { llmStatsSeriesCatalog } from "../../../../plugins/builtin/llm-stats/metrics";

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
    const ctx = buildChartSeriesAssistContext([defillamaSeriesCatalog, fredSeriesCatalog]);
    expect(ctx).toContain("revenue");
    expect(ctx).toContain("eps");
    expect(ctx).toContain("FRED:seriesId");
    expect(ctx).toContain("KALSHI:ticker");
    expect(ctx).toContain("BTC-USD:price");
    expect(ctx).toContain("CAT <query>");
    expect(ctx).toContain("A / B");
    expect(ctx).toContain("aave fees");
  });

  test("source catalogs expose chart rows for ordinary data queries", () => {
    const catalogs = [fredSeriesCatalog, defillamaSeriesCatalog, owidSeriesCatalog, llmStatsSeriesCatalog];
    const suggestions = localCatalogSuggestions("cpi", catalogs, 12);
    expect(suggestions.some((entry) => (
      entry.expression.kind === "economic"
      && entry.expression.seriesId === "CPIAUCSL"
    ))).toBe(true);
    expect(localCatalogSuggestions("oil inventories", catalogs)).not.toHaveLength(0);
    expect(localCatalogSuggestions("aave fees", catalogs)[0]?.expression).toMatchObject({
      kind: "capability", capabilityId: "defillama", seriesId: "protocol/aave/fees",
    });
    expect(localCatalogSuggestions("life expectancy", catalogs)[0]?.expression).toMatchObject({
      kind: "owid", slug: "life-expectancy",
    });
    expect(localCatalogSuggestions("OpenAI throughput", catalogs)[0]?.expression).toMatchObject({
      kind: "benchmark", selector: "OpenAI", metric: "tps",
    });
    expect(looksLikeCatalogSeriesQuery("cpi fred")).toBe(true);
    expect(looksLikeCatalogSeriesQuery("AAPL revenue")).toBe(false);
    expect(looksLikeCatalogSeriesQuery("atlanta temp")).toBe(true);
    expect(looksLikeCatalogSeriesQuery("alanta temp")).toBe(true);
  });

  test("remote-only catalogs can opt an otherwise unknown query into discovery", () => {
    const remote = {
      id: "astronomy",
      minQueryLength: 4,
      shouldSearch: (query: string) => query.includes("saturn"),
      search: async () => [],
    };
    expect(shouldSearchRegisteredCatalogs("saturn rings", [remote])).toBe(true);
    expect(shouldSearchRegisteredCatalogs("mars", [remote])).toBe(false);
    expect(shouldSearchRegisteredCatalogs("sun", [{ ...remote, shouldSearch: undefined }])).toBe(false);
  });

  test("ranks Atlanta temperature series for a city + temp query", () => {
    const aapl = { symbol: "AAPL", exchange: "NASDAQ", name: "Apple Inc." };
    const suggestions = buildSeriesCatalogSuggestions("atlanta temp", aapl, [], 12);
    expect(suggestions.some((entry) => (
      entry.expression.kind === "weather"
      && entry.expression.stationId === "ATL"
    ))).toBe(true);
  });
});
