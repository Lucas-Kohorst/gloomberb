import type { Dispatch } from "react";
import { fetchPublicFredSeries } from "../data/fred-public";
import { getSharedNewsService } from "../news/hooks";
import type { NewsQuery } from "../news/types";
import { searchNewsArticles } from "../plugins/builtin/news/wire/article-search";
import { fetchVoteHubPolls } from "../plugins/builtin/polls/client";
import { getSharedAdjacentClient, loadCftcFilingsFeed } from "../plugins/builtin/adjacent/client";
import { rollupCftcFilingsByOrgMonth } from "../plugins/builtin/adjacent/filings-rollup";
import type { CftcFeed } from "../plugins/builtin/adjacent/types";
import { loadKalshiCatalog, resolveKalshiMarketByTicker, loadKalshiHistory } from "../plugins/prediction-markets/services/kalshi/adapter";
import { loadPolymarketCatalog } from "../plugins/prediction-markets/services/polymarket/adapter";
import { resolvePolymarketMarketById, loadPolymarketHistory } from "../plugins/prediction-markets/services/polymarket/detail";
import type { PredictionCategoryId } from "../plugins/prediction-markets/categories";
import {
  dockPane,
  floatPane,
  getDockLeafLayouts,
  gridlockAllPanes,
  insertAtRootEdge,
  removeFloatingPanes,
} from "../plugins/pane-manager";
import type { PluginRegistry } from "../plugins/registry";
import type { AppAction, AppState } from "../state/app/context";
import { setPaneSettings } from "../pane-settings";
import type { DesktopWindowBridge } from "../types/desktop-window";
import type { TickerRecord } from "../types/ticker";
import { applyJsonPatch } from "./json-patch";
import { revisionFor } from "./revision";
import type {
  RemoteControlRequest,
  RemoteControlResponse,
  RemoteJsonPatchOperation,
  RemoteMarketDataRequest,
  RemoteStateInclude,
} from "./types";
import type { RemoteUiRegistry } from "./semantic-tree";
import { commandBarResultsFromNodes, isCommandBarInputNode } from "./command-bar";
import { REMOTE_AGENT_HELP, remoteControlSchema } from "./schema";
import {
  asRecord,
  fail,
  mutationSummary,
  numberInput,
  ok,
  optionalNumber,
  optionalString,
  stringInput,
} from "./controller-utils";
import {
  buildGridDockRoot,
  buildSeededLayout,
  regionToDockPosition,
  regionToRootEdge,
  requirePaneInstance,
  visiblePaneIds,
} from "./layout-helpers";
import { createRemoteResources } from "./resources";

interface AppRemoteControllerOptions {
  dispatch: Dispatch<AppAction>;
  getState: () => AppState;
  pluginRegistry: PluginRegistry;
  uiRegistry: RemoteUiRegistry | null;
  desktopWindowBridge?: DesktopWindowBridge;
  afterMutation?: () => Promise<void> | void;
}

const DEFAULT_MUTATION_INCLUDE: RemoteStateInclude[] = ["app", "layout", "panes", "commandBar"];
const MAX_MARKET_DATA_SEARCH_RESULTS = 20;
const MAX_MARKET_DATA_FILINGS = 20;
const MAX_MARKET_DATA_EARNINGS_SYMBOLS = 25;
const MAX_MARKET_DATA_HOLDERS = 25;
const MAX_MARKET_DATA_EVENT_ROWS = 20;
const MAX_ECON_SERIES_OBSERVATIONS = 400;
const MAX_ARTICLE_SEARCH_RESULTS = 50;
const MAX_POLLS_RESULTS = 100;
const MAX_PREDICTION_MARKETS_RESULTS = 50;

function tickerBelongsToCollection(
  ticker: TickerRecord,
  collectionId: string,
  kind: "watchlists" | "portfolios",
): boolean {
  if (ticker.metadata[kind]?.includes(collectionId)) return true;
  return kind === "portfolios"
    && (ticker.metadata.positions ?? []).some((position) => position.portfolio === collectionId);
}

function symbolsForCollection(
  tickers: Map<string, TickerRecord>,
  collectionId: string,
  kind: "watchlists" | "portfolios",
): string[] {
  const symbols: string[] = [];
  for (const [key, ticker] of tickers) {
    if (tickerBelongsToCollection(ticker, collectionId, kind)) symbols.push(key);
  }
  return symbols;
}

function slimCollections(
  defined: Array<{ id: string; name: string }>,
  tickers: Map<string, TickerRecord>,
  kind: "watchlists" | "portfolios",
): Array<{ id: string; name: string; symbols: string[] }> {
  const seen = new Set<string>();
  const collections: Array<{ id: string; name: string; symbols: string[] }> = [];
  for (const collection of defined) {
    if (seen.has(collection.id)) continue;
    seen.add(collection.id);
    collections.push({
      id: collection.id,
      name: collection.name,
      symbols: symbolsForCollection(tickers, collection.id, kind),
    });
  }
  for (const ticker of tickers.values()) {
    const ids = [
      ...(ticker.metadata[kind] ?? []),
      ...(kind === "portfolios" ? (ticker.metadata.positions ?? []).map((position) => position.portfolio) : []),
    ];
    for (const id of ids) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      collections.push({
        id,
        name: id,
        symbols: symbolsForCollection(tickers, id, kind),
      });
    }
  }
  return collections;
}

function publishedAtIso(value: Date | string | undefined): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

function requiredMarketDataText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Market data ${field} is required.`);
  return normalized;
}

function normalizedMarketDataSymbol(symbol: string): string {
  return requiredMarketDataText(symbol, "symbol").toUpperCase();
}

function normalizedOptionalExchange(exchange: string | undefined): string | undefined {
  const normalized = exchange?.trim().toUpperCase();
  return normalized || undefined;
}

export function createAppRemoteController({
  dispatch,
  getState,
  pluginRegistry,
  uiRegistry,
  desktopWindowBridge,
  afterMutation = () => {},
}: AppRemoteControllerOptions) {
  const { buildIncludedState, getResource, patchTarget } = createRemoteResources({
    dispatch,
    getState,
    pluginRegistry,
    uiRegistry,
  });

  const getAfterMutationSummary = async (extra?: Record<string, unknown>): Promise<unknown> => {
    await afterMutation();
    return mutationSummary(getState(), extra);
  };

  const queryMarketData = async (request: RemoteMarketDataRequest): Promise<unknown> => {
    const marketData = pluginRegistry.marketData;
    switch (request.operation) {
      case "search":
        return (await marketData.search(requiredMarketDataText(request.query, "query")))
          .slice(0, MAX_MARKET_DATA_SEARCH_RESULTS)
          .map((result) => ({
            providerId: result.providerId,
            symbol: result.symbol,
            name: result.name,
            exchange: result.exchange,
            primaryExchange: result.primaryExchange,
            type: result.type,
            currency: result.currency,
          }));
      case "quote":
        return marketData.getQuote(
          normalizedMarketDataSymbol(request.symbol),
          normalizedOptionalExchange(request.exchange),
        );
      case "financials": {
        const financials = await marketData.getTickerFinancials(
          normalizedMarketDataSymbol(request.symbol),
          normalizedOptionalExchange(request.exchange),
        );
        return {
          quote: financials.quote,
          fundamentals: financials.fundamentals,
          profile: financials.profile,
          annualStatements: financials.annualStatements.slice(0, 5),
          quarterlyStatements: financials.quarterlyStatements.slice(0, 8),
        };
      }
      case "secFilings": {
        if (!marketData.getSecFilings) throw new Error("The configured market data sources do not provide SEC filings.");
        const count = Math.max(1, Math.min(
          MAX_MARKET_DATA_FILINGS,
          Number.isFinite(request.count) ? Math.trunc(request.count!) : 10,
        ));
        return (await marketData.getSecFilings(
          normalizedMarketDataSymbol(request.symbol),
          count,
          normalizedOptionalExchange(request.exchange),
        )).slice(0, count);
      }
      case "holders": {
        if (!marketData.getHolders) throw new Error("The configured market data sources do not provide holder data.");
        const holders = await marketData.getHolders(
          normalizedMarketDataSymbol(request.symbol),
          normalizedOptionalExchange(request.exchange),
        );
        return {
          ...holders,
          holders: holders.holders.slice(0, MAX_MARKET_DATA_HOLDERS),
        };
      }
      case "analystResearch": {
        if (!marketData.getAnalystResearch) throw new Error("The configured market data sources do not provide analyst research.");
        const research = await marketData.getAnalystResearch(
          normalizedMarketDataSymbol(request.symbol),
          normalizedOptionalExchange(request.exchange),
        );
        return {
          ...research,
          recommendations: research.recommendations.slice(0, MAX_MARKET_DATA_EVENT_ROWS),
          ratings: research.ratings.slice(0, MAX_MARKET_DATA_EVENT_ROWS),
          earningsEstimates: research.earningsEstimates.slice(0, MAX_MARKET_DATA_EVENT_ROWS),
          revenueEstimates: research.revenueEstimates.slice(0, MAX_MARKET_DATA_EVENT_ROWS),
        };
      }
      case "corporateActions": {
        if (!marketData.getCorporateActions) throw new Error("The configured market data sources do not provide corporate actions.");
        const actions = await marketData.getCorporateActions(
          normalizedMarketDataSymbol(request.symbol),
          normalizedOptionalExchange(request.exchange),
        );
        return {
          ...actions,
          dividends: actions.dividends.slice(0, MAX_MARKET_DATA_EVENT_ROWS),
          splits: actions.splits.slice(0, MAX_MARKET_DATA_EVENT_ROWS),
          earnings: actions.earnings.slice(0, MAX_MARKET_DATA_EVENT_ROWS),
        };
      }
      case "earningsCalendar": {
        if (!marketData.getEarningsCalendar) throw new Error("The configured market data sources do not provide an earnings calendar.");
        const symbols = request.symbols
          .map((symbol) => normalizedMarketDataSymbol(symbol))
          .filter((symbol, index, all) => all.indexOf(symbol) === index)
          .slice(0, MAX_MARKET_DATA_EARNINGS_SYMBOLS);
        if (symbols.length === 0) throw new Error("Market data symbols are required.");
        return marketData.getEarningsCalendar(symbols);
      }
      case "econ.series": {
        const limit = Math.min(
          Number.isFinite(request.limit) ? Math.max(1, Math.trunc(request.limit!)) : MAX_ECON_SERIES_OBSERVATIONS,
          MAX_ECON_SERIES_OBSERVATIONS,
        );
        const payload = await fetchPublicFredSeries(requiredMarketDataText(request.seriesId, "seriesId"), {
          startDate: request.startDate,
          endDate: request.endDate,
          limit,
        });
        return {
          ...payload,
          observations: payload.observations.slice(0, limit),
        };
      }
      case "watchlists.get": {
        const state = getState();
        return {
          watchlists: slimCollections(state.config.watchlists ?? [], state.tickers, "watchlists"),
        };
      }
      case "portfolios.get": {
        const state = getState();
        return {
          portfolios: slimCollections(state.config.portfolios ?? [], state.tickers, "portfolios"),
        };
      }
      case "articles.search": {
        const service = getSharedNewsService();
        if (!service) return { articles: [], error: "news_unavailable" };
        const limit = Math.min(
          Number.isFinite(request.limit) ? Math.max(1, Math.trunc(request.limit!)) : MAX_ARTICLE_SEARCH_RESULTS,
          MAX_ARTICLE_SEARCH_RESULTS,
        );
        const query: NewsQuery = {
          feed: request.feed ?? (request.ticker ? "ticker" : "latest"),
          ticker: request.ticker,
          limit: MAX_ARTICLE_SEARCH_RESULTS,
        };
        const loaded = await service.load(query);
        const matched = request.query
          ? searchNewsArticles(loaded.articles, request.query, limit)
          : loaded.articles.slice(0, limit);
        return {
          articles: matched.map((article) => ({
            id: article.id,
            title: article.title,
            source: article.source,
            url: article.url,
            publishedAt: publishedAtIso(article.publishedAt),
            ...(article.tickers?.length ? { tickers: article.tickers } : {}),
          })),
        };
      }
      case "polls.list": {
        const limit = Math.min(
          Number.isFinite(request.limit) ? Math.max(1, Math.trunc(request.limit!)) : MAX_POLLS_RESULTS,
          MAX_POLLS_RESULTS,
        );
        const polls = await fetchVoteHubPolls({ pollType: request.pollType, subject: request.subject });
        return { polls: polls.slice(0, limit) };
      }
      case "indices.list": {
        const response = await getSharedAdjacentClient().getIndices();
        return { indices: response.data ?? [] };
      }
      case "indices.get": {
        const response = await getSharedAdjacentClient().getIndexPrices(
          requiredMarketDataText(request.indexId, "indexId"),
        );
        return { prices: response.data ?? [] };
      }
      case "markets.search": {
        const limit = Math.min(
          Number.isFinite(request.limit) ? Math.max(1, Math.trunc(request.limit!)) : MAX_PREDICTION_MARKETS_RESULTS,
          MAX_PREDICTION_MARKETS_RESULTS,
        );
        const category = request.category as PredictionCategoryId | undefined;
        const [kalshi, polymarket] = await Promise.all([
          loadKalshiCatalog(request.query ?? "", category, "top"),
          loadPolymarketCatalog(request.query ?? "", category, "top"),
        ]);
        return { markets: [...kalshi, ...polymarket].slice(0, limit) };
      }
      case "markets.get": {
        const marketId = requiredMarketDataText(request.marketId, "marketId");
        const market = request.venue === "kalshi"
          ? await resolveKalshiMarketByTicker(marketId)
          : await resolvePolymarketMarketById(marketId);
        return { market };
      }
      case "markets.history": {
        const marketId = requiredMarketDataText(request.marketId, "marketId");
        const range = request.range ?? "ALL";
        const summary = request.venue === "kalshi"
          ? await resolveKalshiMarketByTicker(marketId)
          : await resolvePolymarketMarketById(marketId);
        if (!summary) return { history: [] };
        const history = request.venue === "kalshi"
          ? await loadKalshiHistory(summary, range)
          : await loadPolymarketHistory(summary, range);
        return { history };
      }
      case "filings.list": {
        const feed = request.feed as CftcFeed | undefined;
        const client = getSharedAdjacentClient();
        const filings = await loadCftcFilingsFeed(client, {
          feed,
          search: request.search,
          maxPages: 1,
          perPage: Math.min(
            Number.isFinite(request.limit) ? Math.max(1, Math.trunc(request.limit!)) : 50,
            100,
          ),
        });
        return {
          publicWindow: client.isPublic,
          filings: filings.map((filing) => ({
            id: filing.id,
            title: filing.title,
            feed: filing.feed,
            org: filing.orgCode,
            status: filing.status,
            statusDate: filing.statusDate.toISOString(),
            productName: filing.productName ?? null,
          })),
        };
      }
      case "filings.rollup": {
        const feed = (request.feed ?? "dcm_products") as CftcFeed;
        const client = getSharedAdjacentClient();
        const filings = await loadCftcFilingsFeed(client, {
          feed,
          search: request.search,
        });
        return rollupCftcFilingsByOrgMonth(filings, {
          feed,
          publicWindow: client.isPublic,
        });
      }
      default:
        throw new Error(
          `Unknown market data operation "${String((request as { operation?: unknown }).operation)}".`,
        );
    }
  };

  const openCommandBar = async (input: Record<string, unknown>): Promise<unknown> => {
    const mode = optionalString(input, "mode") ?? "command";
    const query = optionalString(input, "query") ?? "";
    if (getState().commandBarOpen) {
      dispatch({ type: "SET_COMMAND_BAR", open: false });
      await afterMutation();
    }
    if (mode === "ticker") {
      dispatch({ type: "SET_COMMAND_BAR", open: true, launch: { kind: "ticker-search", query } });
      await afterMutation();
      return mutationSummary(getState(), { commandBar: getResource("app://command-bar") });
    }
    if (mode !== "command" && mode !== "default") {
      throw new Error(`Unsupported command-bar mode "${mode}".`);
    }
    dispatch({ type: "SET_COMMAND_BAR", open: true, query });
    await afterMutation();
    return mutationSummary(getState(), { commandBar: getResource("app://command-bar") });
  };

  const setVisibleCommandBarQuery = async (query: string): Promise<void> => {
    dispatch({ type: "SET_COMMAND_BAR_QUERY", query });
    await afterMutation();
    const inputNode = (uiRegistry?.snapshot() ?? [])
      .find((node) => isCommandBarInputNode(node) && node.metadata?.focused === true && node.actions.includes("setValue"));
    if (!inputNode) return;
    if (inputNode.metadata?.value === query) return;
    await uiRegistry?.invoke(inputNode.id, "setValue", { value: query });
    await afterMutation();
  };

  const activateCommandBarResult = async (input: Record<string, unknown>): Promise<unknown> => {
    const nodeId = optionalString(input, "nodeId");
    const index = optionalNumber(input, "index");
    const itemId = optionalString(input, "itemId");
    const label = optionalString(input, "label");
    const results = commandBarResultsFromNodes(uiRegistry?.snapshot() ?? []);
    const result = nodeId
      ? results.find((entry) => entry.nodeId === nodeId)
      : itemId
        ? results.find((entry) => entry.itemId === itemId)
        : label
          ? results.find((entry) => entry.label === label)
      : typeof index === "number"
        ? results.find((entry) => entry.index === index)
        : results.find((entry) => entry.selected) ?? results[0];
    if (!result) throw new Error("No matching command-bar result is visible.");
    if (!result.actions.includes("activate")) {
      throw new Error(`Command-bar result "${result.nodeId}" does not expose activate.`);
    }
    await uiRegistry?.invoke(result.nodeId, "activate", result.actionInput);
    return getAfterMutationSummary({ activatedResult: result });
  };

  const invokeMatchingUiNode = async (input: Record<string, unknown>): Promise<unknown> => {
    const role = optionalString(input, "role");
    const label = optionalString(input, "label");
    const contains = optionalString(input, "contains");
    const index = optionalNumber(input, "index");
    const action = optionalString(input, "action") ?? "press";
    const metadataFilter = asRecord(input.metadata);
    const candidates = (uiRegistry?.snapshot() ?? []).filter((node) => {
      if (role && node.role !== role) return false;
      if (label && node.label !== label && node.metadata?.item && typeof node.metadata.item === "object") {
        const item = node.metadata.item as Record<string, unknown>;
        if (item.label !== label && item.id !== label) return false;
      } else if (label && node.label !== label) {
        return false;
      }
      if (contains) {
        const haystack = [
          node.label,
          node.role,
          JSON.stringify(node.metadata ?? {}),
        ].filter((entry): entry is string => typeof entry === "string").join(" ").toLowerCase();
        if (!haystack.includes(contains.toLowerCase())) return false;
      }
      for (const [key, value] of Object.entries(metadataFilter)) {
        if (node.metadata?.[key] !== value) return false;
      }
      if (!node.actions.includes(action)) return false;
      if (node.disabled) return false;
      return true;
    });
    const node = typeof index === "number" ? candidates[index] : candidates[0];
    if (!node) throw new Error("No matching semantic UI node is visible.");
    const result = await uiRegistry?.invoke(node.id, action, input.input);
    return getAfterMutationSummary({ invokedNode: node, result });
  };

  const call = async (operation: string, rawInput: unknown, dryRun?: boolean): Promise<unknown> => {
    const input = asRecord(rawInput);
    const dryRunResult = () => ({ operation, input, dryRun: true });
    if (dryRun) return dryRunResult();

    switch (operation) {
      case "app.openCommandBar":
        return openCommandBar(input);
      case "app.closeCommandBar":
        dispatch({ type: "SET_COMMAND_BAR", open: false });
        return getAfterMutationSummary();
      case "app.setCommandBarQuery":
        await setVisibleCommandBarQuery(stringInput(input, "query"));
        return mutationSummary(getState(), { commandBar: getResource("app://command-bar") });
      case "app.search":
        return openCommandBar(input);
      case "app.switchPanel":
        dispatch({ type: "SET_ACTIVE_PANEL", panel: input.panel === "right" ? "right" : "left" });
        return getAfterMutationSummary();
      case "app.notify":
        pluginRegistry.notify({ body: stringInput(input, "body"), type: input.type as never });
        return null;
      case "commandBar.activateResult":
        return activateCommandBarResult(input);
      case "pane.show":
        pluginRegistry.showPane(stringInput(input, "paneId"));
        return getAfterMutationSummary();
      case "pane.focus":
        pluginRegistry.focusPane(stringInput(input, "paneId"));
        return getAfterMutationSummary();
      case "pane.close": {
        const paneId = stringInput(input, "paneId");
        pluginRegistry.hidePane(paneId);
        return getAfterMutationSummary({ affectedPaneIds: [paneId] });
      }
      case "pane.createFromTemplate":
        await pluginRegistry.createPaneFromTemplateAsyncFn(
          stringInput(input, "templateId"),
          asRecord(input.options),
        );
        return getAfterMutationSummary();
      case "pane.setState":
        dispatch({
          type: "UPDATE_PANE_STATE",
          paneId: stringInput(input, "paneId"),
          patch: asRecord(input.patch),
        });
        return getAfterMutationSummary({ affectedPaneIds: [stringInput(input, "paneId")] });
      case "pane.setSetting": {
        const paneId = stringInput(input, "paneId");
        const key = stringInput(input, "key");
        const descriptor = pluginRegistry.resolvePaneSettings(paneId);
        const field = descriptor?.settingsDef.fields.find((entry) => entry.key === key);
        if (field) {
          await pluginRegistry.applyPaneSettingValueFn(descriptor!.paneId, field, input.value);
        } else {
          const instanceId = descriptor?.paneId ?? paneId;
          const current = pluginRegistry.resolvePaneSettings(instanceId)?.context.settings ?? {};
          pluginRegistry.updateLayoutFn(setPaneSettings(getState().config.layout, instanceId, {
            ...current,
            [key]: input.value,
          }));
        }
        return getAfterMutationSummary({ affectedPaneIds: [paneId] });
      }
      case "ticker.navigate":
        pluginRegistry.navigateTicker(stringInput(input, "symbol"), { sourcePaneId: optionalString(input, "sourcePaneId") });
        return getAfterMutationSummary({ symbol: stringInput(input, "symbol") });
      case "ticker.pin":
        pluginRegistry.pinTicker(stringInput(input, "symbol"), {
          floating: input.floating === true,
          forceNewPane: input.forceNewPane === true,
          paneType: optionalString(input, "paneType"),
        });
        return getAfterMutationSummary({ symbol: stringInput(input, "symbol") });
      case "ticker.select":
        pluginRegistry.selectTicker(stringInput(input, "symbol"), optionalString(input, "paneId"));
        return getAfterMutationSummary({ symbol: stringInput(input, "symbol") });
      case "ticker.switchTab":
        pluginRegistry.switchTab(stringInput(input, "tabId"), optionalString(input, "paneId"));
        return getAfterMutationSummary({ tabId: stringInput(input, "tabId") });
      case "layout.switch":
        dispatch({ type: "SWITCH_LAYOUT", index: numberInput(input, "index") });
        return getAfterMutationSummary();
      case "layout.new": {
        const panesInput = Array.isArray(input.panes) ? input.panes as unknown[] : undefined;
        const layout = panesInput && panesInput.length > 0
          ? buildSeededLayout(panesInput, pluginRegistry.panes, pluginRegistry.paneTemplates)
          : undefined;
        dispatch({
          type: "NEW_LAYOUT",
          name: stringInput(input, "name"),
          activate: input.activate !== false,
          ...(layout ? { layout } : {}),
        });
        return getAfterMutationSummary();
      }
      case "layout.open": {
        const index = optionalNumber(input, "index");
        const name = optionalString(input, "name");
        let target = index;
        if (target === undefined) {
          if (!name) throw new Error("name or index is required.");
          const needle = name.toLowerCase();
          target = getState().config.layouts.findIndex((layout) => layout.name.toLowerCase() === needle);
          if (target < 0) throw new Error(`No layout named "${name}".`);
        }
        dispatch({ type: "SWITCH_LAYOUT", index: target });
        return getAfterMutationSummary();
      }
      case "layout.rename":
        dispatch({ type: "RENAME_LAYOUT", index: numberInput(input, "index"), name: stringInput(input, "name") });
        return getAfterMutationSummary();
      case "layout.duplicate":
        dispatch({ type: "DUPLICATE_LAYOUT", index: numberInput(input, "index") });
        return getAfterMutationSummary();
      case "layout.delete":
        dispatch({ type: "DELETE_LAYOUT", index: numberInput(input, "index") });
        return getAfterMutationSummary();
      case "layout.undo":
        dispatch({ type: "UNDO_LAYOUT" });
        return getAfterMutationSummary();
      case "layout.redo":
        dispatch({ type: "REDO_LAYOUT" });
        return getAfterMutationSummary();
      case "layout.gridlock": {
        const { width, height } = pluginRegistry.getTermSizeFn();
        pluginRegistry.updateLayoutFn(gridlockAllPanes(
          getState().config.layout,
          { x: 0, y: 0, width, height },
          pluginRegistry.panes,
        ));
        return getAfterMutationSummary();
      }
      case "layout.closeFloating": {
        const floatingPaneIds = getState().config.layout.floating.map((entry) => entry.instanceId);
        pluginRegistry.updateLayoutFn(removeFloatingPanes(getState().config.layout));
        return getAfterMutationSummary({ affectedPaneIds: floatingPaneIds });
      }
      case "layout.placePane": {
        const pane = requirePaneInstance(getState().config.layout, stringInput(input, "paneId"));
        const region = stringInput(input, "region");
        const { width, height } = pluginRegistry.getTermSizeFn();
        const def = pluginRegistry.panes.get(pane.paneId);
        const nextLayout = region === "floating"
          ? floatPane(getState().config.layout, pane.instanceId, width, height, def)
          : optionalString(input, "relativeTo")
            ? dockPane(getState().config.layout, pane.instanceId, {
              relativeTo: requirePaneInstance(getState().config.layout, optionalString(input, "relativeTo")!).instanceId,
              position: regionToDockPosition(region),
            })
            : insertAtRootEdge(getState().config.layout, pane.instanceId, regionToRootEdge(region));
        pluginRegistry.updateLayoutFn(nextLayout);
        return getAfterMutationSummary({ affectedPaneIds: [pane.instanceId] });
      }
      case "layout.focusRegion": {
        const region = stringInput(input, "region");
        const { width, height } = pluginRegistry.getTermSizeFn();
        const leaves = getDockLeafLayouts(getState().config.layout, { x: 0, y: 0, width, height });
        if (leaves.length === 0) throw new Error("No docked panes are visible.");
        const target = leaves
          .map((leaf) => {
            const centerX = leaf.rect.x + leaf.rect.width / 2;
            const centerY = leaf.rect.y + leaf.rect.height / 2;
            const score = region === "left" ? centerX
              : region === "right" ? -centerX
                : region === "top" ? centerY
                  : region === "bottom" ? -centerY
                    : Math.abs(centerX - width / 2) + Math.abs(centerY - height / 2);
            return { leaf, score };
          })
          .sort((a, b) => a.score - b.score)[0]!.leaf;
        dispatch({ type: "FOCUS_PANE", paneId: target.instanceId });
        return getAfterMutationSummary({ affectedPaneIds: [target.instanceId] });
      }
      case "layout.setGrid": {
        const rawPaneIds = Array.isArray(input.paneIds) ? input.paneIds : visiblePaneIds(getState().config.layout);
        const paneIds = rawPaneIds.map((id) => requirePaneInstance(getState().config.layout, String(id)).instanceId);
        const nextLayout = {
          ...getState().config.layout,
          dockRoot: buildGridDockRoot(paneIds, optionalNumber(input, "columns")),
          floating: getState().config.layout.floating.filter((entry) => !paneIds.includes(entry.instanceId)),
          detached: (getState().config.layout.detached ?? []).filter((entry) => !paneIds.includes(entry.instanceId)),
        };
        pluginRegistry.updateLayoutFn(nextLayout);
        return getAfterMutationSummary({ affectedPaneIds: paneIds });
      }
      case "desktop.popOutPane":
        await desktopWindowBridge?.popOutPane?.(stringInput(input, "paneId"));
        return getAfterMutationSummary({ affectedPaneIds: [stringInput(input, "paneId")] });
      case "desktop.dockPane":
        await desktopWindowBridge?.dockDetachedPane?.(stringInput(input, "paneId"));
        return getAfterMutationSummary({ affectedPaneIds: [stringInput(input, "paneId")] });
      case "desktop.closeDetachedPane":
        await desktopWindowBridge?.closeDetachedPane?.(stringInput(input, "paneId"));
        return getAfterMutationSummary({ affectedPaneIds: [stringInput(input, "paneId")] });
      case "desktop.focusDetachedPane":
        await desktopWindowBridge?.focusDetachedPane?.(stringInput(input, "paneId"));
        return getAfterMutationSummary({ affectedPaneIds: [stringInput(input, "paneId")] });
      case "capability.invoke":
        return await pluginRegistry.capabilities.invoke(
          stringInput(input, "capabilityId"),
          stringInput(input, "operationId"),
          input.payload ?? {},
        );
      case "ui.invoke": {
        const result = await uiRegistry?.invoke(
          stringInput(input, "nodeId"),
          optionalString(input, "action") ?? "press",
          input.input,
        );
        return getAfterMutationSummary({ result });
      }
      case "ui.invokeMatching":
        return invokeMatchingUiNode(input);
      default:
        throw new Error(`Unknown remote operation "${operation}".`);
    }
  };

  const handle = async (request: RemoteControlRequest): Promise<RemoteControlResponse> => {
    try {
      switch (request.type) {
        case "help":
          return ok(REMOTE_AGENT_HELP, revisionFor(REMOTE_AGENT_HELP));
        case "schema":
          return ok(remoteControlSchema());
        case "get": {
          const data = getResource(request.resource);
          return ok(data, revisionFor(data), buildIncludedState(request.include));
        }
        case "data":
          return ok(await queryMarketData(request));
        case "call": {
          const data = await call(request.operation, request.input, request.dryRun);
          return ok(data, undefined, buildIncludedState(request.include, request.dryRun ? [] : DEFAULT_MUTATION_INCLUDE));
        }
        case "patch": {
          const target = patchTarget(request.resource);
          const currentRev = revisionFor(target.value);
          if (request.expectRev && request.expectRev !== currentRev) {
            throw new Error(`Revision mismatch for ${request.resource}: expected ${request.expectRev}, got ${currentRev}.`);
          }
          const nextValue = applyJsonPatch(target.value, request.patch as RemoteJsonPatchOperation[]);
          if (!request.dryRun) {
            await target.apply(nextValue);
            await afterMutation();
          }
          return ok(
            nextValue,
            revisionFor(nextValue),
            buildIncludedState(request.include, request.dryRun ? [] : DEFAULT_MUTATION_INCLUDE),
          );
        }
        case "batch": {
          if (!Array.isArray(request.requests)) {
            return fail("invalid_request", new Error("batch request is missing requests."));
          }
          const responses = [];
          const haltOnError = request.haltOnError !== false;
          let haltedAt: number | null = null;
          for (const entry of request.requests) {
            const entryRequest = request.dryRun && (entry.type === "call" || entry.type === "patch")
              ? { ...entry, dryRun: true, include: entry.include ?? [] } as RemoteControlRequest
              : (entry.type === "call" || entry.type === "patch")
                ? { ...entry, include: entry.include ?? [] } as RemoteControlRequest
                : entry;
            const response = await handle(entryRequest);
            responses.push(response);
            if (request.settle === "afterEach") await afterMutation();
            if (!response.ok && haltOnError) {
              haltedAt = responses.length - 1;
              break;
            }
          }
          if (request.settle === "afterBatch") await afterMutation();
          return ok({
            ok: responses.every((response) => response.ok),
            haltedAt,
            responses,
          }, undefined, buildIncludedState(request.include, request.dryRun ? [] : DEFAULT_MUTATION_INCLUDE));
        }
        default:
          throw new Error(`Unknown remote request type: ${(request as { type?: unknown }).type}`);
      }
    } catch (error) {
      return fail("remote_error", error);
    }
  };

  return { handle };
}
