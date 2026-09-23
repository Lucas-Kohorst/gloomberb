import type { AppConfig } from "../../../types/config";
import type { GloomPluginContext } from "../../../types/plugin";
import {
  BYOK_API_KEYS_CONFIG_KEY,
  BYOK_CUSTOM_SERVICE_ID,
  type ByokApiKeyEntry,
  type ByokStoredConfig,
} from "./types";
import { readProcessEnv } from "../../../utils/process-env";
import { getByokKnownService, getByokKnownServices, getByokKnownServicesVersion } from "./services";

const EMPTY_BYOK_KEYS: ByokApiKeyEntry[] = [];
const collapsedByokKeys = new WeakMap<ByokApiKeyEntry[], { version: number; keys: ByokApiKeyEntry[] }>();

/** Compare service ids and labels without case, spaces, or punctuation. */
export function normalizeByokServiceKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function knownServiceForLabel(label: string): ReturnType<typeof getByokKnownService> {
  const normalized = normalizeByokServiceKey(label);
  if (!normalized || normalized === "custom" || normalized === "customapi") return null;
  const matches = getByokKnownServices().filter((service) => (
    normalizeByokServiceKey(service.id) === normalized
    || normalizeByokServiceKey(service.name) === normalized
  ));
  return matches.find((service) => service.id === normalized)
    ?? matches.find((service) => normalizeByokServiceKey(service.id) === normalized)
    ?? matches[0]
    ?? null;
}

function hostsMatch(left: string | undefined, right: string | undefined): boolean {
  const a = left?.trim();
  const b = right?.trim();
  if (!a || !b) return false;
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/**
 * Catalog id for a stored key. "OpticOdds", "optic-odds", and a custom row
 * named OpticOdds all land on the registered `opticodds` service once it exists.
 */
export function canonicalByokServiceId(serviceId: string, name?: string, apiUrl?: string): string {
  const trimmed = serviceId.trim();
  if (trimmed && trimmed !== BYOK_CUSTOM_SERVICE_ID) {
    // Prefer the catalog id (`opticodds`) over an alias registration (`optic-odds`)
    // so a saved key and the empty slot collapse to one service.
    const fromId = knownServiceForLabel(trimmed);
    if (fromId) return fromId.id;
  }
  if (name) {
    const fromName = knownServiceForLabel(name);
    if (fromName) return fromName.id;
  }
  if (apiUrl) {
    const fromUrl = getByokKnownServices().find((service) => hostsMatch(service.apiUrl, apiUrl));
    if (fromUrl) return fromUrl.id;
  }
  if (!trimmed || trimmed === BYOK_CUSTOM_SERVICE_ID) return trimmed;
  return trimmed.toLowerCase();
}

function preferByokServiceKey(current: ByokApiKeyEntry, incoming: ByokApiKeyEntry): ByokApiKeyEntry {
  const currentHas = current.apiKey.trim().length > 0;
  const incomingHas = incoming.apiKey.trim().length > 0;
  if (currentHas !== incomingHas) return incomingHas ? incoming : current;
  if (incoming.createdAt !== current.createdAt) {
    return incoming.createdAt > current.createdAt ? incoming : current;
  }
  const incomingValidated = incoming.lastValidated ?? 0;
  const currentValidated = current.lastValidated ?? 0;
  if (incomingValidated !== currentValidated) {
    return incomingValidated > currentValidated ? incoming : current;
  }
  return incoming;
}

function stampServiceId(entry: ByokApiKeyEntry, serviceId: string): ByokApiKeyEntry {
  return entry.serviceId === serviceId ? entry : { ...entry, serviceId };
}

/**
 * One stored row per known service. A custom API stays separate unless its
 * name or URL is that service. Two OpticOdds saves collapse to the row that
 * still has the key, retargeted at the catalog id.
 */
export function collapseByokServiceKeys(keys: readonly ByokApiKeyEntry[]): ByokApiKeyEntry[] {
  const next: ByokApiKeyEntry[] = [];
  const indexByService = new Map<string, number>();
  let changed = false;
  for (const entry of keys) {
    if (!isApiKeyEntry(entry)) {
      changed = true;
      continue;
    }
    const serviceId = canonicalByokServiceId(entry.serviceId, entry.name, entry.apiUrl);
    if (serviceId === BYOK_CUSTOM_SERVICE_ID || !serviceId) {
      next.push(entry);
      continue;
    }
    const normalized = stampServiceId(entry, serviceId);
    if (normalized !== entry) changed = true;
    const existingIndex = indexByService.get(serviceId);
    if (existingIndex == null) {
      indexByService.set(serviceId, next.length);
      next.push(normalized);
      continue;
    }
    changed = true;
    next[existingIndex] = stampServiceId(
      preferByokServiceKey(next[existingIndex]!, normalized),
      serviceId,
    );
  }
  return changed ? next : keys as ByokApiKeyEntry[];
}

function collapseStoredByokKeys(keys: ByokApiKeyEntry[]): ByokApiKeyEntry[] {
  const version = getByokKnownServicesVersion();
  const cached = collapsedByokKeys.get(keys);
  if (cached?.version === version) return cached.keys;
  const collapsed = collapseByokServiceKeys(keys);
  collapsedByokKeys.set(keys, { version, keys: collapsed });
  return collapsed;
}

/** Reads BYOK key entries from a raw AppConfig.pluginConfig map. */
export function readByokKeysFromConfig(config: AppConfig): ByokApiKeyEntry[] {
  const stored = config.pluginConfig["application"]?.[BYOK_API_KEYS_CONFIG_KEY] as
    | Partial<ByokStoredConfig>
    | undefined;
  if (!stored?.keys || !Array.isArray(stored.keys)) return EMPTY_BYOK_KEYS;
  const keys = stored.keys.filter(isApiKeyEntry);
  if (keys.length === 0) return EMPTY_BYOK_KEYS;
  return collapseByokServiceKeys(keys);
}

/**
 * Selector for `useAppSelector`. The empty result is a stable instance — a
 * fresh `[]` each call makes useSyncExternalStore treat the store as changed
 * and hit React error #185 (maximum update depth).
 */
/** Raw stored rows, including duplicate service records not yet collapsed. */
export function selectRawByokKeys(state: { config: AppConfig }): ByokApiKeyEntry[] {
  const stored = state.config.pluginConfig["application"]?.[BYOK_API_KEYS_CONFIG_KEY] as
    | Partial<ByokStoredConfig>
    | undefined;
  if (!stored?.keys || !Array.isArray(stored.keys)) return EMPTY_BYOK_KEYS;
  return stored.keys;
}

export function selectByokKeys(state: { config: AppConfig }): ByokApiKeyEntry[] {
  const keys = selectRawByokKeys(state);
  if (keys === EMPTY_BYOK_KEYS) return keys;
  return collapseStoredByokKeys(keys);
}

/** Custom keys become command-bar entries after a successful test. */
export function isOpenableCustomKey(entry: ByokApiKeyEntry): boolean {
  return entry.serviceId === BYOK_CUSTOM_SERVICE_ID
    && Boolean(entry.apiUrl?.trim())
    && entry.lastValidationStatus === "ok";
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
  const wanted = canonicalByokServiceId(serviceId);
  const entry = keys.find((key) => key.serviceId === wanted && key.apiKey.trim())
    ?? keys.find((key) => key.apiKey.trim() && (
      canonicalByokServiceId(key.serviceId, key.name, key.apiUrl) === wanted
      || normalizeByokServiceKey(key.serviceId) === normalizeByokServiceKey(wanted)
      || normalizeByokServiceKey(key.name) === normalizeByokServiceKey(wanted)
    ));
  if (entry?.apiKey.trim()) return entry.apiKey;

  const service = getByokKnownService(wanted) ?? getByokKnownService(serviceId);
  if (service?.envVar) {
    const envValue = readProcessEnv(service.envVar);
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
    if (service.envVar && readProcessEnv(service.envVar)) {
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
