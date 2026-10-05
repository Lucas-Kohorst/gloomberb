import { describe, expect, test } from "bun:test";
import { contrastRatio } from "../../../theme/color-utils";
import {
  libraryChartChrome,
  libraryDataDefaults,
  libraryCustomThemes,
  libraryPriceScale,
} from "./charting-library-options";

const chromeInput = {
  backgroundColor: "#111111",
  upColor: "#00cc66",
  downColor: "#ff3333",
  lineColor: "#dddddd",
};

describe("charting library chrome", () => {
  test("keeps same-unit percent and weather linear, and rebases prices", () => {
    expect(libraryPriceScale(["currency/share", "currency/share"])).toBe("percentage");
    expect(libraryPriceScale(["%", "%"])).toBe("normal");
    expect(libraryPriceScale(["°F", "°F"])).toBe("normal");
    expect(libraryPriceScale(["°F", "in"])).toBe("percentage");
    expect(libraryPriceScale(["currency/share"])).toBe("normal");
    expect(libraryPriceScale([undefined, undefined])).toBe("normal");
  });

  test("turns on terminal chrome and keeps volume off non-price series", () => {
    const line = libraryChartChrome({ ...chromeInput, chartStyle: "line", interval: "D" });
    expect(line.disabled_features).toContain("create_volume_indicator_by_default");
    expect(line.disabled_features).toContain("symbol_search_hot_key");
    expect(line.disabled_features).toContain("volume_force_overlay");
    expect(line.disabled_features).toContain("pricescale_unit");
    expect(line.enabled_features).toContain("iframe_loading_same_origin");
    expect(line.enabled_features).toContain("side_toolbar_in_fullscreen_mode");
    expect(line.enabled_features).toContain("header_in_fullscreen_mode");
    expect(line.enabled_features).toContain("low_density_bars");
    expect(line.enabled_features).toContain("pre_post_market_sessions");
    expect(line.enabled_features).toContain("items_favoriting");
    expect(line.enabled_features).not.toContain("link_to_tradingview");
    expect(line.enabled_features).not.toContain("seconds_resolution");
    expect(line.enabled_features).not.toContain("fix_left_edge");
    expect(line.disabled_features).toContain("header_saveload");
    expect(line.disabled_features).toContain("show_right_widgets_panel_by_default");
    expect(line.overrides["mainSeriesProperties.showCountdown"]).toBe(false);
    expect(line.overrides["mainSeriesProperties.showPrevClosePriceLine"]).toBe(false);
    expect(line.overrides["mainSeriesProperties.highLowAvgPrice.highLowPriceLinesVisible"]).toBe(true);
    expect(line.overrides["mainSeriesProperties.highLowAvgPrice.highLowPriceLinesColor"]).toBe("#dddddd");
    expect(line.overrides["mainSeriesProperties.lineStyle.colorType"]).toBe("solid");
    expect(line.overrides["mainSeriesProperties.lineStyle.gradientStartColor"]).toBe("#dddddd");
    expect(line.overrides["mainSeriesProperties.lineStyle.gradientEndColor"]).toBe("#dddddd");
    expect(line.overrides["mainSeriesProperties.priceLineColor"]).toBe("#dddddd");
    expect(line.overrides["mainSeriesProperties.sessionId"]).toBe("extended");
    expect(line.overrides["backgrounds.preMarket.color"]).toBe("#dddddd");
    expect(line.overrides["backgrounds.preMarket.transparency"]).toBe(88);
    expect(line.overrides["backgrounds.preMarket.visible"]).toBe(true);
    expect(line.overrides["backgrounds.postMarket.color"]).toBe("#dddddd");
    expect(line.overrides["backgrounds.postMarket.visible"]).toBe(true);
    expect(line.favorites.chartTypes).toContain("Stepline");
    expect(line.favorites.chartTypes).toContain("Baseline");
    expect(line.favorites.indicators).toContain("Rate Of Change");
    expect(line.favorites.indicators).toContain("Average True Range");

    const candles = libraryChartChrome({ ...chromeInput, chartStyle: "candles", interval: "5", hasVolume: true });
    expect(candles.disabled_features).toContain("volume_force_overlay");
    expect(candles.disabled_features).not.toContain("create_volume_indicator_by_default");
    expect(candles.overrides["mainSeriesProperties.showCountdown"]).toBe(true);
    expect(candles.overrides["mainSeriesProperties.showPrevClosePriceLine"]).toBe(true);
    expect(candles.overrides["paneProperties.legendProperties.showVolume"]).toBe(true);
    expect(candles.overrides["mainSeriesProperties.candleStyle.upColor"]).toBe("#00cc66");
    expect(candles.overrides["mainSeriesProperties.priceLineColor"]).toBeUndefined();
  });

  test("paints line gradients and tooltips from the active theme accent", () => {
    const themes = libraryCustomThemes({
      backgroundColor: "#111111",
      text: "#dddddd",
      textBright: "#ffffff",
      textMuted: "#888888",
      accent: "#c4a35a",
      positive: "#00cc66",
      negative: "#ff3333",
      warning: "#e6a817",
    });
    const accent = themes.dark.color1;
    expect(Array.isArray(accent)).toBe(true);
    expect(accent).toHaveLength(19);
    expect(contrastRatio((accent as string[])[9] ?? "", "#ffffff")).toBeGreaterThanOrEqual(7);
    expect(themes.dark.color6).toEqual(accent);
    expect(themes.light.white).toBe("#111111");
    expect(themes.light.black).toBe("#dddddd");
    expect(themes.dark.white).toBe("#ffffff");
    expect(themes.dark.black).toBe("#111111");
  });

  test("darkens a white accent for the hint card and leaves the series stroke white", () => {
    const themes = libraryCustomThemes({
      backgroundColor: "#000000",
      text: "#cccccc",
      textBright: "#ffffff",
      textMuted: "#444444",
      accent: "#ffffff",
      positive: "#00cc66",
      negative: "#ff3333",
      warning: "#e6a817",
    });
    const fill = (themes.dark.color1 as string[])[9] ?? "";
    expect(fill).not.toBe("#ffffff");
    expect(contrastRatio(fill, "#ffffff")).toBeGreaterThanOrEqual(7);
    expect(themes.dark.white).toBe("#ffffff");
    const line = libraryChartChrome({
      ...chromeInput,
      chartStyle: "line",
      interval: "W",
      backgroundColor: "#000000",
      lineColor: "#ffffff",
    });
    expect(line.overrides["mainSeriesProperties.lineStyle.color"]).toBe("#ffffff");
    expect(line.overrides["mainSeriesProperties.priceLineColor"]).toBe("#ffffff");
  });


});

test("OHLC defaults require real prices and volume requires a positive finite observation", () => {
  expect(libraryDataDefaults([{ close: 10, volume: 0 }])).toEqual({ chartStyle: "line", hasVolume: false });
  expect(libraryDataDefaults([{ open: 9, high: 11, low: 8, close: 10, volume: NaN }])).toEqual({ chartStyle: "heikinashi", hasVolume: false });
  const defaults = libraryDataDefaults([{ open: 9, high: 11, low: 8, close: 10, volume: 100 }]);
  const chrome = libraryChartChrome({ ...chromeInput, ...defaults, interval: "240" });
  expect(defaults.hasVolume).toBe(true);
  expect(chrome.overrides["mainSeriesProperties.style"]).toBe(8);
  // TradingView uses 15 for Stepline; 9 is Hollow Candles.
  expect(libraryChartChrome({ ...chromeInput, chartStyle: "step" }).overrides["mainSeriesProperties.style"]).toBe(15);
  expect(chrome.disabled_features).toContain("volume_force_overlay");
  expect(chrome.disabled_features).not.toContain("create_volume_indicator_by_default");
  expect(libraryChartChrome({ ...chromeInput, chartStyle: "heikinashi", interval: "240" }).disabled_features).toContain("create_volume_indicator_by_default");
});
