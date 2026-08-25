import type { Dispatch } from "react";
import {
  clearPersistedBrokerAccounts,
  getBrokerAccountCacheSourceKey,
} from "../../brokers/account-cache";
import type { AppTickerRepositoryPort } from "../../core/app-service-ports";
import type { MarketDataCoordinator } from "../../market-data/coordinator";
import { instrumentFromTicker } from "../../market-data/request-types";
import type { PluginRegistry } from "../../plugins/registry";
import { saveConfigImmediately } from "../../state/config-save-scheduler";
import type { AppAction, AppState } from "../../state/app/context";
import type { AppConfig, BrokerInstanceConfig } from "../../types/config";
import type { DataProvider } from "../../types/data-provider";
import type { TickerRecord } from "../../types/ticker";
import { requireValidBroker } from "../../brokers/require-valid-broker";
import {
  createBrokerInstanceId,
  getBrokerInstance,
} from "../../utils/broker-instances";

export function applyBrokerInstanceRemovalToTickers(
  tickers: Iterable<TickerRecord>,
  instanceId: string,
  removedPortfolioIds: Set<string>,
): {
  nextTickers: Map<string, TickerRecord>;
  removedSymbols: string[];
  changedTickers: TickerRecord[];
} {
  const nextTickers = new Map<string, TickerRecord>();
  const removedSymbols: string[] = [];
  const changedTickers: TickerRecord[] = [];

  for (const ticker of tickers) {
    const nextPositions = ticker.metadata.positions.filter((position) => position.brokerInstanceId !== instanceId);
    const nextPortfolioRefs = ticker.metadata.portfolios.filter((portfolioId) => !removedPortfolioIds.has(portfolioId));
    const nextBrokerContracts = (ticker.metadata.broker_contracts ?? []).filter(
      (contract) => contract.brokerInstanceId !== instanceId,
    );
    const changed = nextPositions.length !== ticker.metadata.positions.length
      || nextPortfolioRefs.length !== ticker.metadata.portfolios.length
      || nextBrokerContracts.length !== (ticker.metadata.broker_contracts ?? []).length;
    const shouldDeleteTicker = nextPositions.length === 0
      && nextPortfolioRefs.length === 0
      && ticker.metadata.watchlists.length === 0
      && nextBrokerContracts.length === 0
      && ticker.metadata.tags.length === 0
      && Object.keys(ticker.metadata.custom).length === 0;

    if (shouldDeleteTicker) {
      removedSymbols.push(ticker.metadata.ticker);
      continue;
    }
    if (!changed) {
      nextTickers.set(ticker.metadata.ticker, ticker);
      continue;
    }
    const nextTicker: TickerRecord = {
      ...ticker,
      metadata: {
        ...ticker.metadata,
        positions: nextPositions,
        portfolios: nextPortfolioRefs,
        broker_contracts: nextBrokerContracts,
      },
    };
    changedTickers.push(nextTicker);
    nextTickers.set(nextTicker.metadata.ticker, nextTicker);
  }

  return { nextTickers, removedSymbols, changedTickers };
}

async function persistRemovedBrokerTickers(
  tickerRepository: AppTickerRepositoryPort & {
    replaceAll?: (tickers: Iterable<TickerRecord>) => boolean | void;
  },
  nextTickers: Map<string, TickerRecord>,
  removedSymbols: string[],
  changedTickers: TickerRecord[],
): Promise<void> {
  if (removedSymbols.length === 0 && changedTickers.length === 0) return;
  if (typeof tickerRepository.replaceAll === "function") {
    const applied = tickerRepository.replaceAll(nextTickers.values());
    // Desktop RemoteTickerRepository.replaceAll is a no-op and returns false.
    if (applied !== false) return;
  }
  await Promise.all([
    ...removedSymbols.map((symbol) => tickerRepository.deleteTicker(symbol)),
    ...changedTickers.map((ticker) => tickerRepository.saveTicker(ticker)),
  ]);
}

function disconnectBrokerInBackground(
  disconnect: ((instance: BrokerInstanceConfig) => Promise<void>) | undefined,
  instance: BrokerInstanceConfig,
): void {
  if (!disconnect) return;
  void Promise.resolve(disconnect(instance)).catch(() => {});
}

export function bindPluginRegistryRuntimeAccess({
  dataProvider,
  dispatch,
  importBrokerPositions,
  marketData,
  pluginRegistry,
  state,
  tickerRepository,
}: {
  dataProvider: DataProvider;
  dispatch: Dispatch<AppAction>;
  importBrokerPositions: (instanceId: string) => Promise<unknown>;
  marketData: MarketDataCoordinator;
  pluginRegistry: PluginRegistry;
  state: AppState;
  tickerRepository: AppTickerRepositoryPort;
}) {
  pluginRegistry.getTickerFn = (symbol) => state.tickers.get(symbol) ?? null;
  pluginRegistry.getDataFn = (symbol) => {
    const ticker = state.tickers.get(symbol) ?? null;
    const instrument = instrumentFromTicker(ticker, symbol);
    return instrument ? marketData.getTickerFinancialsSync(instrument) : null;
  };
  pluginRegistry.getConfigFn = () => state.config;
  pluginRegistry.getPaneRuntimeStateFn = (paneId) => state.paneState[paneId] ?? null;
  pluginRegistry.updatePaneRuntimeStateFn = (paneId, patch) => {
    dispatch({ type: "UPDATE_PANE_STATE", paneId, patch });
  };
  pluginRegistry.getPluginConfigValueFn = (pluginId, key) => (
    (state.config.pluginConfig[pluginId]?.[key] as any) ?? null
  );

  const setPluginConfigValues = async (pluginId: string, values: Record<string, unknown>) => {
    const nextConfig = {
      ...state.config,
      pluginConfig: {
        ...state.config.pluginConfig,
        [pluginId]: {
          ...(state.config.pluginConfig[pluginId] ?? {}),
          ...values,
        },
      },
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };

  pluginRegistry.setPluginConfigValueFn = async (pluginId, key, value) => {
    await setPluginConfigValues(pluginId, { [key]: value });
  };
  pluginRegistry.setPluginConfigValuesFn = setPluginConfigValues;
  pluginRegistry.deletePluginConfigValueFn = async (pluginId, key) => {
    const currentPluginConfig = state.config.pluginConfig[pluginId];
    if (!currentPluginConfig || !(key in currentPluginConfig)) return;

    const nextPluginConfig = { ...currentPluginConfig };
    delete nextPluginConfig[key];

    const nextAllPluginConfig = { ...state.config.pluginConfig };
    if (Object.keys(nextPluginConfig).length === 0) {
      delete nextAllPluginConfig[pluginId];
    } else {
      nextAllPluginConfig[pluginId] = nextPluginConfig;
    }

    const nextConfig = {
      ...state.config,
      pluginConfig: nextAllPluginConfig,
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };

  const configurableProvider = dataProvider as DataProvider & {
    setConfigAccessor?: (accessor: () => AppConfig) => void;
  };
  if (typeof configurableProvider.setConfigAccessor === "function") {
    configurableProvider.setConfigAccessor(() => state.config);
  }

  pluginRegistry.createBrokerInstanceFn = async (brokerType, label, values) => {
    const instanceId = createBrokerInstanceId(
      brokerType,
      label,
      state.config.brokerInstances.map((instance) => instance.id),
    );
    const instance: BrokerInstanceConfig = {
      id: instanceId,
      brokerType,
      label,
      connectionMode: typeof values.connectionMode === "string" ? values.connectionMode : undefined,
      config: values,
      enabled: true,
    };
    const nextConfig = {
      ...state.config,
      brokerInstances: [...state.config.brokerInstances, instance],
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
    return instance;
  };

  pluginRegistry.connectBrokerInstanceFn = async (instanceId) => {
    const instance = getBrokerInstance(state.config.brokerInstances, instanceId);
    if (!instance) throw new Error("Broker profile not found.");
    if (instance.enabled === false) throw new Error(`Broker profile "${instance.label}" is disabled.`);

    const broker = pluginRegistry.brokers.get(instance.brokerType);
    if (!broker) throw new Error(`Broker "${instance.brokerType}" is not available.`);

    await requireValidBroker(broker, instance);

    await broker.connect?.(instance);
    if (broker.listAccounts) {
      const accounts = await broker.listAccounts(instance);
      dispatch({ type: "SET_BROKER_ACCOUNTS", instanceId, accounts });
    }
  };

  pluginRegistry.updateBrokerInstanceFn = async (instanceId, values, options = {}) => {
    const currentInstance = state.config.brokerInstances.find((instance) => instance.id === instanceId);
    const nextInstances = state.config.brokerInstances.map((instance) =>
      instance.id === instanceId
        ? (() => {
          const nextValues = options.replaceConfig ? values : { ...instance.config, ...values };
          return {
            ...instance,
            label: options.label ?? instance.label,
            enabled: options.enabled ?? instance.enabled,
            connectionMode: typeof nextValues.connectionMode === "string" ? nextValues.connectionMode : instance.connectionMode,
            config: nextValues,
          };
        })()
        : instance,
    );
    const nextInstance = nextInstances.find((instance) => instance.id === instanceId);
    const broker = currentInstance ? pluginRegistry.brokers.get(currentInstance.brokerType) : null;
    const shouldClearBrokerAccounts = currentInstance
      && nextInstance
      && currentInstance.brokerType === nextInstance.brokerType
      && getBrokerAccountCacheSourceKey(currentInstance, broker) !== getBrokerAccountCacheSourceKey(nextInstance, broker);
    if (shouldClearBrokerAccounts) {
      clearPersistedBrokerAccounts(pluginRegistry.persistence.resources, currentInstance);
    }
    const nextConfig = {
      ...state.config,
      brokerInstances: nextInstances,
    };
    dispatch({ type: "SET_CONFIG", config: nextConfig });
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
  };

  pluginRegistry.syncBrokerInstanceFn = async (instanceId) => {
    await importBrokerPositions(instanceId);
  };

  pluginRegistry.removeBrokerInstanceFn = async (instanceId) => {
    const instance = getBrokerInstance(state.config.brokerInstances, instanceId);
    if (!instance) return;

    clearPersistedBrokerAccounts(pluginRegistry.persistence.resources, instance);

    const broker = pluginRegistry.brokers.get(instance.brokerType);
    const removedPortfolioIds = new Set(
      state.config.portfolios
        .filter((portfolio) => portfolio.brokerInstanceId === instanceId)
        .map((portfolio) => portfolio.id),
    );

    const nextPortfolios = state.config.portfolios.filter((portfolio) => !removedPortfolioIds.has(portfolio.id));
    const { nextTickers, removedSymbols, changedTickers } = applyBrokerInstanceRemovalToTickers(
      state.tickers.values(),
      instanceId,
      removedPortfolioIds,
    );
    await persistRemovedBrokerTickers(tickerRepository, nextTickers, removedSymbols, changedTickers);

    const nextConfig = {
      ...state.config,
      brokerInstances: state.config.brokerInstances.filter((entry) => entry.id !== instanceId),
      portfolios: nextPortfolios,
    };

    dispatch({ type: "SET_CONFIG", config: nextConfig });
    dispatch({ type: "SET_TICKERS", tickers: nextTickers });
    await saveConfigImmediately(nextConfig);
    pluginRegistry.events.emit("config:changed", { config: nextConfig });
    for (const symbol of removedSymbols) {
      pluginRegistry.events.emit("ticker:removed", { symbol });
    }
    // Adapter disconnect can hang on a native chunk / gateway RPC. Don't
    // block the Disconnect click on it — the instance is already removed.
    disconnectBrokerInBackground(broker?.disconnect, instance);
  };
}
