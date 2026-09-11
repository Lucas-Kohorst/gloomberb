import { expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import { setConfigStoreHost } from "../../../data/config/store";
import { hostedUserConfigStorageKey, setHostedConfigUserId, writeHostedUserConfig } from "../../../data/config/hosted-user-persist";
import { hostedSessionStorageKey, writeHostedSessionSnapshot } from "../../../data/config/hosted-session-persist";
import { scheduleConfigSave } from "../../../state/config-save-scheduler";
import { createPersistScheduler, flushPendingPersistence } from "../../../state/persist-scheduler";
import { installPersistenceLifecycle } from "./persistence-lifecycle";

test("pagehide and backgrounding checkpoint the latest config and session before returning", async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  const userId = "page-exit-user";
  setHostedConfigUserId(userId);
  const config = createDefaultConfig(`cloud://users/${userId}`);
  setConfigStoreHost({
    async saveConfig(value) { writeHostedUserConfig(value); },
    async loadConfig() { return config; },
    async initDataDir() { return config; },
    async getDataDir() { return config.dataDir; },
    async resetAllData() {},
    async exportConfig() {},
    async importConfig() { return config; },
  });
  const session = createPersistScheduler<string>({
    delayMs: 60_000,
    save: (focusedPaneId) => writeHostedSessionSnapshot({
      focusedPaneId, paneState: {}, activePanel: "left", statusBarVisible: true,
      openPaneIds: [], hydrationTargets: [], exchangeCurrencies: [], savedAt: 1,
    }),
  });
  const page = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const uninstall = installPersistenceLifecycle(page, document);
  try {
    scheduleConfigSave({ ...config, baseCurrency: "GBP" });
    scheduleConfigSave({ ...config, baseCurrency: "EUR" });
    session.schedule("old-pane");
    session.schedule("chart-pane");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(values.size).toBe(0);
    page.dispatchEvent(new Event("pagehide"));
    expect(JSON.parse(values.get(hostedUserConfigStorageKey(userId))!).config.baseCurrency).toBe("EUR");
    expect(JSON.parse(values.get(hostedSessionStorageKey(userId))!).focusedPaneId).toBe("chart-pane");
    await flushPendingPersistence();
    // Let the completed save chains settle before the next browser event.
    await new Promise((resolve) => setTimeout(resolve, 0));
    scheduleConfigSave({ ...config, baseCurrency: "JPY" });
    session.schedule("next-pane");
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(JSON.parse(values.get(hostedUserConfigStorageKey(userId))!).config.baseCurrency).toBe("JPY");
    expect(JSON.parse(values.get(hostedSessionStorageKey(userId))!).focusedPaneId).toBe("next-pane");
  } finally {
    uninstall();
    await flushPendingPersistence();
    session.cancel();
    setConfigStoreHost(null);
    setHostedConfigUserId(null);
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
