import { isHostedWebClient } from "../../../shared/hosted-api";
import { MarketDataCoordinator, setSharedMarketDataCoordinator } from "../../../market-data/coordinator";
import { createRemoteBrokerAdapter, shouldWrapBrokerAdaptersForRemoteHost } from "../../../brokers/remote-broker-adapter";
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
import { createRemoteAssetDataClient } from "./remote/asset-data-client";
import { RemotePersistence } from "./remote/persistence";
import { RemoteTickerRepository } from "./remote/ticker-repository";
import { connectBackendConnectionHealth } from "./remote/connection-health-backend";
import { backendRequest, getElectrobunBackendInitSnapshot } from "./backend-rpc";
import { createCapabilityInvoker } from "./remote/capability-invoker";
import { apiClient } from "../../../api-client";
import { cloudNewsParams, mapCloudNewsArticle } from "../../../sources/gloomberb-cloud/news";

const servicesLog = debugLog.createLogger("services");
const PLUGIN_REGISTRATION_BUDGET_MS = 5_000;

export function createElectrobunAppServices({ config, plugins }: AppServicesFactoryOptions): AppRuntimeServices {
  servicesLog.info("create desktop web services start", {
    brokerInstanceCount: config.brokerInstances.length,
  });
  const persistence = measurePerf("startup.services.persistence", () => new RemotePersistence());
  const tickerRepository = measurePerf("startup.services.ticker-repository", () => new RemoteTickerRepository());
  const hosted = isHostedWebClient()
    || getElectrobunBackendInitSnapshot()?.desktopPlatform === "cloud";
  const cloudProvider = hosted ? createGloomberbCloudProvider() : null;
  const cloudNewsCapability = cloudProvider
    ? createGloomberbCloudCapabilities(cloudProvider).find(
      (capability): capability is NewsCapability => capability.kind === "news",
    )
    : null;
  const remoteDataProvider = cloudProvider ? null : createRemoteAssetDataClient();
  const dataProvider = measurePerf("startup.services.data-provider", () => (
    cloudProvider
      ? new AssetDataRouter(
        new YahooFinanceClient(),
        [cloudProvider],
        persistence.resources,
      )
      : remoteDataProvider!
  ));
  const marketData = new MarketDataCoordinator(dataProvider);
  const invokeCapability = createCapabilityInvoker({
    request: backendRequest,
    shouldApplyDeadline: () => false,
    timeoutMs: 0,
  });
  const pluginRegistry = new PluginRegistry(dataProvider, tickerRepository, persistence, {
    enableCapabilityHandlers: false,
    wrapBrokerAdapter: (broker) => createRemoteBrokerAdapter(broker),
    remoteCapabilityManifests: () => getElectrobunBackendInitSnapshot()?.capabilityManifests ?? [],
    remoteCapabilityInvoke: (capabilityId, operationId, payload, options) => (
      invokeCapability(capabilityId, operationId, payload, options)
    ),
  });
  const newsService = new NewsService({ connectionHealth: pluginRegistry.connectionHealth });

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
    id: "gloomberb-cloud",
    name: "Wire",
    priority: 0,
    provider: {
      fetchNews: (query) => dataProvider.getNews(query),
      fetchNewsPage: async (query) => {
        try {
          const response = await apiClient.getCloudNews(cloudNewsParams(query));
          return {
            articles: response.items.map((item) => mapCloudNewsArticle(item, query.ticker)),
            nextCursor: response.nextCursor ?? null,
          };
        } catch {
          return { articles: await dataProvider.getNews(query), nextCursor: null };
        }
      },
    },
  }));

  const pluginReadyPromises: Promise<void>[] = [];
  for (const plugin of allPlugins) {
    const entryFile = externalPluginPaths[plugin.id];
    pluginReadyPromises.push(settleWithinBudget(
      measurePerfAsync("startup.services.register-plugin", () => (
        entryFile
          ? pluginRegistry.registerExternalPlugin(plugin, entryFile)
          : pluginRegistry.register(plugin)
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
  let destroyed = false;
  let disposeRemoteConnectionHealth: (() => void) | null = null;
  const ready = Promise.all(pluginReadyPromises).then(() => {
    if (destroyed) return;
    const dispose = connectBackendConnectionHealth(pluginRegistry.connectionHealth);
    if (destroyed) dispose();
    else disposeRemoteConnectionHealth = dispose;
  });
  servicesLog.info("create desktop web services complete", { pluginCount: plugins.length });

  return {
    persistence,
    tickerRepository,
    dataProvider,
    marketData,
    pluginRegistry,
    ready,
    destroy() {
      destroyed = true;
      disposeRemoteConnectionHealth?.();
      disposeRemoteConnectionHealth = null;
      setSharedMarketDataCoordinator(null);
      setSharedNewsService(null);
      newsService.stop();
      pluginRegistry.destroy();
      persistence.close();
    },
  };
}
