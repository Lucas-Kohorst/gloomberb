import { createDefaultConfig, type AppConfig } from "../../types/config";
import { isRecord } from "../../utils/is-record";
import { normalizeConfigForSave, normalizeLoadedConfig } from "./store/normalize";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID } from "../../plugins/builtin/byok/types";
import { withConnectionRequest } from "../../plugins/builtin/connections/register";

const CONFIG_SNAPSHOT_ENDPOINT = "/api/config";
const SNAPSHOT_PUSH_DEBOUNCE_MS = 2000;
const SNAPSHOT_PUSH_MAX_BODY_BYTES = 512_000;

export interface HostedConfigSnapshotEnvelope {
  userId: string;
  updatedAt: string;
  config: Record<string, unknown>;
}

export interface HostedConfigSnapshotResponse {
  config: Record<string, unknown> | null;
  updatedAt: string | null;
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
    };
  });
}

/** Pushes the signed-in user's config snapshot to the Worker (debounced). */
export function createHostedConfigSnapshotPusher(): {
  schedule: (config: AppConfig) => void;
  flush: () => Promise<void>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingConfig: AppConfig | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  async function push(config: AppConfig): Promise<void> {
    const stripped = stripByokKeysForSnapshot(config);
    const persisted = normalizeConfigForSave(stripped);
    const updatedAt = new Date().toISOString();
    const body = JSON.stringify({
      config: persisted as unknown as Record<string, unknown>,
      updatedAt,
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

  return {
    schedule(config: AppConfig): void {
      pendingConfig = config;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void drain(); }, SNAPSHOT_PUSH_DEBOUNCE_MS);
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
 */
export function isPlaceholderHostedConfig(config: AppConfig): boolean {
  const defaults = createDefaultConfig(config.dataDir);
  return config.layouts.length === defaults.layouts.length
    && config.activeLayoutIndex === defaults.activeLayoutIndex
    && config.layouts.every((layout, index) => layout.name === defaults.layouts[index]?.name)
    && Object.keys(config.pluginConfig).length === 0
    && config.recentTickers.length === 0;
}

/** True when a newer real local save should win over a stale cloud snapshot. */
export function shouldKeepNewerHostedLocalConfig(
  config: AppConfig,
  localUpdatedAt: string | null | undefined,
  remoteCreatedAt: string | null | undefined,
): boolean {
  const remoteTime = remoteCreatedAt ? Date.parse(remoteCreatedAt) : Number.NaN;
  const localTime = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
  if (!Number.isFinite(localTime) || !Number.isFinite(remoteTime) || localTime <= remoteTime) {
    return false;
  }
  return !isPlaceholderHostedConfig(config);
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
  if (shouldKeepNewerHostedLocalConfig(baseConfig, localUpdatedAt, remote.updatedAt)) {
    return null;
  }
  const loaded = normalizeLoadedConfig(remote.config, baseConfig.dataDir).config;
  return Object.assign(baseConfig, loaded, { dataDir: baseConfig.dataDir });
}
