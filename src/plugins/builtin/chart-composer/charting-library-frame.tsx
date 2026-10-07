/** @jsxImportSource react */
import { useLayoutEffect, useRef, useState } from "react";
import { useThemeColors } from "../../../theme/theme-context";
import { debugLog } from "../../../utils/debug-log";
import { getSharedRegistry } from "../../registry/shared";
import { chartLayoutKey, persistChartLayout, readChartLayout, type PersistableChartWidget } from "./charting-library-persistence";
import { supportedLibraryResolution } from "./charting-library-resolution";
import { bindChartCommandBarKey } from "./charting-library-keyboard";
import type { LibraryDatafeed } from "./charting-library-feed";
import {
  backgroundColorLooksLight,
  libraryChartChrome,
  libraryCustomThemes,
  libraryPercentScaleMode,
  type LibraryPriceScale,
} from "./charting-library-options";

const chartLog = debugLog.createLogger("chart-composer");

interface ChartingWindow {
  TradingView?: {
    widget: new (options: Record<string, unknown>) => PersistableChartWidget & {
      onChartReady?: (callback: () => void) => void;
      activeChart?: () => {
        symbolExt?: () => { ticker?: string; name?: string; supported_resolutions?: string[] } | null;
        onSymbolChanged?: () => {
          subscribe: (owner: null, callback: (info: { ticker?: string; name?: string; supported_resolutions?: string[] }) => void) => void;
          unsubscribe: (owner: null, callback: (info: { ticker?: string; name?: string; supported_resolutions?: string[] }) => void) => void;
        };
        resolution?: () => string;
        setResolution?: (resolution: string) => Promise<boolean>;
        setChartType?: (type: number) => void;
        createStudy?: (name: string, forceOverlay: boolean, lock: boolean, inputs: Record<string, unknown>) => void;
        getPanes?: () => Array<{
          getMainSourcePriceScale?: () => { setMode?: (mode: number) => void } | null;
        }>;
      };
      remove?: () => void;
    };
  };
  __gloomChartingLibrary?: Promise<void>;
}

function isPublicSharePath(): boolean {
  const path = globalThis.location?.pathname ?? "";
  return path.startsWith("/s/") || path.startsWith("/l/");
}

function assetPaths(): { script: string; libraryPath: string } {
  const protocol = globalThis.location?.protocol ?? "";
  const rooted = protocol !== "views:" && protocol !== "file:";
  const libraryPath = rooted ? "/charting_library/" : "./charting_library/";
  return { script: `${libraryPath}charting_library.standalone.js`, libraryPath };
}

function isDeadChartWindow(error: unknown): boolean {
  return error instanceof TypeError
    && /doWhenApiIsReady|contentWindow|tradingViewApi/.test(error.message);
}

function reportChartDetach(error: unknown, action: string): void {
  if (isDeadChartWindow(error)) chartLog.warn(`Chart ${action} hit a detached window`, error);
  else chartLog.error(`Chart ${action} failed`, error);
}

function loadLibrary(script: string): Promise<void> {
  const host = window as Window & ChartingWindow;
  if (host.TradingView?.widget) return Promise.resolve();
  const existing = host.__gloomChartingLibrary;
  if (existing) return existing;
  const pending = new Promise<void>((resolve, reject) => {
    const element = document.createElement("script");
    element.src = script;
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => reject(new Error("Charting library failed to load"));
    document.head.appendChild(element);
  });
  const guarded = pending.catch((error: unknown) => {
    host.__gloomChartingLibrary = undefined;
    return Promise.reject(error);
  });
  host.__gloomChartingLibrary = guarded;
  return guarded;
}

export function ChartingLibraryFrame({
  symbol,
  interval,
  timezone,
  compares,
  chartStyle,
  hasVolume = false,
  priceScale = "normal",
  backgroundColor,
  feed,
  onReady,
  onPrimarySymbolChange,
  onError,
}: {
  symbol: string;
  interval: string;
  timezone: string;
  compares: readonly string[];
  chartStyle: "candles" | "line" | "heikinashi" | "step";
  hasVolume?: boolean;
  priceScale?: LibraryPriceScale;
  backgroundColor: string;
  feed: LibraryDatafeed;
  onPrimarySymbolChange?: (symbol: { ticker: string; name: string }) => void;
  onReady?: () => void;
  onError?: (error: unknown) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const onPrimarySymbolChangeRef = useRef(onPrimarySymbolChange);
  onPrimarySymbolChangeRef.current = onPrimarySymbolChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const compareKey = compares.join("\n");
  const layoutKey = chartLayoutKey(symbol, compares);
  const palette = useThemeColors();
  const themeKey = [
    palette.borderFocused,
    palette.positive,
    palette.negative,
    palette.warning,
    palette.text,
    palette.textBright,
    palette.textMuted,
    palette.bg,
  ].join("|");

  // Runs before React removes the iframe. WebKit then clears contentWindow,
  // and the library's unsubscribe throws on doWhenApiIsReady.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const stopKeyboard = bindChartCommandBarKey(container, () => getSharedRegistry()?.openCommandBar());
    let cancelled = false;
    setStatus("loading");
    const loadingTimeout = window.setTimeout(() => {
      if (!cancelled) setStatus("error");
    }, 20_000);
    let widget: { remove?: () => void } | null = null;
    let stopPersistence: (() => void) | undefined;
    let stopPrimarySymbol: (() => void) | undefined;
    const { script, libraryPath } = assetPaths();
    void loadLibrary(script).then(() => {
      if (cancelled || !containerRef.current) return;
      const host = window as Window & ChartingWindow;
      const Widget = host.TradingView?.widget;
      if (!Widget) throw new Error("Charting library did not register TradingView.widget");
      const compareSymbols = compareKey ? compareKey.split("\n") : [];
      const store = isPublicSharePath() ? undefined : getSharedRegistry();
      const savedLayout = readChartLayout(store, layoutKey);
      const chrome = libraryChartChrome({
        chartStyle,
        hasVolume,
        interval,
        backgroundColor,
        upColor: palette.positive,
        downColor: palette.negative,
        lineColor: palette.borderFocused,
      });
      const overrides: Record<string, unknown> = { ...chrome.overrides };
      if (savedLayout) {
        delete overrides["mainSeriesProperties.style"];
        delete overrides["mainSeriesProperties.sessionId"];
      }
      const next = new Widget({
        container: containerRef.current,
        library_path: libraryPath,
        datafeed: feedRef.current,
        symbol,
        interval,
        timezone,
        saved_data: savedLayout,
        auto_save_delay: 1,
        locale: "en",
        autosize: true,
        theme: backgroundColorLooksLight(backgroundColor) ? "light" : "dark",
        // Settings storage is off, so interval favorites are passed in the constructor
        // and items_favoriting is enabled on its own. Adaptive drops the header from
        // full buttons to the favorites row when the toolbar is narrow. This library
        // build does not collapse that row to icons.
        disabled_features: chrome.disabled_features,
        enabled_features: chrome.enabled_features,
        header_widget_buttons_mode: "adaptive",
        favorites: chrome.favorites,
        time_frames: chrome.time_frames,
        overrides,
        custom_themes: libraryCustomThemes({
          backgroundColor,
          text: palette.text,
          textBright: palette.textBright,
          textMuted: palette.textMuted,
          accent: palette.borderFocused,
          positive: palette.positive,
          negative: palette.negative,
          warning: palette.warning,
        }),
        loading_screen: { backgroundColor },
      });
      widget = next;
      next.onChartReady?.(() => {
        if (cancelled) return;
        const chart = next.activeChart?.();
        if (!savedLayout) {
          chart?.setChartType?.(chartStyle === "step" ? 15 : chartStyle === "line" ? 2 : chartStyle === "heikinashi" ? 8 : 1);
          for (const compare of compareSymbols) {
            try {
              // Overlay keeps the raw series. Percentage mode, when set below, rebases every series together.
              chart?.createStudy?.("Overlay", true, false, { symbol: compare });
            } catch {
              // A compare the feed cannot resolve stays off the chart.
            }
          }
          if (priceScale === "percentage") {
            chart?.getPanes?.()[0]?.getMainSourcePriceScale?.()?.setMode?.(libraryPercentScaleMode());
          }
        }
        let primaryRevision = 0;
        const notifyPrimarySymbol = (info: { ticker?: string; name?: string; supported_resolutions?: string[] }) => {
          if (cancelled) return;
          const revision = ++primaryRevision;
          const current = chart?.resolution?.();
          const supported = current ? supportedLibraryResolution(current, info.supported_resolutions) : undefined;
          if (supported && supported !== current && chart?.setResolution) {
            void Promise.resolve().then(() => cancelled || revision !== primaryRevision ? true : chart.setResolution!(supported)).then((changed) => {
              if (!changed && !cancelled) throw new Error(`Could not switch chart to supported interval ${supported}`);
            }).catch((error: unknown) => {
              if (!cancelled) {
                setStatus("error");
                onErrorRef.current?.(error);
              }
            });
          }
          const ticker = info.ticker ?? info.name;
          if (!cancelled && ticker) onPrimarySymbolChangeRef.current?.({
            ticker,
            name: info.name ?? ticker,
          });
        };
        const symbolChanges = chart?.onSymbolChanged?.();
        symbolChanges?.subscribe(null, notifyPrimarySymbol);
        stopPrimarySymbol = () => symbolChanges?.unsubscribe(null, notifyPrimarySymbol);
        const currentSymbol = chart?.symbolExt?.();
        if (currentSymbol) notifyPrimarySymbol(currentSymbol);
        stopPersistence = persistChartLayout(next, store, layoutKey, (error) => onErrorRef.current?.(error));
        window.clearTimeout(loadingTimeout);
        setStatus("ready");
        onReadyRef.current?.();
      });
    }).catch((error: unknown) => {
      if (!cancelled) {
        window.clearTimeout(loadingTimeout);
        setStatus("error");
        onErrorRef.current?.(error);
      }
    });
    return () => {
      cancelled = true;
      window.clearTimeout(loadingTimeout);
      stopKeyboard();
      try { stopPrimarySymbol?.(); } catch (error: unknown) { reportChartDetach(error, "symbol unsubscribe"); }
      try { stopPersistence?.(); } catch (error: unknown) { reportChartDetach(error, "layout unsubscribe"); }
      try { widget?.remove?.(); } catch (error: unknown) { reportChartDetach(error, "widget remove"); }
    };
  }, [backgroundColor, chartStyle, hasVolume, compareKey, interval, layoutKey, palette, priceScale, symbol, themeKey, timezone, retry]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minWidth: 0, minHeight: 0, flex: 1 }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {status !== "ready" ? (
        <div role="status" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor, color: palette.textMuted }}>
          {status === "loading" ? "Loading chart…" : (
            <>
              Chart could not finish loading.
              <button type="button" onClick={() => setRetry((current) => current + 1)} style={{ cursor: "pointer", color: palette.text, background: "transparent", border: `1px solid ${palette.textMuted}`, padding: "4px 8px" }}>Retry</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
