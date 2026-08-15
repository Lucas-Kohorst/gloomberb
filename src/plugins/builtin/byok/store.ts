import type { AppConfig } from "../../../types/config";
import type { GloomPluginContext } from "../../../types/plugin";
import {
  BYOK_API_KEYS_CONFIG_KEY,
  type ByokApiKeyEntry,
  type ByokStoredConfig,
} from "./types";
import { getByokKnownService, getByokKnownServices } from "./services";

/** Reads BYOK key entries from a raw AppConfig.pluginConfig map. */
export function readByokKeysFromConfig(config: AppConfig): ByokApiKeyEntry[] {
  const stored = config.pluginConfig["application"]?.[BYOK_API_KEYS_CONFIG_KEY] as
    | Partial<ByokStoredConfig>
    | undefined;
  if (!stored?.keys || !Array.isArray(stored.keys)) return [];
  return stored.keys.filter(isApiKeyEntry);
}

function isApiKeyEntry(value: unknown): value is ByokApiKeyEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string"
    && typeof entry.serviceId === "string"
    && typeof entry.name === "string"
    && typeof entry.apiKey === "string"
    && typeof entry.createdAt === "number"
  );
}

/** Reads all BYOK key entries via a plugin context's configState. */
export function getByokKeys(ctx: GloomPluginContext): ByokApiKeyEntry[] {
  const stored = ctx.configState.get<ByokStoredConfig>(BYOK_API_KEYS_CONFIG_KEY);
  if (!stored?.keys || !Array.isArray(stored.keys)) return [];
  return stored.keys.filter(isApiKeyEntry);
}

/** Writes all BYOK key entries via a plugin context's configState. */
export async function setByokKeys(ctx: GloomPluginContext, keys: ByokApiKeyEntry[]): Promise<void> {
  await ctx.configState.set(BYOK_API_KEYS_CONFIG_KEY, { keys });
}

/** Adds a new key entry, generating an id and timestamp. */
export async function addByokKey(
  ctx: GloomPluginContext,
  entry: Omit<ByokApiKeyEntry, "id" | "createdAt" | "lastValidated" | "lastValidationStatus">,
): Promise<ByokApiKeyEntry> {
  const keys = getByokKeys(ctx);
  const newEntry: ByokApiKeyEntry = {
    ...entry,
    id: generateByokKeyId(),
    createdAt: Date.now(),
    lastValidationStatus: "untested",
  };
  await setByokKeys(ctx, [...keys, newEntry]);
  return newEntry;
}

/** Updates an existing key entry by id. */
export async function updateByokKey(
  ctx: GloomPluginContext,
  id: string,
  patch: Partial<Omit<ByokApiKeyEntry, "id" | "createdAt">>,
): Promise<void> {
  const keys = getByokKeys(ctx);
  const index = keys.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const updated: ByokApiKeyEntry = { ...keys[index]!, ...patch };
  keys[index] = updated;
  await setByokKeys(ctx, keys);
}

/** Deletes a key entry by id. */
export async function deleteByokKey(ctx: GloomPluginContext, id: string): Promise<void> {
  const keys = getByokKeys(ctx).filter((entry) => entry.id !== id);
  await setByokKeys(ctx, keys);
}

/**
 * Resolves the API key for a service, checking stored BYOK entries first and
 * falling back to the service's configured environment variable.
 *
 * This function is used by the plugin registry to implement
 * {@link GloomPluginContext.getApiKey} for all plugins.
 */
export function resolveApiKey(config: AppConfig, serviceId: string): string | undefined {
  const keys = readByokKeysFromConfig(config);
  const entry = keys.find((k) => k.serviceId === serviceId);
  if (entry?.apiKey) return entry.apiKey;

  const service = getByokKnownService(serviceId);
  if (service?.envVar) {
    const envValue = process.env[service.envVar];
    if (envValue) return envValue;
  }
  return undefined;
}

/**
 * Returns which known services have keys available (either stored or via env var),
 * without revealing the key values. Used by the hosted worker endpoint.
 */
export function getAvailableByokServices(config: AppConfig): Array<{ serviceId: string; source: "stored" | "env" }> {
  const keys = readByokKeysFromConfig(config);
  const storedServiceIds = new Set(keys.map((k) => k.serviceId));
  const result: Array<{ serviceId: string; source: "stored" | "env" }> = [];

  for (const serviceId of storedServiceIds) {
    result.push({ serviceId, source: "stored" });
  }

  const allServices = getByokKnownServices();
  for (const service of allServices) {
    if (storedServiceIds.has(service.id)) continue;
    if (service.envVar && process.env[service.envVar]) {
      result.push({ serviceId: service.id, source: "env" });
    }
  }

  return result;
}

function generateByokKeyId(): string {
  return `byok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Masks an API key for display, showing only the first and last few characters. */
export function maskApiKey(key: string): string {
  if (key.length <= 6) return "•".repeat(key.length);
  if (key.length <= 12) return `${key.slice(0, 2)}${"•".repeat(4)}${key.slice(-2)}`;
  return `${key.slice(0, 4)}${"•".repeat(key.length - 8)}${key.slice(-4)}`;
}
