import type { AppConfig } from "../../../types/config";
import { tryLocalStorage } from "../../../utils/browser-storage";
import {
  markHostedWorkspaceChanged,
  readLastHostedUserId,
  resolveHostedPersistUserId,
} from "../../../data/config/hosted-user-persist";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID, type ByokStoredConfig } from "./types";
import {
  flushByokWrites,
  getCachedByokConfig,
  initByokCryptoForUser,
  isEncryptedBlob,
  scheduleEncryptedWrite,
  setCachedByokConfig,
  clearByokCryptoCache,
} from "./crypto";

export const HOSTED_BYOK_STORAGE_KEY = "gloomberb:hosted-byok-keys";

function storageKey(userId: string): string {
  return `${HOSTED_BYOK_STORAGE_KEY}:${userId}`;
}

export function hostedByokStorageKey(userId: string): string {
  return storageKey(userId);
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

/**
 * Initializes the in-memory BYOK key cache for the current (or specified) user
 * by decrypting encrypted data from localStorage.  Must be called at boot,
 * before {@link hydrateHostedByokConfig}.  Handles plaintext-to-encrypted
 * migration transparently.
 */
export async function initHostedByokCrypto(
  userId = resolveHostedPersistUserId(),
): Promise<void> {
  const storage = tryLocalStorage();
  if (!storage || !userId) return;
  await initByokCryptoForUser(userId, storage, storageKey(userId));
}

/**
 * Reads BYOK keys from the in-memory cache (populated by
 * {@link initHostedByokCrypto}).  Falls back to plaintext localStorage for
 * pre-migration data when the cache is cold.
 */
export function readHostedByokKeys(
  userId = resolveHostedPersistUserId(),
  migrateLegacy = true,
): ByokStoredConfig | null {
  if (!userId) return null;

  // Fast path: cache is populated by initHostedByokCrypto at boot.
  const cached = getCachedByokConfig(userId);
  if (cached !== undefined) return cached;

  // Cache miss — try plaintext localStorage (pre-migration or non-crypto context).
  const storage = tryLocalStorage();
  if (!storage) return null;
  const raw = storage.getItem(storageKey(userId));
  if (raw && !isEncryptedBlob(raw)) {
    const stored = parseStored(raw);
    if (stored) {
      setCachedByokConfig(userId, stored);
      return stored;
    }
  }

  if (!migrateLegacy) return null;
  if (readLastHostedUserId() !== userId) return null;
  const legacy = parseStored(storage.getItem(HOSTED_BYOK_STORAGE_KEY));
  if (!legacy) return null;
  try {
    storage.removeItem(HOSTED_BYOK_STORAGE_KEY);
  } catch {
    // Ignore quota or security errors.
  }
  setCachedByokConfig(userId, legacy);
  return legacy;
}

/**
 * Writes BYOK keys from an AppConfig to hosted localStorage, encrypted at rest
 * with AES-GCM.  The in-memory cache is updated synchronously (source of truth
 * for the session); the encrypted write to localStorage is fired asynchronously
 * so the sync call sites do not block.
 */
export function writeHostedByokKeys(config: AppConfig, userId = resolveHostedPersistUserId()): void {
  const storage = tryLocalStorage();
  if (!storage || !userId) return;
  const stored = config.pluginConfig[BYOK_PLUGIN_ID]?.[BYOK_API_KEYS_CONFIG_KEY];
  try {
    if (!isStoredConfig(stored) || stored.keys.length === 0) {
      storage.removeItem(storageKey(userId));
      setCachedByokConfig(userId, null);
      markHostedWorkspaceChanged(userId);
      return;
    }
    // Update the in-memory cache synchronously.
    setCachedByokConfig(userId, stored);
    // Encrypt and persist asynchronously — only the latest write lands.
    scheduleEncryptedWrite(userId, stored, storage, storageKey(userId));
    markHostedWorkspaceChanged(userId);
  } catch {
    // Ignore quota or security errors.
  }
}

/**
 * Clears BYOK keys for a user from the in-memory cache and localStorage.
 * Called on sign-out to prevent key persistence beyond the session.
 */
export function clearHostedByokKeys(userId = resolveHostedPersistUserId()): void {
  if (!userId) return;
  const storage = tryLocalStorage();
  if (storage) {
    try {
      storage.removeItem(storageKey(userId));
    } catch {
      // Ignore quota or security errors.
    }
  }
  clearByokCryptoCache(userId);
}

export { flushByokWrites };

/** Merges hosted-local BYOK keys into a boot config. Mutates and returns `config`. */
export function hydrateHostedByokConfig(
  config: AppConfig,
  userId = resolveHostedPersistUserId(),
  migrateLegacy = true,
): AppConfig {
  const stored = readHostedByokKeys(userId, migrateLegacy);
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
