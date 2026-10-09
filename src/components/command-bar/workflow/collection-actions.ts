import type { Dispatch } from "react";
import { apiClient } from "../../../api-client";
import { t, tf } from "../../../i18n";
import { teamCollectionLocalId } from "../../../plugins/builtin/cloud/team/collections";
import type { DataProvider } from "../../../types/data-provider";
import type { AppTickerRepositoryPort } from "../../../core/app-service-ports";
import type { PluginRegistry } from "../../../plugins/registry";
import type { AppAction, AppState } from "../../../state/app/context";
import {
  buildBrokerProfileConfig,
  validateBrokerProfileValues,
} from "../../../brokers/profile-form";
import type { SignedInBroker } from "../../../brokers/signed-in/client";
import { removeBrokerProfile } from "../../../brokers/remove-profile";
import { connectSignedInBrokerProfile } from "../../../brokers/signed-in/connect";
import {
  addTickerToPortfolio,
  addTickerToWatchlist,
  adoptFirstPositionCurrency,
  createManualPortfolio as createManualPortfolioConfig,
  deleteManualPortfolio,
  deleteWatchlist as deleteWatchlistConfig,
  hasOpenPortfolioPositions,
  isManualPortfolio,
  resolveManualPositionCurrency,
  setManualPortfolioPosition,
} from "../../../plugins/builtin/portfolio-list/mutations";
import { parseBulkImport, resolveBulkImportEntries } from "../../../plugins/builtin/portfolio-list/quick-add/import";
import { resolveQuickAddValidation } from "../../../plugins/builtin/portfolio-list/quick-add/resolution";
import { upsertTickerFromSearchResult } from "../../../tickers/search";
import { captureAttentionAction } from "../../../telemetry/attention-counts";
import { publicTickerKey } from "../../../utils/exchanges";
import type { CommandBarFieldValue } from "./types";
import type { WorkflowStringValues } from "./broker";
import { coerceFieldString } from "../helpers";
import { slugifyName } from "../../../utils/slugify";
import { resolveTickerInputOrThrow } from "./ops";
import { resolveCollectionTicker } from "./collection-ticker";

export type CommandBarNotifyFn = (
  body: string,
  options?: { type?: "info" | "success" | "error" },
) => void;

export interface CommandBarCollectionWorkflowActions {
  connectBrokerProfile: (brokerId: string, values: WorkflowStringValues) => Promise<void>;
  /**
   * Asks the user to connect `broker` (the form's connect step), then syncs
   * its profile. False when they backed out before it connected.
   */
  connectSignedInBroker: (broker: SignedInBroker) => Promise<boolean>;
  createManualPortfolio: (name: string, owner?: CollectionOwner) => Promise<void>;
  createWatchlist: (name: string, owner?: CollectionOwner) => Promise<void>;
  deletePortfolio: (portfolioId: string) => Promise<void>;
  deleteWatchlist: (watchlistId: string) => Promise<void>;
  disconnectBrokerInstance: (instanceId: string) => Promise<void>;
  setPortfolioPositionFromWorkflow: (values: Record<string, CommandBarFieldValue>) => Promise<void>;
  addTickerMembershipFromWorkflow: (values: Record<string, CommandBarFieldValue>) => Promise<void>;
  importTickersFromWorkflow: (values: Record<string, CommandBarFieldValue>) => Promise<void>;
}

export function createCommandBarCollectionWorkflowActions(options: {
  activeCollectionId: string | null;
  activeTickerSymbol: string | null;
  dataProvider: DataProvider;
  dispatch: Dispatch<AppAction>;
  getState: () => AppState;
  notify: CommandBarNotifyFn;
  persistConfig: (nextConfig: AppState["config"]) => void;
  pluginRegistry: PluginRegistry;
  /** Shows the connect step for a signed-in broker; the app's connect dialog when missing. */
  requestBrokerSignIn?: (broker: SignedInBroker) => Promise<boolean>;
  setActiveCollection: (collectionId: string) => void;
  tickerRepository: AppTickerRepositoryPort;
}): CommandBarCollectionWorkflowActions {
  const {
    activeCollectionId,
    activeTickerSymbol,
    dataProvider,
    dispatch,
    getState,
    notify,
    persistConfig,
    pluginRegistry,
    requestBrokerSignIn,
    setActiveCollection,
    tickerRepository,
  } = options;

  const buildWorkflowDeps = () => ({
    dataProvider,
    tickerRepository,
    pluginRegistry,
    dispatch,
    getState,
  });

  /** Lands on the synced profile's portfolio once a broker is connected. */
  const showConnectedBroker = (instanceId: string) => {
    const freshConfig = pluginRegistry.getConfig();
    dispatch({ type: "SET_CONFIG", config: freshConfig });
    const brokerTab = freshConfig.portfolios.find((portfolio) => portfolio.brokerInstanceId === instanceId);
    if (brokerTab) setActiveCollection(brokerTab.id);
    notify(t("Connected! Positions will sync automatically."), { type: "success" });
  };

  return {
    async connectBrokerProfile(brokerId, values) {
      const adapter = pluginRegistry.brokers.get(brokerId);
      if (!adapter) {
        throw new Error(`Unknown broker "${brokerId}".`);
      }

      const validationError = validateBrokerProfileValues(adapter, values);
      if (validationError) throw new Error(validationError);

      const brokerValues = buildBrokerProfileConfig(adapter, values);
      const instance = await pluginRegistry.createBrokerInstance(
        brokerId,
        adapter.name.trim(),
        brokerValues as Record<string, unknown>,
      );
      await pluginRegistry.syncBrokerInstance(instance.id);
      showConnectedBroker(instance.id);
    },

    async connectSignedInBroker(broker) {
      const connected = await connectSignedInBrokerProfile(broker, {
        getConfig: () => pluginRegistry.getConfig(),
        createBrokerInstance: (brokerType, label, values) => pluginRegistry.createBrokerInstance(brokerType, label, values),
        syncBrokerInstance: (instanceId) => pluginRegistry.syncBrokerInstance(instanceId),
        requestSignIn: requestBrokerSignIn,
      });
      if (!connected) return false;
      showConnectedBroker(connected.instance.id);
      return true;
    },

    async createManualPortfolio(name, owner) {
      if (owner?.kind === "team") {
        const created = await createTeamCollectionAndWait(owner.teamId, "portfolio", name, getState().config.baseCurrency);
        setActiveCollection(created);
        notify(`Created team portfolio "${name.trim()}".`, { type: "success" });
        return;
      }
      const currentState = getState();
      const { config: nextConfig, portfolio } = createManualPortfolioConfig(
        currentState.config,
        name,
        currentState.config.baseCurrency,
      );
      dispatch({ type: "SET_CONFIG", config: nextConfig });
      setActiveCollection(portfolio.id);
      persistConfig(nextConfig);
      notify(`Created portfolio "${portfolio.name}".`, { type: "success" });
    },

    async createWatchlist(name, owner) {
      const currentState = getState();
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error("Watchlist name is required.");
      }
      if (owner?.kind === "team") {
        const created = await createTeamCollectionAndWait(owner.teamId, "watchlist", trimmedName);
        setActiveCollection(created);
        notify(`Created team watchlist "${trimmedName}".`, { type: "success" });
        return;
      }

      const id = slugifyName(trimmedName, "watchlist");
      const newWatchlist = { id, name: trimmedName };
      const nextConfig = {
        ...currentState.config,
        watchlists: [...currentState.config.watchlists, newWatchlist],
      };
      dispatch({ type: "SET_CONFIG", config: nextConfig });
      setActiveCollection(id);
      persistConfig(nextConfig);
      notify(`Created watchlist "${trimmedName}".`, { type: "success" });
    },

    async deleteWatchlist(watchlistId) {
      const currentState = getState();
      const { config: nextConfig, watchlist, tickers } = deleteWatchlistConfig(
        currentState.config,
        currentState.tickers.values(),
        watchlistId,
      );
      for (const ticker of tickers) {
        await tickerRepository.saveTicker(ticker);
        dispatch({ type: "UPDATE_TICKER", ticker });
      }

      dispatch({ type: "SET_CONFIG", config: nextConfig });
      if (activeCollectionId === watchlistId) {
        const fallback = nextConfig.portfolios[0]?.id || nextConfig.watchlists[0]?.id || "";
        if (fallback) setActiveCollection(fallback);
      }
      persistConfig(nextConfig);
      notify(`Deleted "${watchlist.name}".`, { type: "success" });
    },

    async deletePortfolio(portfolioId) {
      const currentState = getState();
      const portfolio = currentState.config.portfolios.find((entry) => entry.id === portfolioId);
      if (!portfolio) {
        throw new Error("Portfolio not found.");
      }
      if (!isManualPortfolio(portfolio)) {
        throw new Error("Broker-managed portfolios cannot be deleted here.");
      }

      const result = deleteManualPortfolio(
        currentState.config,
        [...currentState.tickers.values()],
        portfolioId,
      );
      for (const ticker of result.tickers) {
        await tickerRepository.saveTicker(ticker);
        dispatch({ type: "UPDATE_TICKER", ticker });
      }

      const nextConfig = result.config;
      dispatch({ type: "SET_CONFIG", config: nextConfig });
      if (activeCollectionId === portfolioId) {
        const fallback = nextConfig.portfolios[0]?.id || nextConfig.watchlists[0]?.id || "";
        if (fallback) setActiveCollection(fallback);
      }
      persistConfig(nextConfig);
      notify(`Deleted "${portfolio.name}".`, { type: "success" });
    },

    async setPortfolioPositionFromWorkflow(values) {
      const currentState = getState();
      const portfolioId = coerceFieldString(values.portfolioId).trim();
      const portfolio = currentState.config.portfolios.find((entry) => entry.id === portfolioId);
      if (!portfolio || !isManualPortfolio(portfolio)) {
        throw new Error("Choose a manual portfolio.");
      }

      const shares = Number(coerceFieldString(values.shares));
      if (!Number.isFinite(shares) || shares <= 0) {
        throw new Error("Shares must be greater than 0.");
      }

      const rawAvgCost = coerceFieldString(values.avgCost).trim();
      const avgCost = Number(rawAvgCost);
      if (!rawAvgCost || !Number.isFinite(avgCost)) {
        throw new Error("Avg Cost must be a valid number.");
      }

      const resolvedTicker = await resolveTickerInputOrThrow(
        coerceFieldString(values.ticker),
        activeTickerSymbol,
        portfolio.id,
        buildWorkflowDeps(),
      );
      const ticker = resolveCollectionTicker(resolvedTicker.ticker, getState().tickers, "portfolio", portfolio.id);

      const currency = resolveManualPositionCurrency(
        coerceFieldString(values.currency),
        ticker,
        portfolio,
        currentState.config.baseCurrency,
      );

      const result = setManualPortfolioPosition(ticker, portfolio.id, {
        shares,
        avgCost,
        currency,
      });
      const firstPosition = !hasOpenPortfolioPositions(portfolio.id, getState().tickers.values());
      await tickerRepository.saveTicker(result.ticker);
      dispatch({ type: "UPDATE_TICKER", ticker: result.ticker });
      const adopted = firstPosition ? adoptFirstPositionCurrency(getState().config, portfolio.id, currency) : null;
      if (adopted) {
        dispatch({ type: "SET_CONFIG", config: adopted });
        persistConfig(adopted);
      }
      pluginRegistry.events.emit("host:portfolio-ticker-saved", {
        symbol: result.ticker.metadata.ticker,
        portfolioId: portfolio.id,
      });
      notify(`Set position for ${result.ticker.metadata.ticker} in "${portfolio.name}".`, { type: "success" });
    },

    async addTickerMembershipFromWorkflow(values) {
      const currentState = getState();
      const portfolioId = coerceFieldString(values.portfolioId).trim();
      const portfolio = currentState.config.portfolios.find((entry) => entry.id === portfolioId);
      if (!portfolio || !isManualPortfolio(portfolio)) {
        throw new Error("Choose a manual portfolio.");
      }

      const resolvedTicker = await resolveTickerInputOrThrow(
        coerceFieldString(values.ticker),
        activeTickerSymbol,
        portfolio.id,
        buildWorkflowDeps(),
      );
      const ticker = resolveCollectionTicker(resolvedTicker.ticker, getState().tickers, "portfolio", portfolio.id);

      const result = addTickerToPortfolio(ticker, portfolio.id);
      if (result.changed) {
        await tickerRepository.saveTicker(result.ticker);
        dispatch({ type: "UPDATE_TICKER", ticker: result.ticker });
      }

      pluginRegistry.events.emit("host:portfolio-ticker-saved", {
        symbol: result.ticker.metadata.ticker,
        portfolioId: portfolio.id,
      });
      notify(
        result.changed
          ? `Added ${result.ticker.metadata.ticker} to "${portfolio.name}".`
          : `${result.ticker.metadata.ticker} is already in "${portfolio.name}".`,
        { type: result.changed ? "success" : "info" },
      );
    },

    async importTickersFromWorkflow(values) {
      const currentState = getState();
      const watchlist = currentState.config.watchlists.find((entry) => entry.id === activeCollectionId);
      const portfolio = currentState.config.portfolios.find((entry) => entry.id === activeCollectionId);
      const collectionKind = watchlist ? "watchlist" : portfolio && isManualPortfolio(portfolio) ? "portfolio" : null;
      const collection = watchlist ?? (collectionKind === "portfolio" ? portfolio : null);
      if (!collectionKind || !collection || !activeCollectionId) {
        throw new Error("Select a watchlist or manual portfolio first.");
      }

      const parsed = parseBulkImport(coerceFieldString(values.tickers), collectionKind);
      const recordAttention = captureAttentionAction();
      // Dispatch may not publish a ticker before the next row resolves, so later rows read this copy.
      const tickers = new Map(currentState.tickers);
      let config = currentState.config;
      const results = await resolveBulkImportEntries(parsed.entries, async (entry) => {
        const validation = await resolveQuickAddValidation({
          query: entry.symbol,
          collectionId: activeCollectionId,
          collectionKind,
          tickers,
          financials: currentState.financials,
        });
        // Already listed, and this row does not set a position: skip it and say why.
        if (validation.status === "duplicate" && entry.shares == null) {
          return { reason: "Already in collection" };
        }
        if (validation.status === "ready" || validation.status === "duplicate") return { value: validation };
        // Quick-add already picked the highest-volume venue. A remaining choice cannot be answered from a paste.
        if (validation.status === "choose") {
          const venues = validation.listings.map((listing) => listing.exchange).filter(Boolean).join(", ");
          return { reason: venues ? `Multiple listings match: ${venues}` : "Multiple listings match" };
        }
        return {
          reason: validation.status === "idle" || validation.status === "checking"
            ? "Ticker lookup unavailable"
            : validation.message,
        };
      });

      const failures = [...parsed.failures, ...results.flatMap((result) => result.failure ? [result.failure] : [])];
      let added = 0;
      for (const result of results) {
        if (!result.value || (result.value.status === "duplicate" && result.entry.shares == null)) continue;
        try {
          let ticker = result.value.ticker;
          let created = false;
          if (!ticker) {
            if (result.value.resolved.kind === "local") {
              ticker = result.value.resolved.ticker;
            } else {
              const upserted = await upsertTickerFromSearchResult(tickerRepository, result.value.resolved.result);
              ticker = upserted.ticker;
              created = upserted.created;
            }
          }
          const subject = tickers.get(ticker.metadata.ticker) ?? ticker;
          const shares = result.entry.shares;
          const avgCost = result.entry.avgCost;
          let nextTicker = subject;
          let positionCurrency: string | null = null;
          if (shares != null && avgCost != null) {
            const livePortfolio = config.portfolios.find((entry) => entry.id === activeCollectionId);
            if (!livePortfolio || !isManualPortfolio(livePortfolio)) {
              throw new Error("Select a watchlist or manual portfolio first.");
            }
            positionCurrency = resolveManualPositionCurrency("", subject, livePortfolio, config.baseCurrency);
            nextTicker = setManualPortfolioPosition(subject, livePortfolio.id, {
              shares,
              avgCost,
              currency: positionCurrency,
            }).ticker;
          } else {
            const membership = collectionKind === "portfolio"
              ? addTickerToPortfolio(subject, activeCollectionId)
              : addTickerToWatchlist(subject, activeCollectionId);
            if (!membership.changed) continue;
            nextTicker = membership.ticker;
          }
          const firstPosition = positionCurrency != null
            && !hasOpenPortfolioPositions(activeCollectionId, tickers.values());
          await tickerRepository.saveTicker(nextTicker);
          dispatch({ type: "UPDATE_TICKER", ticker: nextTicker });
          tickers.set(nextTicker.metadata.ticker, nextTicker);
          if (positionCurrency && firstPosition) {
            const adopted = adoptFirstPositionCurrency(config, activeCollectionId, positionCurrency);
            if (adopted) {
              config = adopted;
              dispatch({ type: "SET_CONFIG", config: adopted });
              persistConfig(adopted);
            }
          }
          if (created) {
            pluginRegistry.events.emit("ticker:added", {
              symbol: nextTicker.metadata.ticker,
              ticker: nextTicker,
            });
          }
          if (collectionKind === "portfolio") {
            pluginRegistry.events.emit("host:portfolio-ticker-saved", {
              symbol: nextTicker.metadata.ticker,
              portfolioId: activeCollectionId,
            });
          } else {
            recordAttention(publicTickerKey(nextTicker.metadata.ticker, nextTicker.metadata.exchange), "watchlist_add");
          }
          added += 1;
        } catch (error) {
          failures.push({
            line: result.entry.line,
            symbol: result.entry.symbol,
            reason: error instanceof Error ? error.message : "Ticker add failed",
          });
        }
      }

      const summary = tf("Added {count}.", { count: added });
      if (failures.length > 0) {
        notify(tf("{summary} Failed: {failures}", {
          summary,
          failures: failures.map((failure) => tf("{symbol}: {reason}", {
            symbol: failure.symbol || tf("line {line}", { line: failure.line }),
            reason: t(failure.reason),
          })).join("; "),
        }), { type: "error" });
      } else {
        notify(summary, { type: "success" });
      }
    },

    async disconnectBrokerInstance(instanceId) {
      const instance = getState().config.brokerInstances.find((entry) => entry.id === instanceId);
      if (!instance) {
        throw new Error(t("Broker profile not found."));
      }
      const removal = await removeBrokerProfile(instance, instance.label, (id) => pluginRegistry.removeBrokerInstance(id));
      notify(removal.message, { type: removal.accountKept ? "info" : "success" });
    },
  };
}

type CollectionOwner = { kind: "user" } | { kind: "team"; teamId: string };

/**
 * Creates the collection on the server. The collection.updated frame brings
 * it into the config; the local id is known up front so the pane can switch
 * to it as soon as that lands.
 */
async function createTeamCollectionAndWait(
  teamId: string,
  kind: "watchlist" | "portfolio",
  name: string,
  currency?: string,
): Promise<string> {
  const created = await apiClient.createTeamCollection(teamId, {
    kind,
    name: name.trim(),
    ...(kind === "portfolio" ? { currency: (currency || "USD").toUpperCase() } : {}),
  });
  return teamCollectionLocalId(teamId, created.id);
}
