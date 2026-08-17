import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID, type ByokStoredConfig } from "../../plugins/builtin/byok/types";
import {
  mergeRemoteConfigSnapshot,
  stripByokKeysForSnapshot,
} from "./hosted-config-snapshot";
import { setHostedConfigUserId, writeHostedUserConfig, peekHostedUserConfigStamp } from "./hosted-user-persist";

function installMemoryStorage(): void {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: store,
  });
}

const byokKeys: ByokStoredConfig = {
  keys: [{
    id: "byok-1",
    serviceId: "adjacent",
    name: "Adjacent",
    apiKey: "sk-live-secret-123",
    createdAt: 1,
    lastValidationStatus: "untested",
  }],
};

describe("hosted config snapshot", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    globalThis.localStorage?.clear();
  });

  test("strips BYOK API keys from the snapshot", () => {
    const config = createDefaultConfig("cloud://users/user-1");
    config.pluginConfig = {
      [BYOK_PLUGIN_ID]: { [BYOK_API_KEYS_CONFIG_KEY]: byokKeys },
      news: { feeds: [{ id: "f1", url: "https://example.com/rss", name: "Feed" }] },
    };
    config.theme = "amber";

    const stripped = stripByokKeysForSnapshot(config);

    expect(stripped.pluginConfig[BYOK_PLUGIN_ID]?.[BYOK_API_KEYS_CONFIG_KEY]).toEqual({ keys: [] });
    expect(stripped.pluginConfig.news).toEqual(config.pluginConfig.news);
    expect(stripped.theme).toBe("amber");
    expect(JSON.stringify(stripped)).not.toContain("sk-live-secret-123");
  });

  test("a newer local save beats a stale remote snapshot", () => {
    setHostedConfigUserId("user-1");
    const local = createDefaultConfig("cloud://users/user-1");
    local.theme = "amber";
    // Write local at 2026-08-17T12:00:00Z
    writeHostedUserConfig(local);
    const localStamp = peekHostedUserConfigStamp();
    expect(localStamp).not.toBeNull();

    const base = createDefaultConfig("cloud://users/user-1");
    const remote = {
      config: { ...createDefaultConfig("cloud://users/user-1"), theme: "default" } as unknown as Record<string, unknown>,
      updatedAt: "2020-01-01T00:00:00.000Z",
    };

    const merged = mergeRemoteConfigSnapshot(base, remote, localStamp?.updatedAt ?? null);
    // Local is newer — remote should not clobber.
    expect(merged).toBeNull();
  });

  test("a newer remote snapshot is applied when local is stale or absent", () => {
    const base = createDefaultConfig("cloud://users/user-1");
    base.theme = "default";
    const remoteConfig = { ...createDefaultConfig("cloud://users/user-1"), theme: "amber" } as unknown as Record<string, unknown>;
    const remote = {
      config: remoteConfig,
      updatedAt: "2026-08-17T12:00:00.000Z",
    };

    // No local stamp at all.
    const merged = mergeRemoteConfigSnapshot(base, remote, null);
    expect(merged).not.toBeNull();
    expect(merged?.theme).toBe("amber");
  });

  test("returns null when remote has no config", () => {
    const base = createDefaultConfig("cloud://users/user-1");
    const merged = mergeRemoteConfigSnapshot(base, { config: null, updatedAt: null }, null);
    expect(merged).toBeNull();
  });
});
