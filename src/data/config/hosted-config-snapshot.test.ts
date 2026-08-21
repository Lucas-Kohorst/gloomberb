import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID, type ByokStoredConfig } from "../../plugins/builtin/byok/types";
import {
  isPlaceholderHostedConfig,
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

  test("a customized Home layout is not a placeholder and beats a newer default snapshot", () => {
    setHostedConfigUserId("user-1");
    const local = createDefaultConfig("cloud://users/user-1");
    const home = local.layouts[0]!.layout;
    if (home.dockRoot?.kind === "split") home.dockRoot.ratio = 0.5;
    home.instances.push({
      instanceId: "twitter-feed:markets",
      paneId: "twitter-feed",
      params: { query: "list:2090433878028685747" },
      binding: { kind: "none" },
    });
    local.layouts[0] = { ...local.layouts[0]!, layout: home };
    local.layout = home;
    writeHostedUserConfig(local);

    const remote = {
      config: createDefaultConfig("cloud://users/user-1") as unknown as Record<string, unknown>,
      updatedAt: "2099-01-01T00:00:00.000Z",
    };
    const merged = mergeRemoteConfigSnapshot(
      local,
      remote,
      peekHostedUserConfigStamp()?.updatedAt ?? null,
    );
    expect(isPlaceholderHostedConfig(local)).toBe(false);
    expect(merged).toBeNull();
  });

  test("a newer local save beats a stale remote snapshot", () => {
    setHostedConfigUserId("user-1");
    const local = createDefaultConfig("cloud://users/user-1");
    local.layouts[0] = { ...local.layouts[0]!, name: "Trading" };
    writeHostedUserConfig(local);
    const localStamp = peekHostedUserConfigStamp();
    expect(localStamp).not.toBeNull();

    const base = createDefaultConfig("cloud://users/user-1");
    Object.assign(base, local);
    const remote = {
      config: { ...createDefaultConfig("cloud://users/user-1"), theme: "default" } as unknown as Record<string, unknown>,
      updatedAt: "2020-01-01T00:00:00.000Z",
    };

    const merged = mergeRemoteConfigSnapshot(base, remote, localStamp?.updatedAt ?? null);
    // Local is newer — remote should not clobber.
    expect(merged).toBeNull();
  });

  test("a timestamped boot placeholder does not beat a richer remote snapshot", () => {
    setHostedConfigUserId("user-1");
    const local = createDefaultConfig("cloud://users/user-1");
    writeHostedUserConfig(local);

    const remoteConfig = createDefaultConfig("cloud://users/user-1");
    remoteConfig.layouts[0] = { ...remoteConfig.layouts[0]!, name: "Trading" };
    const remote = {
      config: remoteConfig as unknown as Record<string, unknown>,
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    const merged = mergeRemoteConfigSnapshot(
      createDefaultConfig("cloud://users/user-1"),
      remote,
      peekHostedUserConfigStamp()?.updatedAt ?? null,
    );
    expect(merged?.layouts[0]?.name).toBe("Trading");
  });

  test("a newer remote snapshot is applied when local is stale or absent", () => {
    const base = createDefaultConfig("cloud://users/user-1");
    const remoteConfig = { ...createDefaultConfig("cloud://users/user-1"), theme: "green" } as unknown as Record<string, unknown>;
    const remote = {
      config: remoteConfig,
      updatedAt: "2026-08-17T12:00:00.000Z",
    };

    // No local stamp at all.
    const merged = mergeRemoteConfigSnapshot(base, remote, null);
    expect(merged).not.toBeNull();
    expect(merged?.theme).toBe("green");
  });

  test("returns null when remote has no config", () => {
    const base = createDefaultConfig("cloud://users/user-1");
    const merged = mergeRemoteConfigSnapshot(base, { config: null, updatedAt: null }, null);
    expect(merged).toBeNull();
  });

  test("theme, font, watchlists, and pluginConfig-only saves are not placeholders and beat a stale remote", () => {
    setHostedConfigUserId("user-1");
    const local = createDefaultConfig("cloud://users/user-1");
    local.theme = "green";
    local.fontSize = 16;
    local.language = "es";
    local.watchlists = [...local.watchlists, { id: "custom", name: "Custom" }];
    local.pluginConfig = {
      news: { feeds: [{ id: "f1", url: "https://example.com/rss", name: "Feed" }] },
      "gloomberb-cloud": {
        twitterFeeds: { feeds: [{ id: "tw", query: "from:Reuters" }], activeFeedId: "tw" },
        profileDraft: { username: "lucas", name: "Lucas" },
      },
      "chart-composer": { lastSpec: { series: ["AAPL"] } },
    };
    writeHostedUserConfig(local);

    expect(isPlaceholderHostedConfig(local)).toBe(false);
    const merged = mergeRemoteConfigSnapshot(
      local,
      {
        config: createDefaultConfig("cloud://users/user-1") as unknown as Record<string, unknown>,
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
      peekHostedUserConfigStamp()?.updatedAt ?? null,
    );
    expect(merged).toBeNull();
    expect(local.theme).toBe("green");
    expect(local.fontSize).toBe(16);
    expect(local.pluginConfig.news).toEqual(local.pluginConfig.news);
  });
});
