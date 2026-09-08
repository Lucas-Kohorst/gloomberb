/**
 * Public React runtime surface for external plugins (`gloomberb/react`).
 *
 * These hooks are the renderer-neutral way for plugin panes to reach app
 * services. Plugin render code must use them instead of importing OpenTUI,
 * Electrobun, or DOM APIs directly — the renderer decides how each one is
 * fulfilled, which is what lets the same plugin run in the terminal, on the
 * desktop, and (for web-capable plugins) in the browser.
 *
 * Compatibility commitment: see the note in `./utils.ts`.
 */

export {
  deletePluginPaneStateValue,
  getPluginPaneStateValue,
  setPluginPaneStateValue,
  useCapabilityInvoker,
  useAssetData,
  useConnectionHealth,
  useDebouncedPluginPaneState,
  useMarketData,
  usePluginAppActions,
  usePluginBrokerActions,
  usePluginConfigState,
  usePluginPaneActions,
  usePluginPaneState,
  usePluginState,
  usePluginTickerActions,
  useSetPluginConfigStates,
} from "../plugins/runtime";
export type { PluginRuntimeAccess } from "../plugins/runtime";

export { useInlineTickerOpener, useInlineTickers } from "../state/hooks/inline-tickers";

// Any feed plugin needs to remember which items have been read, persisted and
// capped. Substack and the news wire both use this; a third-party feed plugin
// would otherwise reimplement it or copy it and drift.
export {
  DEFAULT_MAX_READ_IDS,
  markPersistedReadId,
  normalizePersistedReadIdState,
  usePersistedReadIds,
} from "../plugins/builtin/shared/read-state";
export type { PersistedReadIdAdapter } from "../plugins/builtin/shared/read-state";
export type { InlineTickerCatalogEntry, UseInlineTickersOptions } from "../state/hooks/inline-tickers";

export {
  AppContext,
  PaneInstanceProvider,
  useAppConfig,
  useAppDispatch,
  useAppSelector,
  useBrokerAccounts,
  useInputCapture,
  usePaneCollection,
  usePaneInstanceId,
  usePaneSettingValue,
  usePaneTicker,
  useTickers,
} from "./pane-hooks";

// Keyboard handling for plugin panes; the renderer decides how events arrive.
export { useShortcut } from "../react/input";

// Auto-refresh hook: re-pulls pane data on the global refresh cadence.
// Plugins that show network-backed data should use this instead of a
// hardcoded setInterval so the user's refresh-interval setting is respected.
export { useAutoRefresh } from "../plugins/builtin/shared/use-auto-refresh";

// Pane footer helpers: the standard status/link footer composition used by
// every data-backed pane. External plugins need these to keep footer behavior
// (open hints, search/refresh bindings, loading/error chips) consistent with
// first-party panes.
export {
  PANE_FOOTER_ACTION_KEYS,
  paneSearchHint,
  paneRefreshHint,
  paneShareHint,
  paneDelayedStatus,
  paneLiveStatus,
  usePaneFooterHintBindings,
  usePaneStatusFooter,
  usePaneStatusLinkFooter,
} from "../plugins/builtin/shared/pane-footer";

// News wire helpers: plugins that display articles (Federal Register, RSS
// feeds, etc.) need to pop out the shared article reader and track read state
// the same way the built-in news wire does.
export { usePopOutNewsArticle } from "../plugins/builtin/news/wire/news/pop-out";
export { useNewsReadState } from "../plugins/builtin/news/wire/read-state";
export type { NewsArticle } from "../news/types";
