/** @jsxImportSource react */
import { useEffect, useRef } from "react";
import { useThemeColors } from "../../../theme/theme-context";
import { getSharedRegistry } from "../../registry/shared";
import { isPublicShareLocation } from "../shared/share-link";
import { chartLayoutKey, persistChartLayout, readChartLayout, type PersistableChartWidget } from "./charting-library-persistence";
import type { LibraryDatafeed } from "./charting-library-feed";
import {
  backgroundColorLooksLight,
  libraryChartChrome,
  libraryCustomThemes,
  libraryPercentScaleMode,
  type LibraryPriceScale,
} from "./charting-library-options";

interface ChartingWindow {
  TradingView?: {
    widget: new (options: Record<string, unknown>) => PersistableChartWidget & {
      onChartReady?: (callback: () => void) => void;
      activeChart?: () => {
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

function assetPaths(): { script: string; libraryPath: string } {
  const protocol = globalThis.location?.protocol ?? "";
  const rooted = protocol !== "views:" && protocol !== "file:";
  const libraryPath = rooted ? "/charting_library/" : "./charting_library/";
  return { script: `${libraryPath}charting_library.standalone.js`, libraryPath };
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
  onReady?: () => void;
  onError?: (error: unknown) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const compareKey = compares.join("\n");
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let cancelled = false;
    let widget: { remove?: () => void } | null = null;
    let stopPersistence: (() => void) | undefined;
    const { script, libraryPath } = assetPaths();
    void loadLibrary(script).then(() => {
      if (cancelled || !containerRef.current) return;
      const host = window as Window & ChartingWindow;
      const Widget = host.TradingView?.widget;
      if (!Widget) throw new Error("Charting library did not register TradingView.widget");
      const compareSymbols = compareKey ? compareKey.split("\n") : [];
      const store = isPublicShareLocation() ? undefined : getSharedRegistry();
      const layoutKey = chartLayoutKey(symbol, compareSymbols);
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
        // Settings storage is off, so the header interval buttons have to be passed here.
        // Without them the bar shows only the current interval.
        disabled_features: chrome.disabled_features,
        enabled_features: chrome.enabled_features,
        header_widget_buttons_mode: "fullsize",
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
        stopPersistence = persistChartLayout(next, store, layoutKey, (error) => onErrorRef.current?.(error));
        onReadyRef.current?.();
      });
    }).catch((error: unknown) => {
      if (!cancelled) onErrorRef.current?.(error);
    });
    return () => {
      cancelled = true;
      stopPersistence?.();
      widget?.remove?.();
    };
  }, [backgroundColor, chartStyle, hasVolume, compareKey, interval, palette, priceScale, symbol, themeKey, timezone]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        flex: 1,
      }}
    />
  );
}
