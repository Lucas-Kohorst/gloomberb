import { useEffect, useMemo, useSyncExternalStore, type Dispatch } from "react";
import { isHostedWebClient } from "../shared/hosted-api";
import { apiClient } from "../api-client";
import {
  hydrateHostedUserConfig,
  rememberHostedUserId,
  setHostedConfigUserId,
} from "../data/config/hosted-user-persist";
import { fetchHostedConfigSnapshot } from "../data/config/hosted-config-snapshot";
import {
  hydrateHostedWorkspaceFromCloud,
  cloneAppConfigForOverlay,
  isHostedWorkspaceHydrationCurrent,
  persistHostedWorkspaceHydration,
  type HostedSyncPull,
} from "../data/config/hosted-sync-hydrate";
import { readHostedTickers } from "../data/config/hosted-ticker-persist";
import { hydrateHostedByokConfig } from "../plugins/builtin/byok/hosted-persist";
import type { AppConfig } from "../types/config";
import { createDefaultConfig } from "../types/config";
import type { AppAction, AppState } from "../core/state/app/state";
import type { AppTickerRepositoryPort } from "../core/app-service-ports";
import type { PluginRegistry } from "../plugins/registry";
import { subscribeToCloudVerification } from "./auth-transition";
import { createSyncBaselineStore } from "./baseline";
import { cloudSyncController } from "./controller";
import type { TickerRecord } from "../types/ticker";
import { isPublicShareLocation } from "../plugins/builtin/shared/share-link";
import { whenStartupBackground } from "../utils/startup-interaction";

function tickerMap(tickers: TickerRecord[]): Map<string, TickerRecord> {
  return new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker]));
}

export async function applyHostedCloudOverlay(args: {
  capturedConfig: AppConfig;
  baseConfig?: AppConfig;
  getState: () => AppState;
  dispatch: Dispatch<AppAction>;
  tickerRepository: AppTickerRepositoryPort;
  beforeApply?: Promise<void>;
  pullConfig?: typeof fetchHostedConfigSnapshot;
  pullSync?: () => Promise<HostedSyncPull>;
}): Promise<boolean> {
  const working = cloneAppConfigForOverlay(args.baseConfig ?? args.capturedConfig);
  const hydrated = await hydrateHostedWorkspaceFromCloud(working, {
    pullConfig: args.pullConfig ?? fetchHostedConfigSnapshot,
    pullSync: args.pullSync ?? (() => apiClient.getSyncSnapshot()),
    persist: false,
  });
  if (args.beforeApply) await args.beforeApply;
  if (
    args.getState().config !== args.capturedConfig
    || !isHostedWorkspaceHydrationCurrent(hydrated)
  ) return false;
  if (!persistHostedWorkspaceHydration(hydrated)) return false;
  args.dispatch({ type: "SET_CONFIG", config: hydrated.config });
  // An empty overlay must not replace the sqlite book. That is how Main
  // Portfolio went blank while ~/.gloomberb still had the holdings.
  if (hydrated.tickers.length > 0) {
    args.dispatch({ type: "SET_TICKERS", tickers: tickerMap(hydrated.tickers) });
    await Promise.all(hydrated.tickers.map((ticker) => args.tickerRepository.saveTicker(ticker)));
  }
  return true;
}

function configForHostedAccount(current: AppConfig, userId: string): AppConfig {
  if (!current.dataDir.startsWith("cloud:") && !current.dataDir.startsWith("browser:")) {
    return current;
  }
  const dataDir = current.dataDir.startsWith("cloud:")
    ? `cloud://users/${userId}`
    : current.dataDir;
  const config = createDefaultConfig(dataDir);
  config.onboardingComplete = true;
  hydrateHostedUserConfig(config, userId);
  hydrateHostedByokConfig(config, userId);
  return config;
}

function isUserScopedConfig(config: AppConfig): boolean {
  return config.dataDir.startsWith("cloud:") || config.dataDir.startsWith("browser:");
}

function configForSignedOutAccount(current: AppConfig): AppConfig {
  const dataDir = current.dataDir.startsWith("cloud:")
    ? "cloud://users/anonymous"
    : current.dataDir;
  return createDefaultConfig(dataDir);
}

const CLOUD_SYNC_POLL_MS = 2_000;

interface CloudSyncRuntimeOptions {
  state: AppState;
  getState: () => AppState;
  dispatch: Dispatch<AppAction>;
  tickerRepository: AppTickerRepositoryPort;
  pluginRegistry: PluginRegistry;
  initialized: boolean;
  appActive?: boolean;
}

export function useCloudSyncRuntime({
  state,
  getState,
  dispatch,
  tickerRepository,
  pluginRegistry,
  initialized,
  appActive = true,
}: CloudSyncRuntimeOptions): void {
  const baselineStore = useMemo(
    () => createSyncBaselineStore(pluginRegistry.persistence.pluginState),
    [pluginRegistry],
  );

  useEffect(() => {
    return cloudSyncController.setRuntime({
      getState,
      dispatch,
      tickerRepository,
      baselineStore,
      getContributors: () => pluginRegistry.getEnabledSyncContributors(),
      getTransport: () => pluginRegistry.getActiveSyncTransport(),
    });
  }, [baselineStore, dispatch, getState, pluginRegistry, tickerRepository]);

  useEffect(() => {
    if (!initialized) return;
    void cloudSyncController.requestSync({ reason: "startup" });
  }, [initialized, pluginRegistry]);

  useEffect(() => {
    if (!initialized) return;
    const timer = setInterval(() => {
      void cloudSyncController.requestSync({ reason: "poll" });
    }, CLOUD_SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [initialized]);

  useEffect(() => {
    if (initialized && appActive) void cloudSyncController.requestSync({ reason: "foreground" });
  }, [appActive, initialized]);

  useEffect(() => subscribeToCloudVerification(apiClient, () => {
    if (!initialized) return;
    // Email verification makes the Cloud transport available. Force the first
    // sync so a workspace completed before verification is uploaded promptly.
    void cloudSyncController.requestSync({ reason: "session-verified", force: true });
  }), [initialized]);

  useEffect(() => {
    if (!initialized) return;
    cloudSyncController.schedulePush("state-change");
  }, [initialized, state.config, state.tickers]);

  useEffect(() => {
    let lastUserId: string | null = apiClient.getCurrentUser()?.id ?? null;
    const syncSignedInUser = async () => {
      const userId = apiClient.getCurrentUser()?.id ?? null;
      const hosted = isHostedWebClient();
      const hostedAuthenticated = (globalThis as { __GLOOM_CLOUD_AUTHENTICATED?: boolean }).__GLOOM_CLOUD_AUTHENTICATED === true;
      if (!userId && hosted && hostedAuthenticated) return;
      const previousUserId = lastUserId;
      lastUserId = userId;
      if (userId) {
        setHostedConfigUserId(userId);
        rememberHostedUserId(userId);
      } else if (!hosted || !hostedAuthenticated) {
        setHostedConfigUserId(userId);
        rememberHostedUserId(null);
      }
      if (!initialized) return;
      if (userId !== previousUserId) {
        const currentConfig = getState().config;
        if (isUserScopedConfig(currentConfig)) {
          dispatch({
            type: "SET_CONFIG",
            config: userId
              ? configForHostedAccount(currentConfig, userId)
              : configForSignedOutAccount(currentConfig),
          });
        }
        // Switching Gloom Cloud accounts must not keep the previous book.
        // Account 2 with no snapshot stays empty. A first sign-in with an
        // empty local book must not wipe tickers already in memory (boot
        // hydrate / repository) — that race is how watchlists vanish on refresh.
        const localTickers = readHostedTickers(userId);
        const switchingAccounts = !!previousUserId && previousUserId !== userId;
        if (localTickers.length > 0 || switchingAccounts) {
          dispatch({ type: "SET_TICKERS", tickers: tickerMap(localTickers) });
        }
      }
      if (userId && userId !== previousUserId) {
        // User signed in (possibly after sign-out). Reset the sync pull state
        // so Gloom Cloud is re-pulled with the new session, and restore the
        // Worker + Cloud snapshots the same way boot does.
        cloudSyncController.resetPullState();
        const capturedConfig = getState().config;
        await applyHostedCloudOverlay({
          capturedConfig,
          getState,
          dispatch,
          tickerRepository,
        }).catch(() => false);
      }
      if (!apiClient.isVerified()) return;
      void cloudSyncController.requestSync({ reason: "signed-in" });
    };
    void syncSignedInUser();
    return apiClient.subscribeCurrentUser(() => void syncSignedInUser());
  }, [initialized, dispatch, getState, tickerRepository]);
}

export function useCloudSyncStatus() {
  return useSyncExternalStore(
    (listener) => cloudSyncController.subscribe(listener),
    () => cloudSyncController.getStatus(),
    () => cloudSyncController.getStatus(),
  );
}
