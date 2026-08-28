import { useEffect, useSyncExternalStore, type Dispatch } from "react";
import { isHostedWebClient } from "../shared/hosted-api";
import { apiClient } from "../api-client";
import { setHostedConfigUserId, peekHostedUserConfigStamp, writeHostedUserConfig } from "../data/config/hosted-user-persist";
import { fetchHostedConfigSnapshot, mergeRemoteConfigSnapshot } from "../data/config/hosted-config-snapshot";
import { hydrateHostedWorkspaceFromCloud, cloneAppConfigForOverlay } from "../data/config/hosted-sync-hydrate";
import { readHostedTickers } from "../data/config/hosted-ticker-persist";
import { hydrateHostedByokConfig } from "../plugins/builtin/byok/hosted-persist";
import type { AppConfig } from "../types/config";
import type { AppAction, AppState } from "../core/state/app/state";
import type { AppTickerRepositoryPort } from "../core/app-service-ports";
import type { PluginRegistry } from "../plugins/registry";
import { subscribeToCloudVerification } from "./auth-transition";
import { cloudSyncController } from "./controller";
import type { TickerRecord } from "../types/ticker";
import { isPublicShareLocation } from "../plugins/builtin/shared/share-link";
import { whenStartupBackground } from "../utils/startup-interaction";

const CLOUD_SYNC_POLL_MS = 15_000;

interface CloudSyncRuntimeOptions {
  state: AppState;
  getState: () => AppState;
  dispatch: Dispatch<AppAction>;
  tickerRepository: AppTickerRepositoryPort;
  pluginRegistry: PluginRegistry;
  initialized: boolean;
  appActive?: boolean;
}

function tickerMap(tickers: TickerRecord[]): Map<string, TickerRecord> {
  return new Map(tickers.map((ticker) => [ticker.metadata.ticker, ticker]));
}

async function applyHostedCloudOverlay(args: {
  capturedConfig: AppConfig;
  getState: () => AppState;
  dispatch: Dispatch<AppAction>;
  tickerRepository: AppTickerRepositoryPort;
  /** Resolves before SET_CONFIG so first-paint pointer frames stay free. */
  beforeApply?: Promise<void>;
}): Promise<void> {
  const working = cloneAppConfigForOverlay(args.capturedConfig);
  const hydrated = await hydrateHostedWorkspaceFromCloud(working, {
    pullConfig: fetchHostedConfigSnapshot,
    pullSync: () => apiClient.getSyncSnapshot(),
    persist: false,
  });
  if (args.beforeApply) await args.beforeApply;
  if (args.getState().config !== args.capturedConfig) return;
  args.dispatch({ type: "SET_CONFIG", config: hydrated.config });
  args.dispatch({ type: "SET_TICKERS", tickers: tickerMap(hydrated.tickers) });
  writeHostedUserConfig(hydrated.config);
  hydrateHostedByokConfig(hydrated.config);
  for (const ticker of hydrated.tickers) {
    await args.tickerRepository.saveTicker(ticker);
  }
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
  useEffect(() => {
    return cloudSyncController.setRuntime({
      getState,
      dispatch,
      tickerRepository,
      getContributors: () => pluginRegistry.getEnabledSyncContributors(),
      getTransport: () => pluginRegistry.getActiveSyncTransport(),
    });
  }, [dispatch, getState, pluginRegistry, tickerRepository]);

  useEffect(() => {
    if (!initialized) return;
    void cloudSyncController.requestSync({ reason: "startup" });
  }, [initialized, pluginRegistry]);

  useEffect(() => {
    if (!initialized || !isHostedWebClient()) return;
    if (isPublicShareLocation()) return;
    if ((globalThis as { __GLOOM_CLOUD_AUTHENTICATED?: boolean }).__GLOOM_CLOUD_AUTHENTICATED !== true) {
      return;
    }
    const capturedConfig = getState().config;
    void applyHostedCloudOverlay({
      capturedConfig,
      getState,
      dispatch,
      tickerRepository,
      beforeApply: whenStartupBackground(),
    }).catch(() => {
      // Network or parse failure — keep the local first-paint workspace.
    });
  }, [initialized, dispatch, getState, tickerRepository]);

  useEffect(() => {
    if (!initialized || !appActive) return;
    void cloudSyncController.requestSync({ reason: "foreground" });
    const timer = setInterval(() => {
      void cloudSyncController.requestSync({ reason: "poll" });
    }, CLOUD_SYNC_POLL_MS);
    return () => clearInterval(timer);
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
      if (userId) {
        setHostedConfigUserId(userId);
      } else if (!hosted || !hostedAuthenticated) {
        setHostedConfigUserId(userId);
      }
      if (!initialized) return;
      if (userId !== lastUserId) {
        // Switching Gloom Cloud accounts must not keep the previous book.
        // Account 2 with no snapshot stays empty. A first sign-in with an
        // empty local book must not wipe tickers already in memory (boot
        // hydrate / repository) — that race is how watchlists vanish on refresh.
        const localTickers = readHostedTickers(userId);
        const switchingAccounts = !!lastUserId && lastUserId !== userId;
        if (localTickers.length > 0 || switchingAccounts) {
          dispatch({ type: "SET_TICKERS", tickers: tickerMap(localTickers) });
        }
      }
      if (userId && userId !== lastUserId) {
        // User signed in (possibly after sign-out). Reset the sync pull state
        // so Gloom Cloud is re-pulled with the new session, and restore the
        // Worker + Cloud snapshots the same way boot does.
        cloudSyncController.resetPullState();
        try {
          await applyHostedCloudOverlay({
            capturedConfig: getState().config,
            getState,
            dispatch,
            tickerRepository,
          });
        } catch {
          const remote = await fetchHostedConfigSnapshot().catch(() => null);
          if (remote) {
            const merged = mergeRemoteConfigSnapshot(
              getState().config,
              remote,
              peekHostedUserConfigStamp()?.updatedAt ?? null,
            );
            if (merged) {
              dispatch({ type: "SET_CONFIG", config: merged });
              writeHostedUserConfig(merged);
              hydrateHostedByokConfig(merged);
            }
          }
        }
      }
      lastUserId = userId;
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
