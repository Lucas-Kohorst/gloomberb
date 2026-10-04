import { afterEach, describe, expect, test } from "bun:test";
import { CHART_BACKEND_ENV, chartBackendSetting, tradingViewChartsEnabled } from "./backend";

afterEach(() => {
  delete process.env[CHART_BACKEND_ENV];
});

describe("chart backend setting", () => {
  test("defaults to auto when the env var is unset or blank", () => {
    expect(chartBackendSetting()).toBe("auto");
    process.env[CHART_BACKEND_ENV] = "   ";
    expect(chartBackendSetting()).toBe("auto");
  });

  test("accepts custom and tradingview, case-insensitively", () => {
    process.env[CHART_BACKEND_ENV] = "Custom";
    expect(chartBackendSetting()).toBe("custom");
    expect(tradingViewChartsEnabled()).toBe(false);

    process.env[CHART_BACKEND_ENV] = "TRADINGVIEW";
    expect(chartBackendSetting()).toBe("tradingview");
    expect(tradingViewChartsEnabled()).toBe(true);
  });

  test("falls back to auto for unknown values", () => {
    process.env[CHART_BACKEND_ENV] = "canvas";
    expect(chartBackendSetting()).toBe("auto");
    expect(tradingViewChartsEnabled()).toBe(true);
  });
});
