import { readProcessEnv } from "../../utils/process-env";

/**
 * Build-time value injected by the view/web build scripts (`__GLOOM_CHART_BACKEND__`
 * define). Bun runtimes (TUI, CLI, desktop main) leave it undefined and read the
 * process env instead; `typeof` on the free identifier is safe before it is replaced.
 */
declare const __GLOOM_CHART_BACKEND__: string | undefined;

export type ChartBackendSetting = "auto" | "tradingview" | "custom";

export const CHART_BACKEND_ENV = "GLOOM_CHART_BACKEND";

/**
 * Which chart renderer the app may use.
 *
 * - `auto` (default) and `tradingview`: TradingView charts where the host can
 *   mount them (desktop web) and the chart shape fits; the custom renderer
 *   everywhere else, including the terminal.
 * - `custom`: never TradingView — every chart uses the built-in custom
 *   renderer, for checkouts without the `vendor/charting_library` submodule.
 */
export function chartBackendSetting(): ChartBackendSetting {
  const buildTime = typeof __GLOOM_CHART_BACKEND__ === "string" ? __GLOOM_CHART_BACKEND__ : "";
  const raw = (buildTime || readProcessEnv(CHART_BACKEND_ENV) || "").trim().toLowerCase();
  if (raw === "custom" || raw === "tradingview") return raw;
  return "auto";
}

/** False only when `GLOOM_CHART_BACKEND=custom` switches every chart off TradingView. */
export function tradingViewChartsEnabled(): boolean {
  return chartBackendSetting() !== "custom";
}
