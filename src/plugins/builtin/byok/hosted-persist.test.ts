import { afterEach, describe, expect, test } from "bun:test";
import { createDefaultConfig } from "../../../types/config";
import {
  hydrateHostedByokConfig,
  readHostedByokKeys,
  writeHostedByokKeys,
} from "./hosted-persist";
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

function installMemoryStorage(): void {
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
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
}

describe("hosted BYOK persist", () => {
  afterEach(() => {
    setHostedConfigUserId(null);
    rememberHostedUserId(null);
    globalThis.localStorage?.clear();
  });

  installMemoryStorage();

  test("writes and hydrates keys through localStorage", () => {
    setHostedConfigUserId("user-1");
    const config = createDefaultConfig("/tmp/byok");
    config.pluginConfig = {
      [BYOK_PLUGIN_ID]: { [BYOK_API_KEYS_CONFIG_KEY]: stored },
    };

    writeHostedByokKeys(config);
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
});
