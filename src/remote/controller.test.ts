import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Dispatch } from "react";

const fredSeriesCalls: Array<{ seriesId: string; params: unknown }> = [];

mock.module("../data/fred-public", () => ({
  FRED_PUBLIC_CONNECTION_ID: "fred-public",
  fetchPublicFredSeries: async (seriesId: string, params: unknown = {}) => {
    const id = seriesId.trim().toUpperCase();
    if (!/^[A-Z0-9._-]{1,80}$/.test(id)) {
      throw new Error(`Invalid FRED series id "${seriesId}"`);
    }
    fredSeriesCalls.push({ seriesId, params });
    const observations = [
      { date: "2024-01-01", value: 5.25 },
      { date: "2024-02-01", value: 5.33 },
    ];
    const limit = typeof (params as { limit?: number }).limit === "number"
      ? (params as { limit: number }).limit
      : observations.length;
    return {
      observations: observations.slice(0, limit),
      info: {
        id,
        title: id,
        units: "Percent",
        frequency: "Daily",
        seasonalAdjustment: "Not Seasonally Adjusted",
        source: "FRED",
        notes: "",
      },
    };
  },
}));

const pollsCalls: Array<{ pollType?: string; subject?: string }> = [];
const pollsSeed = [
  { id: "p1", pollster: "A", subject: "trump", start_date: "2024-01-01" },
  { id: "p2", pollster: "B", subject: "trump", start_date: "2024-02-01" },
];

mock.module("../plugins/builtin/polls/client", () => ({
  POLLS_FETCH_HEAD: 400,
  parseVoteHubPollsPayload: (body: unknown) => (Array.isArray(body) ? body : []),
  voteHubPollQuery: (params?: { pollType?: string; subject?: string }) => ({
    poll_type: params?.pollType,
    subject: params?.subject,
  }),
  fetchVoteHubPolls: async (params?: { pollType?: string; subject?: string }) => {
    pollsCalls.push({ pollType: params?.pollType, subject: params?.subject });
    return pollsSeed;
  },
}));

const adjacentClientCalls: Array<{ method: string; arg?: string }> = [];
let adjacentIndicesResponse: { data?: unknown[] } = { data: [{ index_id: "spx", name: "S&P 500", ticker: "SPX" }] };
let adjacentIndexPricesResponse: { data?: unknown[] } = { data: [{ date: "2024-01-01", close: 100 }] };

mock.module("../plugins/builtin/adjacent/client", () => ({
  ADJACENT_CACHE_POLICIES: {
    markets: { staleMs: 0, expireMs: 0 },
    marketDetail: { staleMs: 0, expireMs: 0 },
    prices: { staleMs: 0, expireMs: 0 },
    candles: { staleMs: 0, expireMs: 0 },
    trades: { staleMs: 0, expireMs: 0 },
    quotes: { staleMs: 0, expireMs: 0 },
    similar: { staleMs: 0, expireMs: 0 },
    events: { staleMs: 0, expireMs: 0 },
    indices: { staleMs: 0, expireMs: 0 },
    constituents: { staleMs: 0, expireMs: 0 },
    indexPrices: { staleMs: 0, expireMs: 0 },
    rates: { staleMs: 0, expireMs: 0 },
    ratePrices: { staleMs: 0, expireMs: 0 },
    news: { staleMs: 0, expireMs: 0 },
    filings: { staleMs: 0, expireMs: 0 },
    filingDetail: { staleMs: 0, expireMs: 0 },
  },
  attachAdjacentPersistence: () => {},
  resetAdjacentPersistence: () => {},
  AdjacentClient: class {},
  loadCftcFilings: async () => ({ filings: [], meta: { page: 1, perPage: 100 } }),
  getAdjacentCached: () => null,
  setAdjacentCached: () => {},
  setSharedAdjacentApiKey: () => {},
  getSharedAdjacentClient: () => ({
    isPublic: true,
    getIndices: async () => {
      adjacentClientCalls.push({ method: "getIndices" });
      return adjacentIndicesResponse;
    },
    getIndexPrices: async (id: string) => {
      adjacentClientCalls.push({ method: "getIndexPrices", arg: id });
      return adjacentIndexPricesResponse;
    },
    listFilings: async (query?: { feed?: string; search?: string; page?: number }) => {
      adjacentClientCalls.push({ method: "listFilings", arg: query?.feed ?? query?.search });
      return {
        filings: [{
          id: 1,
          title: "KEX product",
          feed: "dcm_products",
          orgCode: "KEX",
          status: "Certified",
          statusDate: new Date("2026-08-01T00:00:00Z"),
          docCount: 1,
        }],
        meta: { page: 1, perPage: 100, hasNext: false },
      };
    },
  }),
  loadCftcFilingsFeed: async (client: { listFilings: Function }, options?: { feed?: string }) => {
    const page = await client.listFilings({ feed: options?.feed, page: 1 });
    return page.filings;
  },
}));

const kalshiCatalogCalls: Array<{ query: string; category?: string }> = [];
const polymarketCatalogCalls: Array<{ query: string; category?: string }> = [];
const kalshiResolveCalls: string[] = [];
const polymarketResolveCalls: string[] = [];
const kalshiHistoryCalls: Array<{ ticker: string; range: string }> = [];
const polymarketHistoryCalls: Array<{ marketId: string; range: string }> = [];

function makeSummary(venue: "kalshi" | "polymarket", id: string): {
  marketId: string;
  venue: "kalshi" | "polymarket";
  title: string;
  url: string;
} {
  return { marketId: id, venue, title: `${venue}-${id}`, url: `https://${venue}.example/${id}` };
}

const kalshiCatalogSeed = [makeSummary("kalshi", "KX-1"), makeSummary("kalshi", "KX-2")];
const polymarketCatalogSeed = [makeSummary("polymarket", "POLY-1")];

mock.module("../plugins/prediction-markets/services/kalshi/adapter", () => ({
  normalizeKalshiMarket: (value: unknown) => value,
  getKalshiCatalogFeed: () => "live" as const,
  resetKalshiCatalogFeed: () => {},
  kalshiCatalogCursor: () => null,
  loadKalshiCatalog: async (query = "", category?: string) => {
    kalshiCatalogCalls.push({ query, category });
    return kalshiCatalogSeed;
  },
  loadMoreKalshiCatalog: async () => [],
  resolveKalshiMarketByTicker: async (ticker: string) => {
    kalshiResolveCalls.push(ticker);
    return makeSummary("kalshi", ticker);
  },
  loadKalshiHistory: async (summary: { marketId: string }, range: string) => {
    kalshiHistoryCalls.push({ ticker: summary.marketId, range });
    return [{ date: new Date("2024-01-01"), close: 0.55 }];
  },
  loadKalshiDetail: async () => null,
}));

mock.module("../plugins/prediction-markets/services/polymarket/adapter", () => ({
  normalizePolymarketMarket: (value: unknown) => value,
  loadPolymarketDetail: async () => null,
  nextPolymarketCatalogOffset: () => null,
  loadPolymarketCatalog: async (query = "", category?: string) => {
    polymarketCatalogCalls.push({ query, category });
    return polymarketCatalogSeed;
  },
  loadMorePolymarketCatalog: async () => [],
}));

mock.module("../plugins/prediction-markets/services/polymarket/detail", () => ({
  loadPolymarketEvent: async () => null,
  resolvePolymarketMarketById: async (marketId: string) => {
    polymarketResolveCalls.push(marketId);
    return makeSummary("polymarket", marketId);
  },
  loadPolymarketHistory: async (summary: { marketId: string }, range: string) => {
    polymarketHistoryCalls.push({ marketId: summary.marketId, range });
    return [{ date: new Date("2024-01-01"), close: 0.62 }];
  },
  loadPolymarketDetail: async () => null,
}));

const { appReducer, createInitialState } = await import("../core/state/app/state");
const { setSharedNewsService } = await import("../news/hooks");
const { registerConnectionSource } = await import("../plugins/builtin/connections/register");
const { hydrateTickerMetadata } = await import("../tickers/metadata");
const { createDefaultConfig } = await import("../types/config");
const { createAppRemoteController } = await import("./controller");
import type { AppAction, AppState } from "../core/state/app/state";
import type { PluginRegistry } from "../plugins/registry";
import type { PaneDef, PaneTemplateDef } from "../types/plugin";
import type { RemoteControlSchema, RemoteUiNodeSnapshot } from "./types";
import type { RemoteUiRegistry } from "./semantic-tree";

const TEST_PANE_ID = "remote-test-pane";
const TEST_PANE_SETTING = {
  key: "refreshMs",
  label: "Refresh interval",
  type: "text" as const,
};
const TEST_PANE: PaneDef = {
  id: TEST_PANE_ID,
  name: "Remote Test Pane",
  component: () => null,
  defaultPosition: "right",
  defaultMode: "docked",
  settings: {
    title: "Remote Test Settings",
    fields: [TEST_PANE_SETTING],
  },
};
const TEST_PANE_TEMPLATE: PaneTemplateDef = {
  id: "remote-test-pane-template",
  paneId: TEST_PANE_ID,
  label: "Remote Test Template",
  description: "Seeded template for remote inventory tests",
  shortcut: { prefix: "RTP" },
};

function createRegistryHarness(options: { withFloatingPane?: boolean } = {}) {
  const config = {
    ...createDefaultConfig("/tmp/gloom-remote-controller"),
    onboardingComplete: true,
    watchlists: [
      { id: "tech", name: "Tech" },
      { id: "empty", name: "Empty" },
    ],
    portfolios: [
      { id: "core", name: "Core", currency: "USD" },
    ],
  };
  if (options.withFloatingPane) {
    const instance = {
      instanceId: "help:test",
      paneId: "help",
      binding: { kind: "none" as const },
    };
    config.layout = {
      ...config.layout,
      instances: [...config.layout.instances, instance],
      floating: [{ instanceId: instance.instanceId, x: 8, y: 4, width: 60, height: 24 }],
    };
  }
  let state = createInitialState(config);
  state = {
    ...state,
    tickers: new Map([
      ["AAPL", {
        metadata: hydrateTickerMetadata({
          ticker: "AAPL",
          name: "Apple",
          watchlists: ["tech"],
          portfolios: ["core"],
        }),
      }],
      ["MSFT", {
        metadata: hydrateTickerMetadata({
          ticker: "MSFT",
          name: "Microsoft",
          watchlists: ["tech"],
          positions: [{ portfolio: "core", shares: 10, avgCost: 300, broker: "manual" }],
        }),
      }],
      ["NVDA", {
        metadata: hydrateTickerMetadata({
          ticker: "NVDA",
          name: "NVIDIA",
          watchlists: ["ghost"],
        }),
      }],
    ]),
  };
  const actions: AppAction[] = [];
  const dispatch: Dispatch<AppAction> = (action) => {
    actions.push(action);
    state = appReducer(state, action);
  };
  const invokedCapabilities: Array<{ capabilityId: string; operationId: string; payload: unknown }> = [];
  const marketDataQueries: Array<{ operation: string; input: unknown }> = [];
  const createdTemplates: Array<{ templateId: string; options?: unknown }> = [];
  const registry = {
    panes: new Map([[TEST_PANE_ID, TEST_PANE]]),
    paneTemplates: new Map([[TEST_PANE_TEMPLATE.id, TEST_PANE_TEMPLATE]]),
    commands: new Map(),
    capabilities: {
      manifests: () => [],
      invoke: async (capabilityId: string, operationId: string, payload: unknown) => {
        invokedCapabilities.push({ capabilityId, operationId, payload });
        return { invoked: true, capabilityId, operationId, payload };
      },
    },
    marketData: {
      search: async (query: string) => {
        marketDataQueries.push({ operation: "search", input: { query } });
        return [{
          symbol: "NVDA",
          name: "NVIDIA Corporation",
          exchange: "NASDAQ",
          type: "Equity",
        }];
      },
      getQuote: async (symbol: string, exchange?: string) => {
        marketDataQueries.push({ operation: "quote", input: { symbol, exchange } });
        return { symbol, exchange, price: 180 };
      },
      getTickerFinancials: async (symbol: string, exchange?: string) => {
        marketDataQueries.push({ operation: "financials", input: { symbol, exchange } });
        return { quote: { symbol, exchange, price: 180 } };
      },
    },
    resolvePaneSettings: () => null,
    showPane: () => {},
    focusPane: () => {},
    hidePane: () => {},
    createPaneFromTemplateAsyncFn: async (templateId: string, options?: unknown) => {
      createdTemplates.push({ templateId, options });
    },
    navigateTicker: () => {},
    pinTicker: () => {},
    selectTicker: () => {},
    switchTab: () => {},
    getTermSizeFn: () => ({ width: 120, height: 40 }),
    updateLayoutFn: (layout: AppState["config"]["layout"]) => {
      dispatch({ type: "UPDATE_LAYOUT", layout });
    },
    applyPaneSettingValueFn: async () => {},
    notify: () => {},
  } as unknown as PluginRegistry;
  let uiNodes: RemoteUiNodeSnapshot[] = [{ id: "ui:test", role: "button", label: "Test", actions: ["press"] }];
  const invokedUiActions: Array<{ nodeId: string; action: string; input?: unknown }> = [];
  const uiRegistry: RemoteUiRegistry = {
    register: () => {},
    unregister: () => {},
    snapshot: () => uiNodes,
    invoke: async (nodeId, action, input) => {
      invokedUiActions.push({ nodeId, action, input });
      return { nodeId, action, input };
    },
  };
  const controller = createAppRemoteController({
    dispatch,
    getState: () => state,
    pluginRegistry: registry,
    uiRegistry,
  });
  return {
    actions,
    controller,
    getState: () => state,
    createdTemplates,
    invokedCapabilities,
    invokedUiActions,
    marketDataQueries,
    setUiNodes: (nodes: RemoteUiNodeSnapshot[]) => {
      uiNodes = nodes;
    },
  };
}

describe("createAppRemoteController", () => {
  const connectionDisposers: Array<() => void> = [];

  afterEach(() => {
    while (connectionDisposers.length > 0) connectionDisposers.pop()?.();
  });

  test("exposes schema, app snapshot, and semantic UI tree", async () => {
    const { controller } = createRegistryHarness();

    const schema = await controller.handle({ type: "schema" });
    expect(schema.ok).toBe(true);
    if (schema.ok) {
      const data = schema.data as RemoteControlSchema;
      expect(data.resources.some((resource) => resource.uri === "ui://tree")).toBe(true);
      expect(data.resources.some((resource) => resource.uri === "app://connections")).toBe(true);
      expect(data.operations.some((operation) => operation.id === "ui.invoke")).toBe(true);
      expect(data.help).toMatchObject({
        title: "Gloomberb remote control guide",
      });
      expect(JSON.stringify(data.help)).toContain("chart-composer-pane");
      expect(JSON.stringify(data.help)).toContain("POLY:fed-cut-september, FRED:FEDFUNDS");
      expect(JSON.stringify(data.help)).toContain("pane.show chart-composer is empty");
    }

    const help = await controller.handle({ type: "help" });
    expect(help.ok).toBe(true);
    if (help.ok) {
      expect(help.data).toMatchObject({
        batching: expect.any(Object),
      });
    }

    const snapshot = await controller.handle({ type: "get", resource: "app://snapshot" });
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) {
      const data = snapshot.data as { ui: unknown[] };
      expect(data.ui).toEqual([{ id: "ui:test", role: "button", label: "Test", actions: ["press"] }]);
      expect(typeof snapshot.rev).toBe("string");
    }
  });

  test("exposes pane types with settings fields and templates", async () => {
    const { controller } = createRegistryHarness();

    const response = await controller.handle({ type: "get", resource: "app://pane-types" });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toEqual([
        {
          id: TEST_PANE_ID,
          name: "Remote Test Pane",
          defaultPosition: "right",
          defaultMode: "docked",
          hasSettings: true,
          settingsTitle: "Remote Test Settings",
          fields: [{
            key: TEST_PANE_SETTING.key,
            label: TEST_PANE_SETTING.label,
            type: TEST_PANE_SETTING.type,
          }],
          templates: [{
            id: TEST_PANE_TEMPLATE.id,
            label: TEST_PANE_TEMPLATE.label,
            shortcut: TEST_PANE_TEMPLATE.shortcut,
          }],
        },
      ]);
    }
  });

  test("forwards pane.createFromTemplate options.arg", async () => {
    const { controller, createdTemplates } = createRegistryHarness();
    const response = await controller.handle({
      type: "call",
      operation: "pane.createFromTemplate",
      input: {
        templateId: "chart-composer-pane",
        options: { arg: "POLY:fed-cut-september, FRED:FEDFUNDS" },
      },
    });
    expect(response.ok).toBe(true);
    expect(createdTemplates).toEqual([{
      templateId: "chart-composer-pane",
      options: { arg: "POLY:fed-cut-september, FRED:FEDFUNDS" },
    }]);
  });

  test("exposes registered connection sources", async () => {
    const { controller } = createRegistryHarness();
    connectionDisposers.push(registerConnectionSource({
      id: "remote-test-api",
      name: "Remote Test API",
      kind: "api",
      pluginId: "remote-test",
    }));

    const response = await controller.handle({ type: "get", resource: "app://connections" });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toEqual(expect.arrayContaining([{
        id: "remote-test-api",
        name: "Remote Test API",
        kind: "api",
        pluginId: "remote-test",
        authRequired: true,
        isWebSocket: false,
      }]));
    }
  });

  test("queries configured market data without dispatching app-control actions", async () => {
    const { actions, controller, marketDataQueries } = createRegistryHarness();

    const search = await controller.handle({
      type: "data",
      operation: "search",
      query: "NVIDIA",
    });
    const quote = await controller.handle({
      type: "data",
      operation: "quote",
      symbol: "nvda",
      exchange: "nasdaq",
    });

    expect(search).toMatchObject({
      ok: true,
      data: [{ symbol: "NVDA", exchange: "NASDAQ" }],
    });
    expect(quote).toMatchObject({
      ok: true,
      data: { symbol: "NVDA", exchange: "NASDAQ", price: 180 },
    });
    expect(marketDataQueries).toEqual([
      { operation: "search", input: { query: "NVIDIA" } },
      { operation: "quote", input: { symbol: "NVDA", exchange: "NASDAQ" } },
    ]);
    expect(actions).toEqual([]);

    const appControlAttempt = await controller.handle({
      type: "data",
      operation: "app.openCommandBar",
      query: "NVDA",
    } as never);
    expect(appControlAttempt).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("Unknown market data operation") },
    });
    expect(actions).toEqual([]);
  });

  test("fetches FRED series through fetchPublicFredSeries without hitting the network", async () => {
    fredSeriesCalls.length = 0;
    const { actions, controller } = createRegistryHarness();

    const response = await controller.handle({
      type: "data",
      operation: "econ.series",
      seriesId: "fedfunds",
      limit: 1,
    });

    expect(response).toMatchObject({
      ok: true,
      data: {
        observations: [{ date: "2024-01-01", value: 5.25 }],
        info: { id: "FEDFUNDS", source: "FRED" },
      },
    });
    expect(fredSeriesCalls).toEqual([{
      seriesId: "fedfunds",
      params: { startDate: undefined, endDate: undefined, limit: 1 },
    }]);
    expect(actions).toEqual([]);

    const invalid = await controller.handle({
      type: "data",
      operation: "econ.series",
      seriesId: "not a series",
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("Invalid FRED series id") },
    });
  });

  test("returns watchlists and portfolios from config and ticker membership", async () => {
    const { controller } = createRegistryHarness();

    const watchlists = await controller.handle({ type: "data", operation: "watchlists.get" });
    expect(watchlists).toMatchObject({
      ok: true,
      data: {
        watchlists: [
          { id: "tech", name: "Tech", symbols: ["AAPL", "MSFT"] },
          { id: "empty", name: "Empty", symbols: [] },
          { id: "ghost", name: "ghost", symbols: ["NVDA"] },
        ],
      },
    });

    const portfolios = await controller.handle({ type: "data", operation: "portfolios.get" });
    expect(portfolios).toMatchObject({
      ok: true,
      data: {
        portfolios: [
          { id: "core", name: "Core", symbols: ["AAPL", "MSFT"] },
        ],
      },
    });
  });

  test("articles.search returns news_unavailable when no shared news service is set", async () => {
    setSharedNewsService(null);
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "articles.search",
      query: "fed",
    });
    expect(response).toEqual({
      ok: true,
      data: { articles: [], error: "news_unavailable" },
    });
  });

  test("unknown market data operations still fail closed", async () => {
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "nonexistent.data.op",
    } as never);
    expect(response).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("Unknown market data operation") },
    });
  });

  test("filings.rollup stacks Adjacent CFTC DCM products by org and month", async () => {
    adjacentClientCalls.length = 0;
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "filings.rollup",
      feed: "dcm_products",
    });
    expect(adjacentClientCalls.some((call) => call.method === "listFilings")).toBe(true);
    expect(response).toMatchObject({
      ok: true,
      data: {
        title: "Who filed DCM products",
        feed: "dcm_products",
        orgs: ["KEX"],
        totals: [1],
      },
    });
  });

  test("polls.list fetches VoteHub polls and caps at the limit", async () => {
    pollsCalls.length = 0;
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "polls.list",
      pollType: "approval",
      subject: "trump",
      limit: 1,
    });
    expect(response).toMatchObject({
      ok: true,
      data: { polls: [pollsSeed[0]] },
    });
    expect(pollsCalls).toEqual([{ pollType: "approval", subject: "trump" }]);
  });

  test("indices.list returns Adjacent indices from the shared client", async () => {
    adjacentClientCalls.length = 0;
    adjacentIndicesResponse = { data: [{ index_id: "spx", name: "S&P 500", ticker: "SPX" }] };
    const { controller } = createRegistryHarness();
    const response = await controller.handle({ type: "data", operation: "indices.list" });
    expect(response).toMatchObject({
      ok: true,
      data: { indices: [{ index_id: "spx", name: "S&P 500", ticker: "SPX" }] },
    });
    expect(adjacentClientCalls).toEqual([{ method: "getIndices" }]);
  });

  test("indices.get returns prices for a valid index id", async () => {
    adjacentClientCalls.length = 0;
    adjacentIndexPricesResponse = { data: [{ date: "2024-01-01", close: 100 }] };
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "indices.get",
      indexId: "spx",
    });
    expect(response).toMatchObject({
      ok: true,
      data: { prices: [{ date: "2024-01-01", close: 100 }] },
    });
    expect(adjacentClientCalls).toEqual([{ method: "getIndexPrices", arg: "spx" }]);

    const invalid = await controller.handle({
      type: "data",
      operation: "indices.get",
      indexId: "   ",
    });
    expect(invalid).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("indexId") },
    });
  });

  test("markets.search merges Kalshi and Polymarket catalogs and caps", async () => {
    kalshiCatalogCalls.length = 0;
    polymarketCatalogCalls.length = 0;
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "markets.search",
      query: "fed",
      category: "macro",
      limit: 2,
    });
    expect(response).toMatchObject({ ok: true });
    if (response.ok) {
      const data = response.data as { markets: { marketId: string }[] };
      expect(data.markets.map((market) => market.marketId)).toEqual(["KX-1", "KX-2"]);
    }
    expect(kalshiCatalogCalls).toEqual([{ query: "fed", category: "macro" }]);
    expect(polymarketCatalogCalls).toEqual([{ query: "fed", category: "macro" }]);
  });

  test("markets.get resolves a Kalshi market by ticker", async () => {
    kalshiResolveCalls.length = 0;
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "markets.get",
      venue: "kalshi",
      marketId: "KX-FED",
    });
    expect(response).toMatchObject({
      ok: true,
      data: { market: { marketId: "KX-FED", venue: "kalshi" } },
    });
    expect(kalshiResolveCalls).toEqual(["KX-FED"]);
  });

  test("markets.get resolves a Polymarket market by id", async () => {
    polymarketResolveCalls.length = 0;
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "markets.get",
      venue: "polymarket",
      marketId: "0xabc",
    });
    expect(response).toMatchObject({
      ok: true,
      data: { market: { marketId: "0xabc", venue: "polymarket" } },
    });
    expect(polymarketResolveCalls).toEqual(["0xabc"]);
  });

  test("markets.history loads history after resolving the summary", async () => {
    kalshiResolveCalls.length = 0;
    kalshiHistoryCalls.length = 0;
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "markets.history",
      venue: "kalshi",
      marketId: "KX-FED",
      range: "1M",
    });
    expect(response).toMatchObject({
      ok: true,
      data: { history: [{ close: 0.55 }] },
    });
    expect(kalshiResolveCalls).toEqual(["KX-FED"]);
    expect(kalshiHistoryCalls).toEqual([{ ticker: "KX-FED", range: "1M" }]);
  });

  test("markets.history defaults range to ALL", async () => {
    polymarketResolveCalls.length = 0;
    polymarketHistoryCalls.length = 0;
    const { controller } = createRegistryHarness();
    const response = await controller.handle({
      type: "data",
      operation: "markets.history",
      venue: "polymarket",
      marketId: "0xabc",
    });
    expect(response).toMatchObject({ ok: true, data: { history: [{ close: 0.62 }] } });
    expect(polymarketHistoryCalls).toEqual([{ marketId: "0xabc", range: "ALL" }]);
  });

  test("dispatches semantic app operations", async () => {
    const { actions, controller, getState } = createRegistryHarness();

    const response = await controller.handle({
      type: "call",
      operation: "app.openCommandBar",
      input: { query: "NVDA" },
    });

    expect(response.ok).toBe(true);
    expect(actions).toContainEqual({ type: "SET_COMMAND_BAR", open: true, query: "NVDA" });
    expect(getState().commandBarOpen).toBe(true);
    expect(getState().commandBarQuery).toBe("NVDA");
    if (response.ok) {
      expect(response.state?.commandBar).toMatchObject({
        open: true,
        stateQuery: "NVDA",
      });
    }
  });

  test("opens ticker search without requiring command-bar prefix syntax", async () => {
    const { actions, controller, getState } = createRegistryHarness();

    const response = await controller.handle({
      type: "call",
      operation: "app.search",
      input: { mode: "ticker", query: "google" },
    });

    expect(response.ok).toBe(true);
    expect(actions).toContainEqual({
      type: "SET_COMMAND_BAR",
      open: true,
      launch: { kind: "ticker-search", query: "google" },
    });
    expect(getState().commandBarOpen).toBe(true);
    expect(getState().commandBarLaunchRequest).toMatchObject({
      kind: "ticker-search",
      query: "google",
    });
  });

  test("exposes and activates semantic command-bar results", async () => {
    const { controller, invokedUiActions, setUiNodes } = createRegistryHarness();
    setUiNodes([
      {
        id: "ui:input",
        role: "input",
        actions: ["setValue"],
        metadata: { value: "T google", focused: true },
      },
      {
        id: "ui:goog",
        role: "command-bar-result",
        label: "GOOG",
        actions: ["activate"],
        metadata: {
          index: 1,
          selected: false,
          item: {
            id: "ticker:GOOG",
            label: "GOOG",
            detail: "Alphabet Inc.",
            category: "Primary Listing",
            kind: "ticker",
            right: "Equity NASDAQ",
          },
        },
      },
    ]);

    const results = await controller.handle({ type: "get", resource: "app://command-bar/results" });
    expect(results.ok).toBe(true);
    if (results.ok) {
      expect(results.data).toMatchObject([
        {
          nodeId: "ui:goog",
          index: 1,
          label: "GOOG",
          kind: "ticker",
          right: "Equity NASDAQ",
        },
      ]);
    }

    const activated = await controller.handle({
      type: "call",
      operation: "commandBar.activateResult",
      input: { index: 1 },
    });
    expect(activated.ok).toBe(true);
    expect(invokedUiActions).toContainEqual({ nodeId: "ui:goog", action: "activate", input: undefined });
  });

  test("scopes command-bar query reads to the command-bar input", async () => {
    const { controller, setUiNodes } = createRegistryHarness();
    setUiNodes([
      {
        id: "ui:pane-input",
        role: "input",
        actions: ["setValue"],
        metadata: { value: "pane search", focused: true },
      },
      {
        id: "ui:command-input",
        role: "input",
        actions: ["setValue"],
        metadata: { value: "theme", focused: true, scope: "command-bar" },
      },
    ]);

    const response = await controller.handle({ type: "get", resource: "app://command-bar" });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect((response.data as { query: string }).query).toBe("theme");
    }
  });

  test("exposes shared list items as command-bar results", async () => {
    const { controller, invokedUiActions, setUiNodes } = createRegistryHarness();
    setUiNodes([
      {
        id: "ui:theme-list",
        role: "list",
        label: "Theme picker",
        actions: ["activate", "select"],
        metadata: {
          scope: "command-bar",
          selectedIndex: 1,
          itemKind: "theme",
          items: [
            { index: 0, id: "github-dark", label: "GitHub Dark", kind: "theme", category: "Themes" },
            { index: 1, id: "github-light", label: "GitHub Light", kind: "theme", category: "Themes", current: true },
          ],
        },
      },
    ]);

    const results = await controller.handle({ type: "get", resource: "app://command-bar/results" });
    expect(results.ok).toBe(true);
    if (results.ok) {
      expect(results.data).toMatchObject([
        { nodeId: "ui:theme-list", index: 0, label: "GitHub Dark", kind: "theme", itemId: "github-dark" },
        { nodeId: "ui:theme-list", index: 1, label: "GitHub Light", kind: "theme", itemId: "github-light", selected: true },
      ]);
    }

    const activated = await controller.handle({
      type: "call",
      operation: "commandBar.activateResult",
      input: { label: "GitHub Light" },
    });
    expect(activated.ok).toBe(true);
    expect(invokedUiActions).toContainEqual({
      nodeId: "ui:theme-list",
      action: "activate",
      input: { index: 1, id: "github-light", label: "GitHub Light" },
    });
  });

  test("invokes semantic UI nodes by selector", async () => {
    const { controller, invokedUiActions, setUiNodes } = createRegistryHarness();
    setUiNodes([
      { id: "ui:cancel", role: "button", label: "Cancel", actions: ["press"] },
      { id: "ui:done", role: "button", label: "Done", actions: ["press"], metadata: { scope: "command-bar" } },
    ]);

    const response = await controller.handle({
      type: "call",
      operation: "ui.invokeMatching",
      input: { role: "button", label: "Done", action: "press" },
    });

    expect(response.ok).toBe(true);
    expect(invokedUiActions).toContainEqual({ nodeId: "ui:done", action: "press", input: undefined });

    const directResponse = await controller.handle({
      type: "call",
      operation: "ui.invoke",
      input: { nodeId: "ui:done", action: "press" },
    });
    expect(directResponse.ok).toBe(true);
    if (directResponse.ok) {
      expect(directResponse.data).toMatchObject({
        ok: true,
        result: { nodeId: "ui:done", action: "press" },
      });
    }
  });

  test("forwards plugin capability operations without narrowing their payload", async () => {
    const { controller, invokedCapabilities } = createRegistryHarness();
    const payload = {
      instanceId: "broker-main",
      operation: "placeOrder",
      args: [{ symbol: "NVDA", side: "BUY", quantity: 5 }],
    };

    const response = await controller.handle({
      type: "call",
      operation: "capability.invoke",
      input: {
        capabilityId: "desktop.broker",
        operationId: "invoke",
        payload,
      },
    });

    expect(response.ok).toBe(true);
    expect(invokedCapabilities).toEqual([{
      capabilityId: "desktop.broker",
      operationId: "invoke",
      payload,
    }]);
    if (response.ok) {
      expect(response.data).toEqual({
        invoked: true,
        capabilityId: "desktop.broker",
        operationId: "invoke",
        payload,
      });
    }
  });

  test("fails closed on a batch without requests instead of throwing", async () => {
    const { controller } = createRegistryHarness();
    const response = await controller.handle({ type: "batch" } as never);
    expect(response).toEqual({
      ok: false,
      error: {
        code: "invalid_request",
        message: "batch request is missing requests.",
      },
    });
  });

  test("runs sequential batches with halt-on-error and final state", async () => {
    const { controller } = createRegistryHarness();

    const response = await controller.handle({
      type: "batch",
      include: ["commandBar"],
      requests: [
        { type: "call", operation: "app.openCommandBar", input: { query: "theme" } },
        { type: "call", operation: "missing.operation", input: {} },
        { type: "call", operation: "app.closeCommandBar", input: {} },
      ],
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.data).toMatchObject({
        ok: false,
        haltedAt: 1,
      });
      expect((response.data as { responses: unknown[] }).responses).toHaveLength(2);
      expect(response.state?.commandBar).toMatchObject({
        open: true,
      });
    }
  });

  test("patches pane runtime state with replace semantics", async () => {
    const { controller, getState } = createRegistryHarness();
    const paneId = getState().config.layout.instances[0]!.instanceId;
    await controller.handle({
      type: "call",
      operation: "pane.setState",
      input: { paneId, patch: { cursorSymbol: "NVDA", stale: true } },
    });

    const response = await controller.handle({
      type: "patch",
      resource: `app://pane-state/${encodeURIComponent(paneId)}`,
      patch: [{ op: "remove", path: "/stale" }],
    });

    expect(response.ok).toBe(true);
    expect(getState().paneState[paneId]).toMatchObject({ cursorSymbol: "NVDA" });
    expect(getState().paneState[paneId]?.stale).toBeUndefined();
  });

  test("layout.new appends a desk and activates it", async () => {
    const { actions, controller, getState } = createRegistryHarness();
    const beforeCount = getState().config.layouts.length;

    const response = await controller.handle({
      type: "call",
      operation: "layout.new",
      input: { name: "Democrats" },
    });

    expect(response.ok).toBe(true);
    expect(actions).toEqual([{ type: "NEW_LAYOUT", name: "Democrats", activate: true }]);
    expect(getState().config.layouts.at(-1)?.name).toBe("Democrats");
    expect(getState().config.activeLayoutIndex).toBe(beforeCount);
    expect(getState().config.layout).toEqual(getState().config.layouts[beforeCount]!.layout);
  });

  test("layout.new stays on the current desk when activate is false", async () => {
    const { controller, getState } = createRegistryHarness();
    const before = getState();
    const activeIndex = before.config.activeLayoutIndex;
    const layout = before.config.layout;

    const response = await controller.handle({
      type: "call",
      operation: "layout.new",
      input: { name: "Scratch", activate: false },
    });

    expect(response.ok).toBe(true);
    expect(getState().config.layouts.at(-1)?.name).toBe("Scratch");
    expect(getState().config.activeLayoutIndex).toBe(activeIndex);
    expect(getState().config.layout).toBe(layout);
  });

  test("layout.new with panes seeds instances and dock root and activates", async () => {
    const { controller, getState } = createRegistryHarness();
    const beforeCount = getState().config.layouts.length;

    const response = await controller.handle({
      type: "call",
      operation: "layout.new",
      input: { name: "Democrats", panes: [TEST_PANE_ID] },
    });

    expect(response.ok).toBe(true);
    expect(getState().config.activeLayoutIndex).toBe(beforeCount);
    expect(getState().config.layout).toEqual(getState().config.layouts[beforeCount]!.layout);
    const saved = getState().config.layouts.at(-1)!;
    expect(saved.name).toBe("Democrats");
    expect(saved.layout.instances.map((p) => p.paneId)).toContain(TEST_PANE_ID);
    expect(saved.layout.dockRoot).not.toBeNull();
  });

  test("layout.new with unknown pane id fails closed", async () => {
    const { controller, getState } = createRegistryHarness();
    const before = getState().config.layouts.length;

    const response = await controller.handle({
      type: "call",
      operation: "layout.new",
      input: { name: "Bad", panes: ["nonexistent-pane"] },
    });

    expect(response.ok).toBe(false);
    expect(getState().config.layouts.length).toBe(before);
  });

  test("layout.new resolves template id to pane id", async () => {
    const { controller, getState } = createRegistryHarness();

    const response = await controller.handle({
      type: "call",
      operation: "layout.new",
      input: { name: "Templated", panes: [TEST_PANE_TEMPLATE.id] },
    });

    expect(response.ok).toBe(true);
    const saved = getState().config.layouts.at(-1)!;
    expect(saved.layout.instances.map((p) => p.paneId)).toContain(TEST_PANE_ID);
    expect(saved.layout.dockRoot).not.toBeNull();
  });

  test("layout.open switches by name, including a layout created in the same batch", async () => {
    const { controller, getState } = createRegistryHarness();
    const created = await controller.handle({
      type: "call",
      operation: "layout.new",
      input: { name: "Democrats", activate: false },
    });
    expect(created.ok).toBe(true);
    const startingIndex = getState().config.activeLayoutIndex;
    const startingLayout = getState().config.layout;
    expect(getState().config.layouts.at(-1)?.name).toBe("Democrats");
    expect(getState().config.activeLayoutIndex).toBe(startingIndex);
    expect(getState().config.layout).toBe(startingLayout);

    const opened = await controller.handle({
      type: "batch",
      requests: [
        { type: "call", operation: "layout.new", input: { name: "Republicans", activate: false } },
        { type: "call", operation: "layout.open", input: { name: "republicans" } },
      ],
    });

    expect(opened.ok).toBe(true);
    expect(getState().config.layouts.at(-1)?.name).toBe("Republicans");
    expect(getState().config.activeLayoutIndex).toBe(getState().config.layouts.length - 1);
    expect(getState().config.layout).toEqual(getState().config.layouts.at(-1)!.layout);
  });

  test("layout.open switches by index", async () => {
    const { controller, getState } = createRegistryHarness();
    await controller.handle({ type: "call", operation: "layout.new", input: { name: "Alpha" } });
    await controller.handle({ type: "call", operation: "layout.new", input: { name: "Beta" } });
    const betaIndex = getState().config.layouts.findIndex((layout) => layout.name === "Beta");

    const response = await controller.handle({
      type: "call",
      operation: "layout.open",
      input: { index: betaIndex },
    });

    expect(response.ok).toBe(true);
    expect(getState().config.activeLayoutIndex).toBe(betaIndex);
  });

  test("closes floating panes and grids visible panes through layout helpers", async () => {
    const { controller, getState } = createRegistryHarness({ withFloatingPane: true });
    expect(getState().config.layout.floating.length).toBeGreaterThan(0);

    const closeResponse = await controller.handle({
      type: "call",
      operation: "layout.closeFloating",
      input: {},
    });
    expect(closeResponse.ok).toBe(true);
    expect(getState().config.layout.floating).toEqual([]);

    const paneIds = getState().config.layout.instances.slice(0, 4).map((pane) => pane.instanceId);
    const gridResponse = await controller.handle({
      type: "call",
      operation: "layout.setGrid",
      input: { paneIds, columns: 2 },
    });
    expect(gridResponse.ok).toBe(true);
    expect(getState().config.layout.dockRoot).toMatchObject({
      kind: "split",
      axis: "vertical",
    });
  });
});
