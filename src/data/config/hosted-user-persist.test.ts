import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../types/config";
import {
  getHostedConfigUserId,
  hydrateHostedUserConfig,
  peekHostedUserConfigStamp,
  readLastHostedUserId,
  rememberHostedUserId,
  setHostedConfigUserId,
  writeHostedUserConfig,
} from "./hosted-user-persist";

function installMemoryStorage(): void {
  const values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: store,
  });
}

describe("hosted user config persist", () => {
  installMemoryStorage();

  afterEach(() => {
    setHostedConfigUserId(null);
    globalThis.localStorage?.clear();
  });

  test("writes and hydrates layouts and plugin config for the signed-in user", () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("cloud://users/user-1");
    config.baseCurrency = "EUR";
    config.pluginConfig = {
      news: {
        feeds: [{ id: "user-adjacent", url: "https://example.com/rss", name: "Adjacent Press" }],
      },
    };
    config.layouts[0] = { ...config.layouts[0]!, name: "Trading" };

    writeHostedUserConfig(config);
    expect(getHostedConfigUserId()).toBe("user-1");
    expect(peekHostedUserConfigStamp()?.userId).toBe("user-1");

    const next = createDefaultConfig("cloud://users/user-1");
    hydrateHostedUserConfig(next);
    expect(next.baseCurrency).toBe("EUR");
    expect(next.layouts[0]?.name).toBe("Trading");
    expect(next.pluginConfig.news?.feeds).toEqual([
      { id: "user-adjacent", url: "https://example.com/rss", name: "Adjacent Press" },
    ]);
    expect(next.dataDir).toBe("cloud://users/user-1");
  });

  test("does not leak one user's config into another account", () => {
    setHostedConfigUserId("user-1");
    const first = createDefaultConfig("cloud://users/user-1");
    first.pluginConfig = { news: { owner: "user-1" } };
    writeHostedUserConfig(first);

    setHostedConfigUserId("user-2");
    const second = createDefaultConfig("cloud://users/user-2");
    hydrateHostedUserConfig(second);
    expect(second.pluginConfig.news).toBeUndefined();
    expect(peekHostedUserConfigStamp()).toBeNull();
  });

  // Guards the degraded boot path: when Gloom Cloud cannot confirm the session,
  // the app still needs to know whose saved config to restore.
  describe("remembered user id", () => {
    test("round-trips the remembered id and forgets it on sign-out", () => {
      rememberHostedUserId("user-1");
      expect(readLastHostedUserId()).toBe("user-1");
      rememberHostedUserId(null);
      expect(readLastHostedUserId()).toBeNull();
    });

    test("recovers the owner from a stored config written before the id was tracked", () => {
      setHostedConfigUserId("user-1");
      writeHostedUserConfig(createDefaultConfig("cloud://users/user-1"));
      expect(readLastHostedUserId()).toBe("user-1");
    });

    test("stays null when two accounts have stored configs", () => {
      setHostedConfigUserId("user-1");
      writeHostedUserConfig(createDefaultConfig("cloud://users/user-1"));
      setHostedConfigUserId("user-2");
      writeHostedUserConfig(createDefaultConfig("cloud://users/user-2"));
      expect(readLastHostedUserId()).toBeNull();
    });

    test("prefers the remembered id over inference", () => {
      setHostedConfigUserId("user-1");
      writeHostedUserConfig(createDefaultConfig("cloud://users/user-1"));
      rememberHostedUserId("user-2");
      expect(readLastHostedUserId()).toBe("user-2");
    });
  });
});
