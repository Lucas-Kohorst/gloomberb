import type { AppConfig } from "../../../types/config";
import { tryLocalStorage } from "../../../utils/browser-storage";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID, type ByokStoredConfig } from "./types";

export const HOSTED_BYOK_STORAGE_KEY = "gloomberb:hosted-byok-keys";

function isStoredConfig(value: unknown): value is ByokStoredConfig {
  return !!value
    && typeof value === "object"
    && Array.isArray((value as ByokStoredConfig).keys);
}

/** Reads BYOK keys persisted locally on the hosted client. */
export function readHostedByokKeys(): ByokStoredConfig | null {
  const storage = tryLocalStorage();
  if (!storage) return null;
  const raw = storage.getItem(HOSTED_BYOK_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes BYOK keys from an AppConfig to hosted localStorage. */
export function writeHostedByokKeys(config: AppConfig): void {
  const storage = tryLocalStorage();
  if (!storage) return;
  const stored = config.pluginConfig[BYOK_PLUGIN_ID]?.[BYOK_API_KEYS_CONFIG_KEY];
  try {
    if (!isStoredConfig(stored) || stored.keys.length === 0) {
      storage.removeItem(HOSTED_BYOK_STORAGE_KEY);
      return;
    }
    storage.setItem(HOSTED_BYOK_STORAGE_KEY, JSON.stringify(stored));
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
