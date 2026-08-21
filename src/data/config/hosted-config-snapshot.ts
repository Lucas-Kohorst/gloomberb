import { createDefaultConfig, type AppConfig } from "../../types/config";
import { isRecord } from "../../utils/is-record";
import { normalizeConfigForSave, normalizeLoadedConfig } from "./store/normalize";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID } from "../../plugins/builtin/byok/types";
import { withConnectionRequest } from "../../plugins/builtin/connections/register";
import { attachHostedUserWorkspaceExtras } from "./hosted-user-persist";
import { readHostedTickers } from "./hosted-ticker-persist";
import { hasHostedNotes, readHostedNotes } from "./hosted-notes-persist";

const CONFIG_SNAPSHOT_ENDPOINT = "/api/config";
const SNAPSHOT_PUSH_DEBOUNCE_MS = 2000;
const SNAPSHOT_PUSH_MAX_BODY_BYTES = 512_000;

export interface HostedConfigSnapshotEnvelope {
  userId: string;
  updatedAt: string;
  config: Record<string, unknown>;
  tickers?: unknown;
  notes?: unknown;
}

export interface HostedConfigSnapshotResponse {
  config: Record<string, unknown> | null;
  updatedAt: string | null;
  tickers?: unknown;
  notes?: unknown;
}

/**
 * Removes raw BYOK API keys from a config object destined for a server-side
 * snapshot. Keys stay local via `writeHostedByokKeys` and must never appear in
 * a synced or server-persisted payload.
 */
export function stripByokKeysForSnapshot(config: AppConfig): AppConfig {
  const pluginConfig = config.pluginConfig[BYOK_PLUGIN_ID];
  if (!pluginConfig || !(BYOK_API_KEYS_CONFIG_KEY in pluginConfig)) return config;
  return {
    ...config,
    pluginConfig: {
      ...config.pluginConfig,
      [BYOK_PLUGIN_ID]: {
        ...pluginConfig,
        [BYOK_API_KEYS_CONFIG_KEY]: { keys: [] },
      },
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function pluginConfigForFingerprint(config: AppConfig): Record<string, Record<string, unknown>> {
  const stripped = stripByokKeysForSnapshot(config).pluginConfig;
  const next: Record<string, Record<string, unknown>> = {};
  for (const [pluginId, state] of Object.entries(stripped)) {
    if (pluginId === BYOK_PLUGIN_ID) {
      const rest = { ...state };
      delete rest[BYOK_API_KEYS_CONFIG_KEY];
      if (Object.keys(rest).length === 0) continue;
      next[pluginId] = rest;
      continue;
    }
    next[pluginId] = state;
  }
  return next;
}

function workspaceFingerprint(config: AppConfig): string {
  return JSON.stringify(canonicalize({
    activeLayoutIndex: config.activeLayoutIndex,
    layouts: config.layouts.map((layout) => ({
      name: layout.name,
      layout: layout.layout,
      paneState: layout.paneState ?? {},
    })),
    pluginConfig: pluginConfigForFingerprint(config),
    watchlists: config.watchlists.map((watchlist) => ({
      id: watchlist.id,
      name: watchlist.name,
      description: watchlist.description,
    })),
    theme: config.theme,
    fontSize: config.fontSize,
    language: config.language ?? "auto",
    recentTickers: config.recentTickers,
  }));
}

/** Fetches the signed-in user's latest config snapshot from the Worker. */
export async function fetchHostedConfigSnapshot(): Promise<HostedConfigSnapshotResponse> {
  return withConnectionRequest("hosted-config", "fetch-snapshot", async () => {
    const response = await fetch(CONFIG_SNAPSHOT_ENDPOINT, { credentials: "include" });
    if (response.status === 401) return { config: null, updatedAt: null };
    if (!response.ok) throw new Error(`Config snapshot fetch failed (${response.status}).`);
    const body = await response.json().catch(() => null) as HostedConfigSnapshotResponse | null;
    if (!body) return { config: null, updatedAt: null };
    return {
      config: isRecord(body.config) ? body.config : null,
      updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
      tickers: body.tickers,
      notes: body.notes,
    };
  });
}

function shouldPushHostedSnapshot(config: AppConfig): boolean {
  if (readHostedTickers().length > 0 || hasHostedNotes()) return true;
  return !isPlaceholderHostedConfig(config);
}

let sharedPusher: ReturnType<typeof createHostedConfigSnapshotPusher> | null = null;

export function getHostedConfigSnapshotPusher(): ReturnType<typeof createHostedConfigSnapshotPusher> {
  if (!sharedPusher) sharedPusher = createHostedConfigSnapshotPusher();
  return sharedPusher;
}

/** Pushes the signed-in user's config snapshot to the Worker (debounced). */
export function createHostedConfigSnapshotPusher(): {
  schedule: (config: AppConfig) => void;
  scheduleFromLast: () => void;
  flush: () => Promise<void>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingConfig: AppConfig | null = null;
  let lastConfig: AppConfig | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  async function push(config: AppConfig): Promise<void> {
    if (!shouldPushHostedSnapshot(config)) return;
    const stripped = stripByokKeysForSnapshot(config);
    const persisted = normalizeConfigForSave(stripped);
    const updatedAt = new Date().toISOString();
    const tickers = readHostedTickers();
    const notes = readHostedNotes(undefined, config.dataDir);
    attachHostedUserWorkspaceExtras({ tickers, notes });
    const body = JSON.stringify({
      config: persisted as unknown as Record<string, unknown>,
      updatedAt,
      tickers,
      notes,
    });
    if (new TextEncoder().encode(body).byteLength > SNAPSHOT_PUSH_MAX_BODY_BYTES) return;

    await withConnectionRequest("hosted-config", "push-snapshot", async () => {
      const response = await fetch(CONFIG_SNAPSHOT_ENDPOINT, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body,
      });
      if (!response.ok) throw new Error(`Config snapshot push failed (${response.status}).`);
    });
  }

  function drain(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!pendingConfig) return inFlight;
    const config = pendingConfig;
    pendingConfig = null;
    inFlight = inFlight.then(() => push(config).catch(() => {}));
    return inFlight;
  }

  function schedule(config: AppConfig): void {
    lastConfig = config;
    pendingConfig = config;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void drain(); }, SNAPSHOT_PUSH_DEBOUNCE_MS);
  }

  return {
    schedule,
    scheduleFromLast(): void {
      if (lastConfig) schedule(lastConfig);
    },
    flush(): Promise<void> {
      return drain();
    },
    cancel(): void {
      if (timer) { clearTimeout(timer); timer = null; }
      pendingConfig = null;
    },
  };
}

/**
 * True when hosted local config is still the boot default. A timestamped
 * placeholder must not beat a richer Worker / Gloom Cloud snapshot.
 *
 * Layout *names* matching Home/Monitor/Adjacent is not enough: rearranging
 * panes, CAT specs, theme, font, watchlists, or pluginConfig still count.
 */
export function isPlaceholderHostedConfig(config: AppConfig): boolean {
  const defaults = createDefaultConfig(config.dataDir);
  return workspaceFingerprint(config) === workspaceFingerprint(defaults);
}

function remoteSnapshotIsPlaceholder(remote: HostedConfigSnapshotResponse, dataDir: string): boolean {
  if (!remote.config) return true;
  const loaded = normalizeLoadedConfig(remote.config, dataDir).config;
  return isPlaceholderHostedConfig(loaded);
}

/** True when a real local save should win over a stale or poorer cloud snapshot. */
export function shouldKeepNewerHostedLocalConfig(
  config: AppConfig,
  localUpdatedAt: string | null | undefined,
  remoteCreatedAt: string | null | undefined,
  remote?: HostedConfigSnapshotResponse | null,
): boolean {
  const localReal = !isPlaceholderHostedConfig(config);
  if (localReal && remote && remoteSnapshotIsPlaceholder(remote, config.dataDir)) {
    return true;
  }
  const remoteTime = remoteCreatedAt ? Date.parse(remoteCreatedAt) : Number.NaN;
  const localTime = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
  if (!Number.isFinite(localTime) || !Number.isFinite(remoteTime) || localTime <= remoteTime) {
    return false;
  }
  return localReal;
}

/**
 * Restores a config from a remote snapshot. Returns the merged config if the
 * remote snapshot is newer than the local stamp, or null if the local copy
 * should be kept.
 */
export function mergeRemoteConfigSnapshot(
  baseConfig: AppConfig,
  remote: HostedConfigSnapshotResponse,
  localUpdatedAt: string | null,
): AppConfig | null {
  if (!remote.config || !remote.updatedAt) return null;
  if (shouldKeepNewerHostedLocalConfig(baseConfig, localUpdatedAt, remote.updatedAt, remote)) {
    return null;
  }
  const loaded = normalizeLoadedConfig(remote.config, baseConfig.dataDir).config;
  return Object.assign(baseConfig, loaded, { dataDir: baseConfig.dataDir });
}
