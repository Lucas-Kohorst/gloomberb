import { expect, jest, spyOn, test } from "bun:test";
import { act } from "react";
import { testRender } from "../renderers/opentui/test-utils";
import { createInitialState } from "../core/state/app/state";
import { createDefaultConfig } from "../types/config";
import type { PluginRegistry } from "../plugins/registry";
import type { AppTickerRepositoryPort } from "../core/app-service-ports";
import { cloudSyncController } from "./controller";
import { useCloudSyncRuntime } from "./react";

test("a background client keeps pulling and stops its timer when unmounted", async () => {
  jest.useFakeTimers();
  const sync = spyOn(cloudSyncController, "requestSync").mockResolvedValue(undefined);
  const state = createInitialState(createDefaultConfig("/tmp/background-sync"));
  const registry = {
    persistence: { pluginState: { get: () => null, set: () => {} } },
    getEnabledSyncContributors: () => [],
    getActiveSyncTransport: () => null,
  } as unknown as PluginRegistry;
  let renderer: Awaited<ReturnType<typeof testRender>> | undefined;
  function Client() {
    useCloudSyncRuntime({
      state, getState: () => state, dispatch: () => {},
      tickerRepository: {} as AppTickerRepositoryPort,
      pluginRegistry: registry, initialized: true, appActive: false,
    });
    return null;
  }
  try {
    await act(async () => { renderer = await testRender(<Client />, {width: 80,height: 24}); });
    sync.mockClear();
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(sync).toHaveBeenCalledWith({ reason: "poll" });
    await act(async () => { renderer!.renderer.destroy(); });
    renderer = undefined;
    sync.mockClear();
    jest.advanceTimersByTime(4000);
    expect(sync).not.toHaveBeenCalled();
  } finally {
    if (renderer) await act(async () => { renderer!.renderer.destroy(); });
    sync.mockRestore();
    jest.useRealTimers();
  }
});
