import { useEffect, useSyncExternalStore, type Dispatch } from "react";
import { apiClient } from "../api-client";
import { setHostedConfigUserId, peekHostedUserConfigStamp, writeHostedUserConfig } from "../data/config/hosted-user-persist";
import { fetchHostedConfigSnapshot, mergeRemoteConfigSnapshot } from "../data/config/hosted-config-snapshot";
import { hydrateHostedByokConfig } from "../plugins/builtin/byok/hosted-persist";
import type { AppAction, AppState } from "../core/state/app/state";
import type { AppTickerRepositoryPort } from "../core/app-service-ports";
import type { PluginRegistry } from "../plugins/registry";
import { cloudSyncController } from "./controller";

interface CloudSyncRuntimeOptions {
  state: AppState;
  getState: () => AppState;
  dispatch: Dispatch<AppAction>;
  tickerRepository: AppTickerRepositoryPort;
  pluginRegistry: PluginRegistry;
  initialized: boolean;
}

export function useCloudSyncRuntime({
  state,
  getState,
  dispatch,
  tickerRepository,
  pluginRegistry,
  initialized,
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
    if (!initialized) return;
    cloudSyncController.schedulePush("state-change");
  }, [initialized, state.config, state.tickers]);

  useEffect(() => {
    let lastUserId: string | null = apiClient.getCurrentUser()?.id ?? null;
    const syncSignedInUser = async () => {
      const userId = apiClient.getCurrentUser()?.id ?? null;
      setHostedConfigUserId(userId);
      if (!initialized) return;
      if (userId && userId !== lastUserId) {
        // User signed in (possibly after sign-out). Reset the sync pull state
        // so Gloom Cloud is re-pulled with the new session, and try to restore
        // the server-side config snapshot before the sync pull runs.
        cloudSyncController.resetPullState();
        try {
          const remote = await fetchHostedConfigSnapshot();
          const localStamp = peekHostedUserConfigStamp();
          const currentState = getState();
          const merged = mergeRemoteConfigSnapshot(
            currentState.config,
            remote,
            localStamp?.updatedAt ?? null,
          );
          if (merged) {
            dispatch({ type: "SET_CONFIG", config: merged });
            writeHostedUserConfig(merged);
            hydrateHostedByokConfig(merged);
          }
        } catch {
          // Network failure — the sync pull will still run as a fallback.
        }
      }
      lastUserId = userId;
      if (!apiClient.isVerified()) return;
      void cloudSyncController.requestSync({ reason: "signed-in" });
    };
    void syncSignedInUser();
    return apiClient.subscribeCurrentUser(() => void syncSignedInUser());
  }, [initialized, dispatch, getState]);
}

export function useCloudSyncStatus() {
  return useSyncExternalStore(
    (listener) => cloudSyncController.subscribe(listener),
    () => cloudSyncController.getStatus(),
    () => cloudSyncController.getStatus(),
  );
}
