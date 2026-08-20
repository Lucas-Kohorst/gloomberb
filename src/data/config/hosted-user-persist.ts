import type { AppConfig } from "../../types/config";
import { tryLocalStorage } from "../../utils/browser-storage";
import { isRecord } from "../../utils/is-record";
import { normalizeConfigForSave, normalizeLoadedConfig } from "./store/normalize";

const STORAGE_PREFIX = "gloomberb:hosted-user-config:";
const LAST_USER_KEY = "gloomberb:hosted-user-id";

export interface HostedUserConfigStamp {
  userId: string;
  updatedAt: string;
}

interface HostedUserConfigRecord extends HostedUserConfigStamp {
  config: Record<string, unknown>;
  tickers?: unknown;
  notes?: unknown;
}

let activeUserId: string | null = null;

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

/**
 * Hosted writes must not no-op just because apiClient briefly lost the user.
 * Prefer the signed-in id, then the last remembered account on this browser.
 */
export function resolveHostedPersistUserId(userId?: string | null): string | null {
  const explicit = userId?.trim() || "";
  if (explicit) return explicit;
  if (activeUserId) return activeUserId;
  return readLastHostedUserId();
}

function parseRecord(raw: string | null): HostedUserConfigRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const userId = typeof parsed.userId === "string" ? parsed.userId.trim() : "";
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
    if (!userId || !updatedAt || !isRecord(parsed.config)) return null;
    return {
      userId,
      updatedAt,
      config: parsed.config,
      ...(parsed.tickers !== undefined ? { tickers: parsed.tickers } : {}),
      ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    };
  } catch {
    return null;
  }
}

export function setHostedConfigUserId(userId: string | null): void {
  const trimmed = userId?.trim() || null;
  activeUserId = trimmed;
}

export function getHostedConfigUserId(): string | null {
  return activeUserId;
}

/**
 * Remembers who was last signed in so a boot that cannot reach Gloom Cloud can
 * still overlay that user's saved config instead of showing a blank default.
 * Cleared only on an explicit sign-out, never on a failed session check.
 */
export function rememberHostedUserId(userId: string | null): void {
  const backend = tryLocalStorage();
  if (!backend) return;
  try {
    if (userId) backend.setItem(LAST_USER_KEY, userId);
    else backend.removeItem(LAST_USER_KEY);
  } catch {
    // Ignore quota or security errors.
  }
}

export function readLastHostedUserId(): string | null {
  const backend = tryLocalStorage();
  if (!backend) return null;
  try {
    const remembered = backend.getItem(LAST_USER_KEY)?.trim();
    if (remembered) return remembered;
    // Nothing remembered yet, which is the case for anyone whose last sign-in
    // predates this bookkeeping. A single stored per-user config identifies the
    // owner unambiguously; more than one is genuinely ambiguous, so give up.
    const owners: string[] = [];
    for (let index = 0; index < backend.length; index += 1) {
      const key = backend.key(index);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const userId = key.slice(STORAGE_PREFIX.length).trim();
      if (userId) owners.push(userId);
      if (owners.length > 1) return null;
    }
    return owners[0] ?? null;
  } catch {
    return null;
  }
}

export function hostedUserConfigStorageKey(userId: string): string {
  return storageKey(userId);
}

export function peekHostedUserConfigStamp(userId = resolveHostedPersistUserId()): HostedUserConfigStamp | null {
  if (!userId) return null;
  const record = parseRecord(tryLocalStorage()?.getItem(storageKey(userId)) ?? null);
  if (!record) return null;
  return { userId: record.userId, updatedAt: record.updatedAt };
}

export function readHostedUserConfigRecord(userId = resolveHostedPersistUserId()): HostedUserConfigRecord | null {
  if (!userId) return null;
  return parseRecord(tryLocalStorage()?.getItem(storageKey(userId)) ?? null);
}

/** Writes the signed-in user's AppConfig to hosted localStorage. */
export function writeHostedUserConfig(config: AppConfig, userId = resolveHostedPersistUserId()): void {
  if (!userId) return;
  const backend = tryLocalStorage();
  if (!backend) return;
  try {
    const persisted = normalizeConfigForSave(config);
    const existing = parseRecord(backend.getItem(storageKey(userId)));
    const record: HostedUserConfigRecord = {
      userId,
      updatedAt: new Date().toISOString(),
      config: persisted as unknown as Record<string, unknown>,
      ...(existing?.tickers ? { tickers: existing.tickers } : {}),
      ...(existing?.notes ? { notes: existing.notes } : {}),
    };
    backend.setItem(storageKey(userId), JSON.stringify(record));
  } catch {
    // Ignore quota or security errors.
  }
}

/**
 * Stores tickers / notes beside the config blob so a later visit can restore
 * the workspace even if the dedicated ticker/notes keys are missing.
 */
export function attachHostedUserWorkspaceExtras(
  extras: { tickers?: unknown; notes?: unknown },
  userId = resolveHostedPersistUserId(),
): void {
  if (!userId) return;
  const backend = tryLocalStorage();
  if (!backend) return;
  const existing = parseRecord(backend.getItem(storageKey(userId)));
  if (!existing) return;
  try {
    const record: HostedUserConfigRecord = {
      ...existing,
      updatedAt: new Date().toISOString(),
      ...(extras.tickers !== undefined ? { tickers: extras.tickers } : {}),
      ...(extras.notes !== undefined ? { notes: extras.notes } : {}),
    };
    backend.setItem(storageKey(userId), JSON.stringify(record));
  } catch {
    // Ignore quota or security errors.
  }
}

/** Overlays the signed-in user's last hosted config onto the boot config. */
export function hydrateHostedUserConfig(config: AppConfig, userId = resolveHostedPersistUserId()): AppConfig {
  if (!userId) return config;
  const record = parseRecord(tryLocalStorage()?.getItem(storageKey(userId)) ?? null);
  if (!record) return config;
  const loaded = normalizeLoadedConfig(record.config, config.dataDir).config;
  Object.assign(config, loaded, { dataDir: config.dataDir });
  // Ensure core hosted plugins are never disabled by stale user config.
  config.disabledPlugins = config.disabledPlugins.filter((id) => id !== "gloomberb-cloud");
  return config;
}
