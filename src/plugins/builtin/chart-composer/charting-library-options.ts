import { blendForContrast } from "../../../theme/color-utils";

export type LibraryPriceScale = "normal" | "percentage";

const PERCENT_SCALE_MODE = 2;

export function libraryPercentScaleMode(): number {
  return PERCENT_SCALE_MODE;
}

const SAME_AXIS_UNITS = new Set(["%", "percent", "°F", "in"]);

export function libraryPriceScale(units: readonly (string | undefined)[]): LibraryPriceScale {
  if (units.length < 2) return "normal";
  const normalized = units.map((unit) => unit?.trim() ?? "");
  const present = normalized.filter((unit) => unit !== "");
  if (present.length === 0) return "normal";
  const first = present[0]!;
  const same = present.every((unit) => unit === first);
  if (same && SAME_AXIS_UNITS.has(first)) return "normal";
  return "percentage";
}

const AXIS_UNITS = new Set(["%", "°F", "in"]);

export function libraryAxisUnit(unit: string | undefined): string | undefined {
  return unit && AXIS_UNITS.has(unit) ? unit : undefined;
}

export function libraryFeedUnits(): {
  units: Record<string, Array<{ id: string; name: string; description: string }>>;
} {
  return {
    units: {
      percent: [{ id: "%", name: "%", description: "Percent" }],
      temperature: [{ id: "°F", name: "°F", description: "Fahrenheit" }],
      precipitation: [{ id: "in", name: "in", description: "Inches" }],
    },
  };
}

export interface LibraryChartChromeInput {
  chartStyle: "candles" | "heikinashi" | "line" | "step";
  hasVolume?: boolean;
  interval: string;
  backgroundColor: string;
  upColor: string;
  downColor: string;
  lineColor: string;
}

function intraday(interval: string): boolean {
  return /^\d+$/.test(interval);
}

function mixHex(from: string, toward: string, amount: number): string {
  const channels = (hex: string): number[] | null => {
    const normalized = hex.trim().replace("#", "");
    if (normalized.length < 6) return null;
    const parsed = [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16));
    return parsed.every((channel) => Number.isFinite(channel)) ? parsed : null;
  };
  const start = channels(from);
  const end = channels(toward);
  if (!start || !end) return from;
  const mixed = start.map((channel, index) => Math.round(channel + ((end[index] ?? channel) - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function backgroundColorLooksLight(backgroundColor: string): boolean {
  const hex = backgroundColor.replace("#", "");
  if (hex.length < 6) return false;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) return false;
  return (r * 299 + g * 587 + b * 114) / 1000 >= 160;
}

export function libraryChartChrome(input: LibraryChartChromeInput): {
  enabled_features: string[];
  disabled_features: string[];
  favorites: { intervals: string[]; chartTypes: string[]; indicators: string[] };
  time_frames: Array<{ text: string; resolution: string; title: string }>;
  overrides: Record<string, string | number | boolean>;
} {
  const candles = input.chartStyle === "candles" || input.chartStyle === "heikinashi";
  const volume = input.hasVolume === true;
  const light = backgroundColorLooksLight(input.backgroundColor);
  const ink = light ? "#111111" : "#ffffff";
  const grid = mixHex(input.backgroundColor, ink, light ? 0.08 : 0.14);
  const crosshair = mixHex(input.backgroundColor, ink, 0.45);
  const scaleText = mixHex(input.backgroundColor, ink, 0.72);
  return {
    enabled_features: [
      // Use a file-backed iframe with the desktop views:// scheme.
      "iframe_loading_same_origin",
      "side_toolbar_in_fullscreen_mode",
      "header_in_fullscreen_mode",
      "legend_bar_change_colors_based_on_value",
      "determine_first_data_request_size_using_visible_range",
      "request_only_visible_range_on_reset",
      "secondary_series_extend_time_scale",
      "studies_extend_time_scale",
      "low_density_bars",
      "hide_unresolved_symbols_in_legend",
      "aria_detailed_chart_descriptions",
      "aria_crosshair_price_description",
      "study_overlay_compare_legend_option",
      "use_na_string_for_not_available_values",
      // fix_left_edge stays off. It glues the first bar to the left, so a short series fills the pane with empty future time and the drag only moves further into that gap.
      "always_show_legend_values_on_mobile",
      "symbol_info_long_description",
      "pre_post_market_sessions",
      // Child of the disabled settings-storage flag. The explicit enable is what shows interval favorites.
      "items_favoriting",
    ],
    disabled_features: [
      "use_localstorage_for_settings",
      "display_market_status",
      "pricescale_unit",
      "symbol_search_hot_key",
      "header_saveload",
      "show_right_widgets_panel_by_default",
      "volume_force_overlay",
      ...(!volume ? ["create_volume_indicator_by_default"] : []),
    ],
    favorites: {
      intervals: ["1", "5", "15", "60", "240", "D", "W", "M"],
      chartTypes: [
        "Bars",
        "Candles",
        "Hollow Candles",
        "Line",
        "Area",
        "Baseline",
        "Heiken Ashi",
        "Stepline",
        "LineWithMarkers",
        "Columns",
        "High-low",
      ],
      indicators: [
        "Volume",
        "Moving Average",
        "Moving Average Exponential",
        "VWAP",
        "Relative Strength Index",
        "MACD",
        "Bollinger Bands",
        "Average True Range",
        "Average Directional Index",
        "Donchian Channels",
        "Supertrend",
        "Stochastic RSI",
        "On Balance Volume",
        "Rate Of Change",
      ],
    },
    time_frames: [
      { text: "1d", resolution: "1", title: "1D" },
      { text: "5d", resolution: "5", title: "5D" },
      { text: "1m", resolution: "30", title: "1M" },
      { text: "3m", resolution: "60", title: "3M" },
      { text: "6m", resolution: "D", title: "6M" },
      { text: "1y", resolution: "D", title: "1Y" },
      { text: "5y", resolution: "W", title: "5Y" },
      { text: "100y", resolution: "M", title: "All" },
    ],
    overrides: {
      "paneProperties.background": input.backgroundColor,
      "paneProperties.backgroundType": "solid",
      "paneProperties.vertGridProperties.color": grid,
      "paneProperties.horzGridProperties.color": grid,
      "paneProperties.crossHairProperties.color": crosshair,
      "paneProperties.legendProperties.showBarChange": true,
      "paneProperties.legendProperties.showLastDayChange": candles,
      "paneProperties.legendProperties.showVolume": volume,
      "scalesProperties.lineColor": grid,
      "scalesProperties.textColor": scaleText,
      "mainSeriesProperties.style": input.chartStyle === "step" ? 15 : input.chartStyle === "heikinashi" ? 8 : candles ? 1 : 2,
      "mainSeriesProperties.showPriceLine": true,
      "mainSeriesProperties.showCountdown": candles && intraday(input.interval),
      "mainSeriesProperties.showPrevClosePriceLine": candles,
      "mainSeriesProperties.highLowAvgPrice.highLowPriceLinesVisible": true,
      "mainSeriesProperties.highLowAvgPrice.highLowPriceLabelsVisible": true,
      "mainSeriesProperties.highLowAvgPrice.highLowPriceLinesColor": input.lineColor,
      "mainSeriesProperties.highLowAvgPrice.averageClosePriceLineVisible": candles,
      "mainSeriesProperties.highLowAvgPrice.averageClosePriceLabelVisible": candles,
      "mainSeriesProperties.highLowAvgPrice.averagePriceLineColor": input.lineColor,
      "mainSeriesProperties.candleStyle.upColor": input.upColor,
      "mainSeriesProperties.candleStyle.downColor": input.downColor,
      "mainSeriesProperties.candleStyle.borderUpColor": input.upColor,
      "mainSeriesProperties.candleStyle.borderDownColor": input.downColor,
      "mainSeriesProperties.candleStyle.wickUpColor": input.upColor,
      "mainSeriesProperties.candleStyle.wickDownColor": input.downColor,
      "mainSeriesProperties.haStyle.upColor": input.upColor,
      "mainSeriesProperties.haStyle.downColor": input.downColor,
      "mainSeriesProperties.haStyle.borderUpColor": input.upColor,
      "mainSeriesProperties.haStyle.borderDownColor": input.downColor,
      "mainSeriesProperties.haStyle.wickUpColor": input.upColor,
      "mainSeriesProperties.haStyle.wickDownColor": input.downColor,
      "mainSeriesProperties.lineStyle.color": input.lineColor,
      "mainSeriesProperties.lineStyle.colorType": "solid",
      "mainSeriesProperties.lineStyle.gradientStartColor": input.lineColor,
      "mainSeriesProperties.lineStyle.gradientEndColor": input.lineColor,
      "mainSeriesProperties.lineStyle.linewidth": 2,
      ...(candles ? {} : { "mainSeriesProperties.priceLineColor": input.lineColor }),
      "mainSeriesProperties.areaStyle.linecolor": input.lineColor,
      "mainSeriesProperties.areaStyle.color1": input.lineColor,
      "mainSeriesProperties.areaStyle.color2": input.backgroundColor,
      "mainSeriesProperties.steplineStyle.color": input.lineColor,
      "mainSeriesProperties.steplineStyle.colorType": "solid",
      "mainSeriesProperties.sessionId": "extended",
      "backgrounds.preMarket.color": input.lineColor,
      "backgrounds.preMarket.transparency": 88,
      "backgrounds.preMarket.visible": true,
      "backgrounds.postMarket.color": input.lineColor,
      "backgrounds.postMarket.transparency": 88,
      "backgrounds.postMarket.visible": true,
    },
  };
}

const THEME_GRADIENT_STEPS = 19;
// Hint copy is white. A 4.5 fill of a white accent is still a light gray bar on a black chart.
const LIBRARY_UI_CONTRAST = 7;

function colorGradient(hex: string): string[] {
  const mid = (THEME_GRADIENT_STEPS - 1) / 2;
  return Array.from({ length: THEME_GRADIENT_STEPS }, (_, index) => {
    if (index === mid) return hex;
    if (index < mid) return mixHex(hex, "#ffffff", (mid - index) / mid);
    return mixHex(hex, "#000000", (index - mid) / mid);
  });
}

/** color-tv-blue-500 is this gradient's middle stop, and the hint text on it is white. */
function libraryAccentFill(accent: string): string {
  return blendForContrast(accent, "#ffffff", "#000000", LIBRARY_UI_CONTRAST);
}

export interface LibraryThemePalette {
  backgroundColor: string;
  text: string;
  textBright: string;
  textMuted: string;
  accent: string;
  positive: string;
  negative: string;
  warning: string;
}

/** color1 and color6 paint tooltips and buttons. The series stroke stays the raw accent. */
export function libraryCustomThemes(palette: LibraryThemePalette): {
  light: Record<string, string | string[]>;
  dark: Record<string, string | string[]>;
} {
  const accentFill = colorGradient(libraryAccentFill(palette.accent));
  const colors = {
    color1: accentFill,
    color2: colorGradient(palette.textMuted),
    color3: colorGradient(palette.negative),
    color4: colorGradient(palette.positive),
    color5: colorGradient(palette.warning),
    color6: accentFill,
    color7: colorGradient(palette.warning),
  };
  return {
    light: { ...colors, white: palette.backgroundColor, black: palette.text },
    dark: { ...colors, white: palette.textBright, black: palette.backgroundColor },
  };
}

export function libraryDataDefaults(points: readonly { open?: number | null; high?: number | null; low?: number | null; close?: number | null; volume?: number | null }[]): { chartStyle: "heikinashi" | "line"; hasVolume: boolean } {
  const ohlc = points.some((point) => [point.open, point.high, point.low, point.close].every((value) => typeof value === "number" && Number.isFinite(value)));
  return {
    chartStyle: ohlc ? "heikinashi" : "line",
    hasVolume: points.some((point) => typeof point.volume === "number" && Number.isFinite(point.volume) && point.volume > 0),
  };
}
