import type { AppConfig } from "../../../types/config";
import { tryLocalStorage } from "../../../utils/browser-storage";
import { getHostedConfigUserId, readLastHostedUserId } from "../../../data/config/hosted-user-persist";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID, type ByokStoredConfig } from "./types";

export const HOSTED_BYOK_STORAGE_KEY = "gloomberb:hosted-byok-keys";

function storageKey(userId: string): string {
  return `${HOSTED_BYOK_STORAGE_KEY}:${userId}`;
}

function isStoredConfig(value: unknown): value is ByokStoredConfig {
  return !!value
    && typeof value === "object"
    && Array.isArray((value as ByokStoredConfig).keys);
}

function parseStored(raw: string | null): ByokStoredConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Reads BYOK keys persisted locally on the hosted client. */
export function readHostedByokKeys(userId = getHostedConfigUserId()): ByokStoredConfig | null {
  const storage = tryLocalStorage();
  if (!storage || !userId) return null;
  const stored = parseStored(storage.getItem(storageKey(userId)));
  if (stored) return stored;
  if (readLastHostedUserId() !== userId) return null;
  const legacy = parseStored(storage.getItem(HOSTED_BYOK_STORAGE_KEY));
  if (!legacy) return null;
  try {
    storage.setItem(storageKey(userId), JSON.stringify(legacy));
    storage.removeItem(HOSTED_BYOK_STORAGE_KEY);
  } catch {
    // Ignore quota or security errors.
  }
  return legacy;
}

/** Writes BYOK keys from an AppConfig to hosted localStorage. */
export function writeHostedByokKeys(config: AppConfig, userId = getHostedConfigUserId()): void {
  const storage = tryLocalStorage();
  if (!storage || !userId) return;
  const stored = config.pluginConfig[BYOK_PLUGIN_ID]?.[BYOK_API_KEYS_CONFIG_KEY];
  try {
    if (!isStoredConfig(stored) || stored.keys.length === 0) {
      storage.removeItem(storageKey(userId));
      return;
    }
    storage.setItem(storageKey(userId), JSON.stringify(stored));
  } catch {
    // Ignore quota or security errors.
  }
}

/** Merges hosted-local BYOK keys into a boot config. Mutates and returns `config`. */
export function hydrateHostedByokConfig(config: AppConfig): AppConfig {
  const stored = readHostedByokKeys();
  if (!stored) return config;
  const pluginConfig = config.pluginConfig[BYOK_PLUGIN_ID] ?? {};
  config.pluginConfig = {
    ...config.pluginConfig,
    [BYOK_PLUGIN_ID]: {
      ...pluginConfig,
      [BYOK_API_KEYS_CONFIG_KEY]: stored,
    },
  };
  return config;
}
