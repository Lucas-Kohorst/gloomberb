import { expect, jest, test } from "bun:test";
import { appReducer, createInitialState, type AppAction } from "../core/state/app/state";
import { createDefaultConfig } from "../types/config";
import { coreConfigSyncContributor } from "./core-contributors";
import { CloudSyncController } from "./controller";
import type { SyncSnapshot, SyncTransport } from "./types";
import type { TickerRepository } from "../data/ticker-repository";

function sharedAccount() {
  let snapshot: SyncSnapshot | null = null;
  let revision = 0;
  const transport: SyncTransport = {
    id: "account",
    isAvailable: () => true,
    pullSnapshot: async () => ({ snapshot: structuredClone(snapshot), revision, updatedAt: new Date().toISOString() }),
    pushSnapshot: async (value, options) => {
      if (options?.baseRevision !== revision) throw new Error("Revision conflict");
      snapshot = structuredClone(value);
      return { revision: ++revision, updatedAt: new Date().toISOString() };
    },
  };
  const clients = ["web", "desktop", "tui"].map((name) => {
    let state = createInitialState(createDefaultConfig(`/tmp/layout-sync-${name}`));
    const controller = new CloudSyncController();
    const dispatch = (action: AppAction) => { state = appReducer(state, action); };
    controller.setRuntime({
      getState: () => state,
      dispatch,
      tickerRepository: {} as TickerRepository,
      getContributors: () => [{ pluginId: "core", contributor: coreConfigSyncContributor }],
      getTransport: () => ({ pluginId: "cloud", transport }),
    });
    return { controller, dispatch, getState: () => state };
  });
  return clients;
}

test("continuous updates cannot postpone a layout upload indefinitely", async () => {
  jest.useFakeTimers();
  const clients = sharedAccount();
  try {
    const [web, desktop] = clients;
    for (const client of clients) await client.controller.requestSync();
    web!.dispatch({ type: "NEW_LAYOUT", name: "Web arrangement", activate: true });
    for (let i = 0; i < 10; i++) {
      web!.controller.schedulePush("state-change");
      jest.advanceTimersByTime(100);
      for (let step = 0; step < 20; step++) await Promise.resolve();
    }
    await desktop!.controller.requestSync();
    expect(desktop!.getState().config.layouts.some((layout) => layout.name === "Web arrangement")).toBe(true);
  } finally {
    clients.forEach((client) => client.controller.clearRuntime());
    jest.useRealTimers();
  }
});

test("layout edits travel in every direction through the real config contributor", async () => {
  const clients = sharedAccount();
  try {
    for (const client of clients) await client.controller.requestSync();
    for (const [index, source] of clients.entries()) {
      const layout = source.getState().config.layout;
      if (layout.dockRoot?.kind !== "split") throw new Error("Expected docked workspace");
      source.dispatch({ type: "UPDATE_LAYOUT", layout: {
        ...layout,
        dockRoot: { ...layout.dockRoot, ratio: 0.25 + index * 0.15,
          first: layout.dockRoot.second, second: layout.dockRoot.first },
      } });
      await source.controller.requestSync();
      for (const target of clients) {
        await target.controller.requestSync();
        const config = target.getState().config;
        expect(config.layouts[config.activeLayoutIndex]!.layout).toEqual(source.getState().config.layout);
        expect(target.getState().config.layout).toEqual(source.getState().config.layout);
      }
    }
  } finally {
    clients.forEach((client) => client.controller.clearRuntime());
  }
});
