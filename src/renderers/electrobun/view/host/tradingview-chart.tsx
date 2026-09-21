/** @jsxImportSource react */
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { TradingViewChartProps } from "../../../../ui/host";
import { reportConnectionRequest } from "../../../../plugins/builtin/connections/register";
import {
  TRADINGVIEW_CONNECTION_ID,
  tradingViewEmbedSrc,
  type TradingViewWidgetPlot,
} from "../../../../plugins/builtin/chart-composer/tradingview-plot";
import { cleanDomProps } from "./style";

function plotFromProps(props: TradingViewChartProps): TradingViewWidgetPlot {
  return {
    kind: "widget",
    symbol: props.symbol,
    compareSymbols: [...(props.compareSymbols ?? [])],
    interval: (props.interval ?? "D") as TradingViewWidgetPlot["interval"],
    timezone: props.timezone ?? "America/New_York",
  };
}

function themeFromBackground(backgroundColor: string): "dark" | "light" {
  const hex = backgroundColor.replace("#", "");
  if (hex.length < 6) return "dark";
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) return "dark";
  return (r * 299 + g * 587 + b * 114) / 1000 >= 160 ? "light" : "dark";
}

export function WebTradingViewChart({
  symbol,
  interval = "D",
  timezone = "America/New_York",
  compareSymbols,
  backgroundColor = "#16140f",
  style,
  ...props
}: TradingViewChartProps) {
  const startedAtRef = useRef(Date.now());
  const plot = useMemo(
    () => plotFromProps({ symbol, interval, timezone, compareSymbols }),
    [compareSymbols, interval, symbol, timezone],
  );
  const theme = themeFromBackground(String(backgroundColor));
  const src = useMemo(
    () => tradingViewEmbedSrc(plot, { theme, backgroundColor: String(backgroundColor) }),
    [backgroundColor, plot, theme],
  );

  useEffect(() => {
    startedAtRef.current = Date.now();
  }, [src]);

  return (
    <div
      {...cleanDomProps(props as Record<string, unknown>)}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        flex: 1,
        boxSizing: "border-box",
        backgroundColor: String(backgroundColor),
        ...(style as CSSProperties | undefined),
      }}
      data-gloom-role="tradingview-chart"
    >
      <iframe
        key={src}
        title={`${symbol} TradingView chart`}
        src={src}
        allow="clipboard-write; fullscreen"
        referrerPolicy="origin-when-cross-origin"
        data-gloom-role="tradingview-chart-frame"
        onLoad={() => {
          reportConnectionRequest(TRADINGVIEW_CONNECTION_ID, {
            success: true,
            durationMs: Date.now() - startedAtRef.current,
            operation: "embed",
          });
        }}
        onError={() => {
          reportConnectionRequest(TRADINGVIEW_CONNECTION_ID, {
            success: false,
            durationMs: Date.now() - startedAtRef.current,
            operation: "embed",
            error: "TradingView chart failed to load",
          });
        }}
        style={{
          border: 0,
          width: "100%",
          height: "100%",
          flex: 1,
          minHeight: 0,
          backgroundColor: String(backgroundColor),
        }}
      />
    </div>
  );
}
