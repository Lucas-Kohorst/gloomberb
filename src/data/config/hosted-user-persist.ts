import type { AppConfig } from "../../types/config";
import { normalizeConfigForSave, normalizeLoadedConfig } from "./store/normalize";

const STORAGE_PREFIX = "gloomberb:hosted-user-config:";

export interface HostedUserConfigStamp {
  userId: string;
  updatedAt: string;
}

interface HostedUserConfigRecord extends HostedUserConfigStamp {
  config: Record<string, unknown>;
}

let activeUserId: string | null = null;

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseRecord(raw: string | null): HostedUserConfigRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const userId = typeof parsed.userId === "string" ? parsed.userId.trim() : "";
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
    if (!userId || !updatedAt || !isRecord(parsed.config)) return null;
    return { userId, updatedAt, config: parsed.config };
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

export function hostedUserConfigStorageKey(userId: string): string {
  return storageKey(userId);
}

export function peekHostedUserConfigStamp(userId = activeUserId): HostedUserConfigStamp | null {
  if (!userId) return null;
  const record = parseRecord(storage()?.getItem(storageKey(userId)) ?? null);
  if (!record) return null;
  return { userId: record.userId, updatedAt: record.updatedAt };
}

/** Writes the signed-in user's AppConfig to hosted localStorage. */
export function writeHostedUserConfig(config: AppConfig, userId = activeUserId): void {
  if (!userId) return;
  const backend = storage();
  if (!backend) return;
  try {
    const persisted = normalizeConfigForSave(config);
    const record: HostedUserConfigRecord = {
      userId,
      updatedAt: new Date().toISOString(),
      config: persisted as unknown as Record<string, unknown>,
    };
    backend.setItem(storageKey(userId), JSON.stringify(record));
  } catch {
    // Ignore quota or security errors.
  }
}

/** Overlays the signed-in user's last hosted config onto the boot config. */
export function hydrateHostedUserConfig(config: AppConfig, userId = activeUserId): AppConfig {
  if (!userId) return config;
  const record = parseRecord(storage()?.getItem(storageKey(userId)) ?? null);
  if (!record) return config;
  const loaded = normalizeLoadedConfig(record.config, config.dataDir).config;
  Object.assign(config, loaded, { dataDir: config.dataDir });
  return config;
}
