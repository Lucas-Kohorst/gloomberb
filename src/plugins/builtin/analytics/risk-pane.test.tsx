import { afterEach, beforeEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { act, useState } from "react";
import { apiClient } from "../../../api-client";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { createOpenTuiTestHarness } from "../../../renderers/opentui/test-utils";
import { appReducer, createInitialState, type AppAction, type AppState } from "../../../state/app/context";
import { createTestBrokerAdapter } from "../../../test-support/broker";
import { createTestDataProvider } from "../../../test-support/data-provider";
import { createTestPaneConfig, TestPaneFrame } from "../../../test-support/pane";
import { createTestPluginRuntime } from "../../../test-support/plugin-runtime";
import { createTestTicker } from "../../../test-support/ticker";
import type { AppConfig } from "../../../types/config";
import type { BrokerAccount, BrokerPortfolioPerformance } from "../../../types/trading";
import type { Portfolio, TickerRecord } from "../../../types/ticker";
import type { PluginRuntimeAccess } from "../../runtime";
import { portfolioRiskCache } from "./risk-client";
import { PortfolioRiskPane } from "./risk-pane";
import {
  BROKER_PORTFOLIO,
  brokerFixtureHoldings,
  brokerFixtureTickers,
  brokerRiskClient,
  now,
  sessionHistory,
} from "./risk-test-data";

const PANE_ID = "analytics:risk-test";
const tui = createOpenTuiTestHarness();
let coordinator: MarketDataCoordinator | undefined;
const spies: Array<{ mockRestore(): void }> = [];

/** Every listing quotes in USD with its own daily history; the rates and FRED are offline. */
type FakeCloud = ReturnType<typeof brokerRiskClient>;
const usListings: FakeCloud = {
  ...brokerRiskClient(now, []),
  getCloudHistory: async (symbol: string, exchange: string) => sessionHistory(symbol, exchange),
  getCloudFredSeries: async (_id: string) => { throw new Error("FRED offline in tests"); },
};
let cloud = usListings;

beforeEach(() => {
  // The fixtures end the session before this, and the loader dates its requests from the clock.
  setSystemTime(now);
  portfolioRiskCache.reset();
  cloud = usListings;
  spies.push(
    spyOn(apiClient, "getCloudQuotesBatch").mockImplementation(async (requested) => cloud.getCloudQuotesBatch(requested) as never),
    spyOn(apiClient, "getCloudHistory").mockImplementation(async (symbol: string, exchange: string) => cloud.getCloudHistory(symbol, exchange) as never),
    spyOn(apiClient, "getCloudFredSeries").mockImplementation(async (id: string) => cloud.getCloudFredSeries(id) as never),
    spyOn(apiClient, "getCloudExchangeRate").mockImplementation(async (currency: string) => cloud.getCloudExchangeRate(currency) as never),
  );
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  coordinator?.destroy();
  coordinator = undefined;
  setSharedMarketDataCoordinator(null);
  setSystemTime();
});

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await tui.setup().renderOnce();
    });
  }
}

const MAIN: Portfolio = { id: "main", name: "Main", currency: "USD" };
const mainTickers = () => [["AAPL", 40], ["XOM", 50]].map(([symbol, shares]) => createTestTicker(symbol as string, symbol as string, {
  exchange: symbol === "XOM" ? "NYSE" : "NASDAQ", portfolios: ["main"],
  positions: [{ portfolio: "main", shares: shares as number, avgCost: 90, currency: "USD", broker: "manual" }],
}));

/** The pane with the footer bar the app draws under it; the frame's last line is the footer. */
async function renderPane(
  width: number,
  height: number,
  settings: Record<string, unknown> = {},
  { portfolio = MAIN, tickers = mainTickers() }: { portfolio?: Portfolio; tickers?: TickerRecord[] } = {},
) {
  const config = createTestPaneConfig("/tmp/gloomberb-risk-pane-test", {
    paneId: "analytics", instanceId: PANE_ID, params: { portfolioId: portfolio.id }, settings: { ...settings },
  });
  config.portfolios = [portfolio];
  const runtime = createTestPluginRuntime();
  function Harness() {
    const [paneState, setPaneState] = useState<AppState["paneState"]>({});
    const state = createInitialState(config);
    state.tickers = new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker]));
    state.paneState = paneState;
    const dispatch = (action: AppAction) => setPaneState((current) => appReducer({ ...state, paneState: current }, action).paneState);
    return (
      <TestPaneFrame width={width} height={height} state={state} dispatch={dispatch} paneId={PANE_ID} pluginId="analytics" runtime={runtime}>
        {(body) => <PortfolioRiskPane paneId={PANE_ID} paneType="analytics" focused width={body.width} height={body.height} />}
      </TestPaneFrame>
    );
  }
  await act(async () => {
    await tui.render(<Harness />, { width, height });
  });
  await settle();
  return () => tui.frame().trimEnd().split("\n");
}

/** The value a table row shows, read from its line below the table header. */
function rowValue(lines: string[], label: string): string {
  const header = lines.findIndex((line) => line.includes("METRIC"));
  const row = lines.slice(header + 1).find((line) => line.trimStart().startsWith(label));
  return row?.match(/(-?\d+\.\d+%)/)?.[1] ?? "";
}

test("the risk chart names the metric it plots and follows the selected row", async () => {
  // The default floating size's body.
  const frame = await renderPane(78, 28);
  let lines = frame();
  const basket = rowValue(lines, "60D basket return");
  const benchmark = rowValue(lines, "60D benchmark return");
  expect(basket).not.toBe("");
  // The return rows chart the basket against SPY over their window, ending on the rows' values.
  const legend = lines.findIndex((line) => line.includes("● 60D basket return"));
  expect(lines[legend]).toContain(`● 60D basket return ${basket}`);
  expect(lines[legend]).toContain(`● 60D benchmark return ${benchmark}`);
  expect(lines.findIndex((line) => line.includes("METRIC"))).toBeGreaterThan(legend + 6);

  // Another row plots its own history, named by the row.
  for (const _ of [1, 2]) {
    await tui.emitKeypress({ name: "down" });
    await settle();
  }
  lines = frame();
  expect(lines.some((line) => line.includes(`● 60D active return ${rowValue(lines, "60D active return")}`))).toBe(true);
  expect(lines.some((line) => line.includes("● 60D basket return"))).toBe(false);
});

test("a short risk pane folds the chart into a strip and gives the table every row below it", async () => {
  const height = 13;
  const lines = (await renderPane(60, height))();
  const header = lines.findIndex((line) => line.includes("METRIC"));
  expect(lines.slice(0, header).some((line) => line.startsWith(" ● 60D basket return"))).toBe(true);
  expect(lines.slice(header + 1, -1).filter((line) => /^ (60D|252D|1D) /.test(line))).toHaveLength(height - header - 2);
});

test("the performance tab charts the account TWR over its metrics", async () => {
  const evidence = {
    version: 1, portfolioId: "main", currency: "USD", source: "Dated account statement",
    performance: {
      flowTiming: "end-of-day", externalFlowsComplete: true,
      observations: Array.from({ length: 12 }, (_, index) => ({
        date: new Date(Date.UTC(2025, 9 + index, 1)).toISOString().slice(0, 10),
        value: 100_000 + index * 2_000 + (index % 3) * 1_500 + (index >= 6 ? 10_000 : 0),
        externalFlow: index === 6 ? 10_000 : 0,
      })),
    },
  };
  const lines = (await renderPane(78, 28, { riskView: "performance", riskEvidence: JSON.stringify(evidence) }))();
  const twr = rowValue(lines, "TWR");
  expect(twr).not.toBe("");
  const legend = lines.findIndex((line) => line.includes(`● TWR ${twr}`));
  expect(legend).toBeGreaterThan(0);
  expect(lines.findIndex((line) => line.includes("METRIC"))).toBeGreaterThan(legend + 6);
});

test("a broker account the basket only partly covers states its coverage and lists the holdings left out", async () => {
  cloud = brokerRiskClient(now);
  const frame = await renderPane(130, 30, {}, { portfolio: BROKER_PORTFOLIO, tickers: brokerFixtureTickers() });
  let lines = frame();
  expect(rowValue(lines, "60D basket return")).not.toBe("");
  expect(lines.at(-1)).toContain("covers 78% of market value \u00b7 9 holdings left out");
  expect(lines.join("\n")).not.toContain("history unavailable");

  // The holdings view marks each holding left out where it sits by value, with its reason.
  await tui.emitKeypress({ name: "l" });
  await tui.emitKeypress({ name: "l" });
  await settle();
  lines = frame();
  const twd = lines.find((line) => line.trimStart().startsWith("TWD1"));
  expect(twd).toContain("left out");
  expect(twd).toContain("Foreign holdings: daily FX closes unavailable");
  expect(lines.at(-1)).toContain("covers 78% of market value");
});

test("below the coverage minimum the risk view says why instead of a table of dashes", async () => {
  cloud = brokerRiskClient(now);
  const tickers = brokerFixtureTickers(brokerFixtureHoldings().filter((row) => !/^US(?:[2-9]\d|1[1-9])$/.test(row.symbol)));
  const lines = (await renderPane(130, 20, {}, { portfolio: BROKER_PORTFOLIO, tickers }))();
  const text = lines.join("\n");
  expect(text).toContain("Qualifying holdings cover 5% of market value; basket estimates need 50%.");
  expect(text).toContain("Most of what is left out: Foreign holdings: daily FX closes unavailable");
  expect(text).not.toContain("60D basket return");
  expect(text).not.toContain("history unavailable");
});

const BROKER_PORTFOLIO_ID = "broker:ibkr-live:DU12345";

function brokerConfig(): AppConfig {
  const config = createTestPaneConfig("/tmp/gloomberb-risk-pane", {
    instanceId: PANE_ID, paneId: "analytics", binding: { kind: "none" },
    params: { portfolioId: BROKER_PORTFOLIO_ID }, settings: { riskView: "performance" },
  });
  config.portfolios = [{
    id: BROKER_PORTFOLIO_ID, name: "DU12345", currency: "USD", brokerId: "ibkr", brokerInstanceId: "ibkr-live", brokerAccountId: "DU12345",
  }];
  config.brokerInstances = [
    { id: "ibkr-live", brokerType: "ibkr", label: "IBKR Gateway", connectionMode: "gateway",
      config: { connectionMode: "gateway", gateway: { host: "127.0.0.1" } }, enabled: true },
    { id: "ibkr-flex", brokerType: "ibkr", label: "IBKR Flex", connectionMode: "flex",
      config: { connectionMode: "flex", flex: { token: "token", queryId: "query" } }, enabled: true },
  ];
  return config;
}

/** A broker account's Performance view, with the Cloud market history offline. */
async function renderBrokerPerformance(runtime: PluginRuntimeAccess, accounts: BrokerAccount[] = []) {
  const offline = async () => { throw new Error("offline"); };
  cloud = { ...usListings, getCloudQuotesBatch: offline, getCloudHistory: offline, getCloudFredSeries: offline };
  coordinator = new MarketDataCoordinator(createTestDataProvider({
    getQuote: (async () => null) as never,
    getPriceHistory: async () => [],
    getPriceHistoryForResolution: async () => [],
    getExchangeRate: async () => 0.75,
  }));
  setSharedMarketDataCoordinator(coordinator);
  const width = 100;
  const height = 33;
  function Harness() {
    const [paneState, setPaneState] = useState<AppState["paneState"]>({});
    const state = createInitialState(brokerConfig());
    state.focusedPaneId = PANE_ID;
    state.tickers = new Map([["AAPL", createTestTicker("AAPL", "Apple", {
      exchange: "NASDAQ", sector: "Technology", portfolios: [BROKER_PORTFOLIO_ID],
      positions: [{ portfolio: BROKER_PORTFOLIO_ID, shares: 10, avgCost: 100, currency: "USD", broker: "ibkr",
        brokerInstanceId: "ibkr-live", brokerAccountId: "DU12345", marketValue: 1250, markPrice: 125 }],
    })]]);
    state.brokerAccounts = { "ibkr-live": accounts };
    state.paneState = paneState;
    const dispatch = (action: AppAction) => setPaneState((current) => appReducer({ ...state, paneState: current }, action).paneState);
    return (
      <TestPaneFrame width={width} height={height} state={state} dispatch={dispatch} paneId={PANE_ID} pluginId="analytics" runtime={runtime}>
        {(body) => <PortfolioRiskPane paneId={PANE_ID} paneType="analytics" focused width={body.width} height={body.height} />}
      </TestPaneFrame>
    );
  }
  await act(async () => {
    await tui.render(<Harness />, { width, height });
  });
  await settle();
  return tui.frame();
}

test("Performance measures the account's daily returns from the configured Flex profile when the Gateway has none", async () => {
  const calls: string[] = [];
  const points: BrokerPortfolioPerformance["points"] = Array.from({ length: 15 }, (_, index) => ({
    date: `2026-09-${String(index + 1).padStart(2, "0")}`,
    cumulativeReturn: index * 0.001,
  }));
  const broker = createTestBrokerAdapter({
    id: "ibkr",
    getPortfolioPerformance: async (instance, accountId) => {
      calls.push(instance.id);
      return instance.id === "ibkr-flex"
        ? { accountId, source: "flex", period: "MTD", currency: "USD", fetchedAt: 1, measure: "TWR", points }
        : null;
    },
  });
  const frame = await renderBrokerPerformance(createTestPluginRuntime({ getBrokerAdapter: () => broker }));
  expect(calls).toEqual(["ibkr-live", "ibkr-flex"]);
  expect(frame).toContain("Account Sharpe");
  expect(frame).toMatch(/TWR\s+1\.40%/);
});

for (const currency of ["CAD", undefined] as const) test(`account figures convert from the account's own currency (${currency ?? "unknown"})`, async () => {
  const frame = await renderBrokerPerformance(createTestPluginRuntime(), [{
    accountId: "DU12345", name: "DU12345", currency, netLiquidation: 20_000, totalCashValue: 18_000, buyingPower: 40_000,
  }]);
  if (currency) {
    expect(frame).toContain("15.0k");
    expect(frame).toContain("13.5k");
    expect(frame).toContain("30.0k");
  } else {
    expect(frame).not.toContain("20.0k");
    expect(frame).not.toContain("18.0k");
  }
});
