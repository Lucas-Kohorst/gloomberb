/**
 * Registration helpers that bundle common plugin patterns into a single call.
 *
 * Each helper wraps the raw `register*` methods on {@link GloomPluginContext},
 * auto-attributes contributions to the owning plugin via `ctx.pluginId`, and
 * returns a cleanup function. Use these in `setup()` for both first-party
 * `PluginModule` and external `GloomPlugin` plugins.
 *
 * ```typescript
 * import { createChartSource } from "gloomberb/plugins";
 *
 * setup(ctx) {
 *   const dispose = createChartSource(ctx, {
 *     id: "defillama",
 *     name: "DefiLlama",
 *     catalog: defillamaSeriesCatalog,
 *     resolve: resolveDefiLlamaChartSeries,
 *     connection: { kind: "api", authRequired: false },
 *   });
 * }
 * ```
 */

import type {
  ChartSeriesCatalogProvider,
  DocumentSearchProvider,
  GloomPluginContext,
  PaneDef,
  PaneTemplateDef,
  TickerResearchTabDef,
} from "../types/plugin";
import { chartSeriesProvider, newsProvider } from "../capabilities";
import type { ChartSeriesCatalogItem, ChartSeriesProvider } from "../capabilities/types";
import type { NewsDataProvider } from "../types/capability-route-source";
import type { ResolvedSeries } from "../time-series/types";
import {
  registerConnectionSource,
  withConnectionRequest,
  reportConnectionRequest,
} from "./builtin/connections/register";
import type { ConnectionKind } from "./builtin/connections/types";
import { createAlert } from "./builtin/alerts/alert-registry";

// Re-export connection and alert utilities so external plugins import everything from one place.
export { withConnectionRequest, reportConnectionRequest, createAlert };
export type { ConnectionKind };

export interface ConnectionOptions {
  kind?: ConnectionKind;
  authRequired?: boolean;
  priority?: number;
  isWebSocket?: boolean;
}

function registerConnection(
  ctx: GloomPluginContext,
  id: string,
  name: string,
  options?: ConnectionOptions,
): () => void {
  return registerConnectionSource({
    id,
    name,
    kind: options?.kind ?? "api",
    pluginId: ctx.pluginId,
    authRequired: options?.authRequired,
    priority: options?.priority,
    isWebSocket: options?.isWebSocket,
  });
}

// ---------------------------------------------------------------------------
// createChartSource
// ---------------------------------------------------------------------------

export interface ChartSourceOptions {
  id: string;
  name: string;
  /** Catalog provider for command-bar search and the Data Catalog. */
  catalog: ChartSeriesCatalogProvider;
  /** Resolve a series id into chartable data. */
  resolve: (seriesId: string, signal: AbortSignal) => Promise<ResolvedSeries> | ResolvedSeries;
  /**
   * Optional capability catalog/search overrides. When omitted, the helper
   * auto-generates them from the catalog provider's `entries`.
   */
  capabilityCatalog?: ChartSeriesProvider["catalog"];
  capabilitySearch?: ChartSeriesProvider["search"];
  priority?: number;
  connection?: ConnectionOptions;
}

/**
 * Registers a chart-series source: a chart-series capability, a chart-series
 * catalog for command-bar search, and a connection source. Returns a single
 * cleanup function that withdraws all three.
 */
export function createChartSource(ctx: GloomPluginContext, options: ChartSourceOptions): () => void {
  const catalog = options.catalog;

  const autoCatalog = (request: { query?: string; limit?: number }): ChartSeriesCatalogItem[] => {
    const entries = catalog.entries ?? [];
    const words = (request.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const matched = words.length === 0
      ? entries
      : entries.filter((entry) => words.every((word) => entry.searchText.toLowerCase().includes(word)));
    const limit = request.limit ?? 32;
    return matched.slice(0, limit).map((entry) => ({
      seriesId: entry.id,
      label: entry.label,
      description: entry.description,
      detail: entry.detail,
    }));
  };

  const provider: ChartSeriesProvider = {
    catalog: options.capabilityCatalog ?? autoCatalog,
    search: options.capabilitySearch ?? options.capabilityCatalog ?? autoCatalog,
    resolve: ({ seriesId, signal }) => options.resolve(seriesId, signal ?? new AbortController().signal),
  };

  const capability = chartSeriesProvider({
    id: options.id,
    name: options.name,
    priority: options.priority,
    provider,
  });

  ctx.registerCapability(capability);
  const disposeCatalog = ctx.registerChartSeriesCatalog(catalog);
  const disposeConnection = registerConnection(ctx, options.id, options.name, options.connection);

  return () => {
    disposeConnection();
    disposeCatalog();
    // Capabilities registered via ctx.registerCapability are removed with the plugin.
  };
}

// ---------------------------------------------------------------------------
// createDocumentSource
// ---------------------------------------------------------------------------

export interface DocumentSourceOptions {
  id: string;
  name: string;
  sourceId?: string;
  documentTypes?: readonly string[];
  minQueryLength?: number;
  search: DocumentSearchProvider["search"];
  load: DocumentSearchProvider["load"];
  connection?: ConnectionOptions;
}

/**
 * Registers a document search provider and a connection source. Returns a
 * cleanup function that withdraws both.
 */
export function createDocumentSource(ctx: GloomPluginContext, options: DocumentSourceOptions): () => void {
  const disposeProvider = ctx.registerDocumentSearchProvider({
    id: options.id,
    name: options.name,
    sourceId: options.sourceId ?? options.id,
    documentTypes: options.documentTypes,
    minQueryLength: options.minQueryLength,
    search: options.search,
    load: options.load,
  });
  const disposeConnection = registerConnection(ctx, options.id, options.name, options.connection);

  return () => {
    disposeConnection();
    disposeProvider();
  };
}

// ---------------------------------------------------------------------------
// createDataPane
// ---------------------------------------------------------------------------

export interface DataPaneOptions {
  pane: PaneDef;
  template: PaneTemplateDef;
  /** Connection source for the pane's data. Omitted when the pane has no external API. */
  connection?: { id: string; name: string } & ConnectionOptions;
}

/**
 * Registers a pane, its template, and an optional connection source. Returns
 * a cleanup function that withdraws the connection (panes and templates are
 * owned by the plugin and removed on unregister).
 */
export function createDataPane(ctx: GloomPluginContext, options: DataPaneOptions): () => void {
  ctx.registerPane(options.pane);
  ctx.registerPaneTemplate(options.template);
  const disposeConnection = options.connection
    ? registerConnection(ctx, options.connection.id, options.connection.name, options.connection)
    : () => {};

  return () => {
    disposeConnection();
  };
}

// ---------------------------------------------------------------------------
// createResearchTab
// ---------------------------------------------------------------------------

export interface ResearchTabOptions {
  tab: TickerResearchTabDef;
  /** Agent prompt fragment describing the tab for the in-app assistant. */
  agentPrompt?: string;
}

/**
 * Registers a Ticker Research tab and an optional agent prompt fragment.
 * Returns a cleanup function.
 */
export function createResearchTab(ctx: GloomPluginContext, options: ResearchTabOptions): () => void {
  ctx.registerTickerResearchTab(options.tab);
  if (options.agentPrompt) {
    ctx.registerAgentPromptFragment(options.agentPrompt);
  }
  return () => {
    // Tab and prompt fragment are owned by the plugin and removed on unregister.
  };
}

// ---------------------------------------------------------------------------
// createConnection
// ---------------------------------------------------------------------------

export interface CreateConnectionOptions extends ConnectionOptions {
  id: string;
  name: string;
}

/**
 * Registers a connection source with the plugin id auto-filled from the
 * context. Every external API or data source should show up in the
 * Connections pane. Returns a cleanup function.
 */
export function createConnection(ctx: GloomPluginContext, options: CreateConnectionOptions): () => void {
  return registerConnection(ctx, options.id, options.name, options);
}

// ---------------------------------------------------------------------------
// createFeedSource
// ---------------------------------------------------------------------------

export interface FeedSourceOptions {
  id: string;
  name: string;
  priority?: number;
  /** Filter which queries this source answers. Default: all. */
  supports?: (query: import("../types/news-source").NewsQuery) => boolean;
  /** Fetch articles for a query. Must return NewsArticle[]. */
  fetchNews: NewsDataProvider["fetchNews"];
  /** Return cached articles without a network call. Optional. */
  getCachedNews?: NewsDataProvider["getCachedNews"];
  /** Fetch a page of articles with a cursor. Optional. */
  fetchNewsPage?: NewsDataProvider["fetchNewsPage"];
  /** Fetch a single story by id. Optional. */
  fetchNewsStory?: NewsDataProvider["fetchNewsStory"];
  connection?: ConnectionOptions;
}

/**
 * Registers a news feed source that pipes into the firehose, breaking news,
 * top news, and all other news panes. The news aggregator polls all
 * registered sources and merges their articles — the firehose is a dumb
 * subscriber that displays whatever comes back.
 *
 * ```typescript
 * import { createFeedSource } from "gloomberb/plugins";
 *
 * setup(ctx) {
 *   createFeedSource(ctx, {
 *     id: "my-feed",
 *     name: "My Feed",
 *     priority: 200,
 *     fetchNews: async (query) => myArticles,
 *     connection: { kind: "news", authRequired: false },
 *   });
 * }
 * ```
 */
export function createFeedSource(ctx: GloomPluginContext, options: FeedSourceOptions): () => void {
  const capability = newsProvider({
    id: options.id,
    name: options.name,
    priority: options.priority,
    provider: {
      ...(options.supports ? { supports: options.supports } : {}),
      ...(options.getCachedNews ? { getCachedNews: options.getCachedNews } : {}),
      fetchNews: options.fetchNews,
      ...(options.fetchNewsPage ? { fetchNewsPage: options.fetchNewsPage } : {}),
      ...(options.fetchNewsStory ? { fetchNewsStory: options.fetchNewsStory } : {}),
    },
  });

  ctx.registerCapability(capability);
  const disposeConnection = registerConnection(ctx, options.id, options.name, {
    kind: options.connection?.kind ?? "news",
    authRequired: options.connection?.authRequired,
    priority: options.connection?.priority,
    isWebSocket: options.connection?.isWebSocket,
  });

  return () => {
    disposeConnection();
    // Capability is owned by the plugin and removed on unregister.
  };
}
