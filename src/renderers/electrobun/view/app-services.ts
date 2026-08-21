import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { createRemoteBrokerAdapter } from "../../../brokers/remote-broker-adapter";
import { NewsService } from "../../../news/aggregator";
import { setSharedNewsService } from "../../../news/hooks";
import { newsPollIntervalMsFromMinutes } from "../../../news/poll-interval";
import { PluginRegistry } from "../../../plugins/registry";
import type { AppRuntimeServices, AppServicesFactoryOptions } from "../../../core/app-service-ports";
import { newsProvider } from "../../../capabilities";
import type { NewsCapability } from "../../../capabilities";
import { debugLog } from "../../../utils/debug-log";
import { settleWithinBudget } from "../../../utils/async-deadline";
import { measurePerf, measurePerfAsync } from "../../../utils/perf-marks";
import { getRendererBuiltinPlugins } from "../../../plugins/catalog-ui";
import { createRemoteAssetDataClient } from "./remote/asset-data-client";
import { RemotePersistence } from "./remote/persistence";
import { RemoteTickerRepository } from "./remote/ticker-repository";
import { createGloomberbCloudCapabilities, createGloomberbCloudProvider } from "../../../sources/gloomberb-cloud";
import { CoinGeckoProvider } from "../../../sources/coingecko/provider";
import { AssetDataRouter } from "../../../sources/provider-router";
import { YahooFinanceClient } from "../../../sources/yahoo-finance";
import { createGloomberbCloudSyncTransport } from "../../../plugins/builtin/cloud/plugin";
import { getElectrobunBackendInitSnapshot } from "./backend-rpc";

declare global {
  interface Window {
    __GLOOM_CLOUD_HOSTED?: boolean;
    __GLOOM_CLOUD_AUTHENTICATED?: boolean;
  }
}

const servicesLog = debugLog.createLogger("services");
const PLUGIN_REGISTRATION_BUDGET_MS = 5_000;

export function createElectrobunAppServices({ config }: AppServicesFactoryOptions): AppRuntimeServices {
  servicesLog.info("create desktop web services start", {
    brokerInstanceCount: config.brokerInstances.length,
  });
  const persistence = measurePerf("startup.services.persistence", () => new RemotePersistence());
  const tickerRepository = measurePerf("startup.services.ticker-repository", () => new RemoteTickerRepository());
  const hosted = window.__GLOOM_CLOUD_HOSTED === true
    || getElectrobunBackendInitSnapshot()?.desktopPlatform === "cloud";
  const cloudProvider = hosted ? createGloomberbCloudProvider() : null;
  const cloudNewsCapability = cloudProvider
    ? createGloomberbCloudCapabilities(cloudProvider).find(
      (capability): capability is NewsCapability => capability.kind === "news",
    )
    : null;
  const remoteDataProvider = cloudProvider ? null : createRemoteAssetDataClient();
  // Hosted skips plugin.capabilities invoke handlers. Cloud and Yahoo both
  // refuse CCC crypto, so CoinGecko must be on the router extra-source list
  // (not only registered later in plugin setup) for LAST/CHG%/MCAP.
  const dataProvider = measurePerf("startup.services.data-provider", () => (
    cloudProvider
      ? new AssetDataRouter(
        new YahooFinanceClient(),
        [cloudProvider, new CoinGeckoProvider()],
        persistence.resources,
      )
      : remoteDataProvider!
  ));
  const marketData = new MarketDataCoordinator(dataProvider);
  const pluginRegistry = new PluginRegistry(dataProvider, tickerRepository, persistence, {
    enableCapabilityHandlers: false,
    wrapBrokerAdapter: (broker) => createRemoteBrokerAdapter(broker),
  });
  if (cloudProvider && dataProvider instanceof AssetDataRouter) {
    dataProvider.attachRegistry(pluginRegistry);
  }
  pluginRegistry.getConfigFn = () => config;
  const newsService = new NewsService({
    pollIntervalMs: () => newsPollIntervalMsFromMinutes(pluginRegistry.getConfigFn().refreshIntervalMinutes),
  });

  pluginRegistry.getLayoutFn = () => config.layout;
  pluginRegistry.registerNewsCapabilityFn = (capability) => newsService.register(capability);
  pluginRegistry.watchNewsQueryFn = (query, listener) => newsService.watchQuery(query, listener);

  setSharedMarketDataCoordinator(marketData);
  setSharedNewsService(newsService);

  newsService.register(newsProvider({
    id: dataProvider.id,
    name: dataProvider.name,
    priority: 0,
    provider: {
      fetchNews: (query) => (
        cloudNewsCapability?.kind === "news"
          ? cloudNewsCapability.provider.fetchNews(query)
          : remoteDataProvider
            ? remoteDataProvider.getNews(query)
            : Promise.resolve([])
      ),
    },
  }));

  const plugins = getRendererBuiltinPlugins();
  const pluginReadyPromises: Promise<void>[] = [];
  for (const plugin of plugins) {
    pluginReadyPromises.push(settleWithinBudget(
      measurePerfAsync("startup.services.register-plugin", () => (
        pluginRegistry.register(plugin)
      ), { pluginId: plugin.id }),
      PLUGIN_REGISTRATION_BUDGET_MS,
      `Plugin registration timed out: ${plugin.id}`,
      (error) => {
        servicesLog.error("Plugin registration did not complete during startup", {
          pluginId: plugin.id,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    ));
  }
  const disposeHostedSyncTransport = hosted
    ? pluginRegistry.registerSyncTransportForPlugin(
      "gloomberb-cloud",
      createGloomberbCloudSyncTransport(() => window.__GLOOM_CLOUD_AUTHENTICATED === true),
    )
    : null;
  measurePerf("startup.services.news-start", () => {
    newsService.start();
  });
  servicesLog.info("create desktop web services complete", { pluginCount: plugins.length });

  return {
    persistence,
    tickerRepository,
    dataProvider,
    marketData,
    pluginRegistry,
    ready: Promise.all(pluginReadyPromises).then(() => {}),
    destroy() {
      disposeHostedSyncTransport?.();
      setSharedMarketDataCoordinator(null);
      setSharedNewsService(null);
      newsService.stop();
      pluginRegistry.destroy();
      persistence.close();
    },
  };
}
