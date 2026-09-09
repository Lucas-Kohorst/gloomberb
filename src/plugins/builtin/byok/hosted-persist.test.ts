import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import {
  clearHostedByokKeys,
  flushByokWrites,
  hydrateHostedByokConfig,
  initHostedByokCrypto,
  readHostedByokKeys,
  writeHostedByokKeys,
} from "./hosted-persist";
import { resetByokCryptoCache, isEncryptedBlob } from "./crypto";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID, type ByokStoredConfig } from "./types";
import { rememberHostedUserId, setHostedConfigUserId } from "../../../data/config/hosted-user-persist";

const stored: ByokStoredConfig = {
  keys: [{
    id: "byok-1",
    serviceId: "adjacent",
    name: "Adjacent",
    apiKey: "sk-hosted",
    createdAt: 1,
    lastValidationStatus: "untested",
  }],
};

function installMemoryStorage(target: "localStorage" | "sessionStorage"): void {
  const values = new Map<string, string>();
  const storage = {
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
  Object.defineProperty(globalThis, target, {
    configurable: true,
    value: storage,
  });
}

describe("hosted BYOK persist", () => {
  afterEach(() => {
    setHostedConfigUserId(null);
    rememberHostedUserId(null);
    resetByokCryptoCache();
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
  });

  installMemoryStorage("localStorage");
  installMemoryStorage("sessionStorage");

  test("writes encrypted data and hydrates keys through the cache", async () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("/tmp/byok");
    config.pluginConfig = {
      [BYOK_PLUGIN_ID]: { [BYOK_API_KEYS_CONFIG_KEY]: stored },
    };

    writeHostedByokKeys(config);
    // Cache is updated synchronously.
    expect(readHostedByokKeys()).toEqual(stored);

    // Wait for the async encrypted write to land in localStorage.
    await flushByokWrites();
    const raw = globalThis.localStorage.getItem("gloomberb:hosted-byok-keys:user-1");
    expect(raw).not.toBeNull();
    expect(isEncryptedBlob(raw!)).toBe(true);
    // The raw blob must not contain the plaintext key.
    expect(raw!).not.toContain("sk-hosted");

    // Simulate a fresh session: clear cache, re-init from encrypted storage.
    resetByokCryptoCache();
    await initHostedByokCrypto("user-1");
    expect(readHostedByokKeys()).toEqual(stored);

    const next = createDefaultConfig("/tmp/byok");
    hydrateHostedByokConfig(next);
    expect(next.pluginConfig[BYOK_PLUGIN_ID]?.[BYOK_API_KEYS_CONFIG_KEY]).toEqual(stored);
  });

  test("clears storage when no keys remain", () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("/tmp/byok");
    config.pluginConfig = {
      [BYOK_PLUGIN_ID]: { [BYOK_API_KEYS_CONFIG_KEY]: stored },
    };
    writeHostedByokKeys(config);

    const empty = createDefaultConfig("/tmp/byok");
    writeHostedByokKeys(empty);
    expect(readHostedByokKeys()).toBeNull();
  });

  test("does not copy keys onto a different Gloom Cloud account", () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("/tmp/byok");
    config.pluginConfig = {
      [BYOK_PLUGIN_ID]: { [BYOK_API_KEYS_CONFIG_KEY]: stored },
    };
    writeHostedByokKeys(config);

    setHostedConfigUserId("user-2");
    expect(readHostedByokKeys()).toBeNull();
  });

  test("clearHostedByokKeys removes cached and persisted data", async () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("/tmp/byok");
    config.pluginConfig = {
      [BYOK_PLUGIN_ID]: { [BYOK_API_KEYS_CONFIG_KEY]: stored },
    };
    writeHostedByokKeys(config);
    await flushByokWrites();

    clearHostedByokKeys("user-1");
    expect(readHostedByokKeys("user-1")).toBeNull();
    expect(globalThis.localStorage.getItem("gloomberb:hosted-byok-keys:user-1")).toBeNull();
  });
});
