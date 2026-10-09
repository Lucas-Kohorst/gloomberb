import { describe, expect, test } from "bun:test";
import { createPaneInstance } from "../../../types/config";
import type { ChartSpec } from "../../../time-series/types";
import { createTestTemplateContext } from "../../../test-support/headless";
import { getSelectedBuiltinStudies, getSelectedPairStudies } from "./studies";
import { chartComposerModule } from "./index";
import { CHART_SPEC_SETTING_KEY } from "./chart-spec";
import {
  buildComparisonChartPreset,
  buildCustomChartPreset,
  buildFundamentalChartPreset,
  buildIntradayPriceChartPreset,
  buildPriceChartPreset,
  buildValuationChartPreset,
} from "./presets";

describe("chart composer presets", () => {
  test("keeps shortcut presets semantically distinct", () => {
    const intraday = buildIntradayPriceChartPreset("aapl");
    expect(intraday.viewport).toEqual({ range: "1D", resolution: "1m" });
    expect(intraday.series[0]).toMatchObject({ style: "candles", transform: "raw" });
    expect(getSelectedBuiltinStudies(intraday)).toEqual(["volume"]);

    const comparison = buildComparisonChartPreset(["aapl", "msft"]);
    expect(comparison.series.map((series) => ({ style: series.style, transform: series.transform }))).toEqual([
      { style: "line", transform: "percent" },
      { style: "line", transform: "percent" },
    ]);

    const fundamental = buildFundamentalChartPreset(["aapl"]);
    expect(fundamental.series[0]).toMatchObject({
      style: "columns",
      interpolation: "none",
      source: { fieldId: "fundamental.totalRevenue", timestampMode: "period-end" },
    });
  });

  test("includes volume in fresh price and followed-ticker defaults", () => {
    const price = buildPriceChartPreset("AAPL");
    const followed = buildCustomChartPreset("", "AAPL");

    expect(getSelectedBuiltinStudies(price)).toEqual(["volume"]);
    expect(price.panels.find((panel) => panel.id === "volume")).toMatchObject({
      label: "Volume",
      height: 0.24,
    });
    expect(followed).toEqual(price);
  });

  // GF and GE stay out of list linking even for one ticker; only price charts of one security follow.
  test("only a price chart of one security can follow a list", () => {
    const follower = chartComposerModule.panes![0]!.tickerFollower as (pane: ReturnType<typeof createPaneInstance>) => boolean;
    const canFollow = (spec: ChartSpec) => follower(createPaneInstance("chart-composer", {
      binding: { kind: "fixed", symbol: "AAPL" },
      settings: { [CHART_SPEC_SETTING_KEY]: spec },
    }));
    expect(canFollow(buildPriceChartPreset("AAPL"))).toBe(true);
    expect(canFollow(buildIntradayPriceChartPreset("AAPL"))).toBe(true);
    expect(canFollow(buildCustomChartPreset("AAPL, AAPL:volume"))).toBe(true);
    expect(canFollow(buildFundamentalChartPreset(["AAPL"]))).toBe(false);
    expect(canFollow(buildValuationChartPreset(["AAPL"]))).toBe(false);
    expect(canFollow(buildCustomChartPreset("AAPL, AAPL:revenue"))).toBe(false);
    expect(canFollow(buildComparisonChartPreset(["AAPL", "MSFT"]))).toBe(false);
  });

  test("a spaced slash or minus is a ratio or spread, and a slash inside one series is not", async () => {
    const ratio = buildCustomChartPreset("gaa / voo");
    expect(ratio.series.map((series) => series.source)).toEqual([
      expect.objectContaining({ kind: "security", instrument: { symbol: "GAA" }, fieldId: "market.ohlcv" }),
      expect.objectContaining({ kind: "security", instrument: { symbol: "VOO" }, fieldId: "market.ohlcv" }),
    ]);
    expect(ratio.studies).toEqual([
      expect.objectContaining({ id: "pair:ratio", kind: "ratio", panelId: "formula" }),
    ]);
    expect(getSelectedPairStudies(buildCustomChartPreset("CL=F - ES=F"))).toEqual(["spread"]);
    expect(buildCustomChartPreset("EUR/USD").series).toHaveLength(1);
    expect(getSelectedPairStudies(buildCustomChartPreset("EUR/USD"))).toEqual([]);
    expect(buildCustomChartPreset("AAPL:EV / EBITDA").series[0]?.source).toMatchObject({
      kind: "security",
      instrument: { symbol: "AAPL" },
      fieldId: "valuation.evEbitda",
    });
    expect(getSelectedPairStudies(buildCustomChartPreset("AAPL, MSFT"))).toEqual([]);

    const template = chartComposerModule.paneTemplates?.find((entry) => entry.shortcut?.prefix === "G");
    const instance = await template?.createInstance?.(createTestTemplateContext(), { arg: "gaa / voo" });
    expect(instance?.title).toBe("G GAA / VOO");
    expect(getSelectedPairStudies(instance?.settings?.[CHART_SPEC_SETTING_KEY] as ChartSpec)).toEqual(["ratio"]);
  });
});
