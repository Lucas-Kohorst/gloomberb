import { isRecord } from "../../utils/is-record";
import { tryLocalStorage } from "../../utils/browser-storage";
import { resolveHostedPersistUserId } from "./hosted-user-persist";

const STORAGE_PREFIX = "gloomberb:hosted-plugin-state:";
const LEGACY_STORAGE_KEY = "gloomberb:hosted-plugin-state";

let lastWritten: { userId: string; json: string } | null = null;

/** Backend init owns the Gloom Cloud session blob. Everything else in this plugin is local. */
export const HOSTED_BACKEND_MANAGED_PLUGIN_STATE_KEYS: ReadonlySet<string> = new Set([
  "gloomberb-cloud:session",
]);

export function hostedPluginStateStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

export function isHostedBackendManagedPluginStateKey(pluginId: string, key: string): boolean {
  return HOSTED_BACKEND_MANAGED_PLUGIN_STATE_KEYS.has(`${pluginId}:${key}`);
}

function parsePluginStateMap(raw: string | null): Record<string, Record<string, unknown>> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const snapshot: Record<string, Record<string, unknown>> = {};
    for (const [pluginId, values] of Object.entries(parsed)) {
      if (!isRecord(values)) continue;
      const entries: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        if (isHostedBackendManagedPluginStateKey(pluginId, key)) continue;
        entries[key] = value;
      }
      if (Object.keys(entries).length > 0) snapshot[pluginId] = entries;
    }
    return snapshot;
  } catch {
    return {};
  }
}

function sanitizePluginStateMap(
  state: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const snapshot: Record<string, Record<string, unknown>> = {};
  for (const [pluginId, values] of Object.entries(state)) {
    const entries: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (isHostedBackendManagedPluginStateKey(pluginId, key)) continue;
      entries[key] = value;
    }
    if (Object.keys(entries).length > 0) snapshot[pluginId] = entries;
  }
  return snapshot;
}

/** Reads per-user plugin state (chat read cursors, TWIT resume, Substack auth, …). */
export function readHostedPluginState(
  userId = resolveHostedPersistUserId(),
): Record<string, Record<string, unknown>> {
  if (!userId) return {};
  const backend = tryLocalStorage();
  if (!backend) return {};
  let raw: string | null = null;
  try {
    raw = backend.getItem(hostedPluginStateStorageKey(userId));
    if (!raw) {
      raw = backend.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        backend.setItem(hostedPluginStateStorageKey(userId), raw);
        backend.removeItem(LEGACY_STORAGE_KEY);
      }
    }
  } catch {
    return {};
  }
  return parsePluginStateMap(raw);
}

export function writeHostedPluginState(
  state: Record<string, Record<string, unknown>>,
  userId = resolveHostedPersistUserId(),
): void {
  if (!userId) return;
  const backend = tryLocalStorage();
  if (!backend) return;
  try {
    const snapshot = sanitizePluginStateMap(state);
    const json = Object.keys(snapshot).length === 0 ? "" : JSON.stringify(snapshot);
    if (lastWritten?.userId === userId && lastWritten.json === json) return;
    lastWritten = { userId, json };
    const key = hostedPluginStateStorageKey(userId);
    if (!json) backend.removeItem(key);
    else backend.setItem(key, json);
  } catch {
    // Ignore quota or security errors.
  }
}
