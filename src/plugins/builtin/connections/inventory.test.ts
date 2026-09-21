import { afterEach, describe, expect, test } from "bun:test";
import {
  GLOOM_CLOUD_FRED_CONNECTION_ID,
  GLOOM_CLOUD_HTTP_CONNECTION_ID,
  GLOOM_CLOUD_SOCKET_CONNECTION_ID,
} from "../../../core/connection-health";
import { registerGloomCloudInventorySources } from "../cloud/connections";
import { dividendYieldModule } from "../dividend-yield";
import { chartComposerModule } from "../chart-composer";
import { TRADINGVIEW_CONNECTION_ID } from "../chart-composer/tradingview-plot";
import { YAHOO_DIVIDENDS_CONNECTION_ID } from "../dividend-yield/client";
import { ipoCalendarModule } from "../ipo-calendar";
import { STOCKANALYSIS_IPO_CONNECTION_ID } from "../ipo-calendar/client";
import { marketHaltsModule } from "../market-halts";
import { NASDAQ_HALTS_CONNECTION_ID } from "../market-halts/client";
import { shortInterestModule } from "../short-interest";
import { YAHOO_SHORT_INTEREST_CONNECTION_ID } from "../short-interest/client";
import {
  clearPendingConnectionReports,
  listConnectionSources,
  setConnectionRequestReporter,
} from "./register";

function stubCtx(overrides: Record<string, unknown> = {}) {
  return {
    persistence: { getResource: () => null, setResource() {} },
    registerTickerResearchTab() {},
    ...overrides,
  } as never;
}

describe("Connections inventory wiring", () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    while (disposers.length > 0) disposers.pop()?.();
    ipoCalendarModule.dispose?.();
    marketHaltsModule.dispose?.();
    shortInterestModule.dispose?.();
    dividendYieldModule.dispose?.();
    chartComposerModule.dispose?.();
    setConnectionRequestReporter(null);
    clearPendingConnectionReports();
  });

  test("Gloom Cloud inventory publishes HTTP, socket, and FRED rows", () => {
    disposers.push(registerGloomCloudInventorySources());
    const ids = listConnectionSources().map((source) => source.id);
    expect(ids).toEqual(expect.arrayContaining([
      GLOOM_CLOUD_HTTP_CONNECTION_ID,
      GLOOM_CLOUD_SOCKET_CONNECTION_ID,
      GLOOM_CLOUD_FRED_CONNECTION_ID,
    ]));
    expect(ids).not.toContain("gloom-cloud");
  });

  test("IPO and Nasdaq halts register as their own sources at plugin setup", () => {
    ipoCalendarModule.setup?.(stubCtx());
    marketHaltsModule.setup?.(stubCtx());
    const ids = listConnectionSources().map((source) => source.id);
    expect(ids).toContain(STOCKANALYSIS_IPO_CONNECTION_ID);
    expect(ids).toContain(NASDAQ_HALTS_CONNECTION_ID);
  });

  test("Yahoo dividends and short-interest do not publish ghost CONN rows", () => {
    shortInterestModule.setup?.(stubCtx());
    dividendYieldModule.setup?.(stubCtx());
    const ids = listConnectionSources().map((source) => source.id);
    expect(ids).not.toContain(YAHOO_SHORT_INTEREST_CONNECTION_ID);
    expect(ids).not.toContain(YAHOO_DIVIDENDS_CONNECTION_ID);
  });

  test("TradingView registers as a Connections source from chart composer setup", () => {
    chartComposerModule.setup?.(stubCtx());
    const source = listConnectionSources().find((entry) => entry.id === TRADINGVIEW_CONNECTION_ID);
    expect(source).toMatchObject({
      id: TRADINGVIEW_CONNECTION_ID,
      name: "TradingView",
      kind: "asset-data",
      pluginId: "ticker-research",
      authRequired: false,
    });
  });
});
