/** @jsxImportSource react */
import { useRef, type CSSProperties } from "react";
import type { TradingViewChartProps } from "../../../../ui/host";
import { reportConnectionRequest } from "../../../../plugins/builtin/connections/register";
import { TRADINGVIEW_CONNECTION_ID } from "../../../../plugins/builtin/chart-composer/tradingview-plot";
import { ChartingLibraryFrame } from "../../../../plugins/builtin/chart-composer/charting-library-frame";
import { cleanDomProps } from "./style";

export function WebTradingViewChart({
  symbol,
  interval = "D",
  timezone = "America/New_York",
  compareSymbols,
  backgroundColor = "#16140f",
  chartStyle = "candles",
  priceScale = "normal",
  hasVolume = false,
  onPrimarySymbolChange,
  feed,
  style,
  ...props
}: TradingViewChartProps) {
  const startedAtRef = useRef(Date.now());

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
        overflow: "clip",
        touchAction: "none",
        overscrollBehavior: "none",
        flex: 1,
        boxSizing: "border-box",
        backgroundColor: String(backgroundColor),
        ...(style as CSSProperties | undefined),
      }}
      data-gloom-role="tradingview-chart"
      onWheel={(event) => event.stopPropagation()}
    >
      {feed ? (
        <ChartingLibraryFrame
          symbol={symbol}
          interval={interval}
          timezone={timezone}
          compares={compareSymbols ?? []}
          chartStyle={chartStyle}
          priceScale={priceScale}
          hasVolume={hasVolume}
          onPrimarySymbolChange={onPrimarySymbolChange}
          backgroundColor={String(backgroundColor)}
          feed={feed}
          onReady={() => {
            reportConnectionRequest(TRADINGVIEW_CONNECTION_ID, {
              success: true,
              durationMs: Date.now() - startedAtRef.current,
              operation: "library",
            });
          }}
          onError={(error) => {
            reportConnectionRequest(TRADINGVIEW_CONNECTION_ID, {
              success: false,
              durationMs: Date.now() - startedAtRef.current,
              operation: "library",
              error: error instanceof Error ? error.message : "Charting library failed to load",
            });
          }}
        />
      ) : null}
    </div>
  );
}
