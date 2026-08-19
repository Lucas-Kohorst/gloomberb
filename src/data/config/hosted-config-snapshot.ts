import type { AppConfig } from "../../types/config";
import { isRecord } from "../../utils/is-record";
import { normalizeConfigForSave, normalizeLoadedConfig } from "./store/normalize";
import { BYOK_API_KEYS_CONFIG_KEY, BYOK_PLUGIN_ID } from "../../plugins/builtin/byok/types";
import { withConnectionRequest } from "../../plugins/builtin/connections/register";
import { peekHostedUserTickerStamp, readHostedUserTickers } from "./hosted-user-tickers";

const CONFIG_SNAPSHOT_ENDPOINT = "/api/config";
const SNAPSHOT_PUSH_DEBOUNCE_MS = 2000;
const SNAPSHOT_PUSH_MAX_BODY_BYTES = 512_000;

export interface HostedConfigSnapshotEnvelope {
  userId: string;
  updatedAt: string;
  config: Record<string, unknown>;
  tickers?: unknown[];
}

export interface HostedConfigSnapshotResponse {
  config: Record<string, unknown> | null;
  updatedAt: string | null;
  tickers?: unknown[] | null;
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
    if (response.status === 401) return { config: null, updatedAt: null, tickers: null };
    if (!response.ok) throw new Error(`Config snapshot fetch failed (${response.status}).`);
    const body = await response.json().catch(() => null) as HostedConfigSnapshotResponse | null;
    if (!body) return { config: null, updatedAt: null, tickers: null };
    return {
      config: isRecord(body.config) ? body.config : null,
      updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : null,
      tickers: Array.isArray(body.tickers) ? body.tickers : null,
    };
  });
}

type HostedConfigSnapshotPusher = {
  remember: (config: AppConfig) => void;
  schedule: (config: AppConfig) => void;
  scheduleTickers: () => void;
  flush: () => Promise<void>;
  cancel: () => void;
};

let hostedSnapshotPusher: HostedConfigSnapshotPusher | null = null;

/** Pushes the signed-in user's config snapshot to the Worker (debounced). */
export function createHostedConfigSnapshotPusher(): HostedConfigSnapshotPusher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingConfig: AppConfig | null = null;
  let lastConfig: AppConfig | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  async function push(config: AppConfig): Promise<void> {
    const stripped = stripByokKeysForSnapshot(config);
    const persisted = normalizeConfigForSave(stripped);
    const updatedAt = new Date().toISOString();
    const payload: Record<string, unknown> = {
      config: persisted as unknown as Record<string, unknown>,
      updatedAt,
    };
    // Only attach tickers once this browser has a local persist stamp, so a
    // config-only save cannot wipe another device's collections.
    if (peekHostedUserTickerStamp()) {
      payload.tickers = readHostedUserTickers().map((ticker) => ticker.metadata);
    }
    const body = JSON.stringify(payload);
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

  function queue(config: AppConfig): void {
    lastConfig = config;
    pendingConfig = config;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void drain(); }, SNAPSHOT_PUSH_DEBOUNCE_MS);
  }

  return {
    remember(config: AppConfig): void {
      lastConfig = config;
    },
    schedule(config: AppConfig): void {
      queue(config);
    },
    scheduleTickers(): void {
      if (lastConfig) queue(lastConfig);
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

function hostedSnapshotPusherSingleton(): HostedConfigSnapshotPusher {
  if (!hostedSnapshotPusher) hostedSnapshotPusher = createHostedConfigSnapshotPusher();
  return hostedSnapshotPusher;
}

export function rememberHostedSnapshotConfig(config: AppConfig): void {
  hostedSnapshotPusherSingleton().remember(config);
}

export function scheduleHostedConfigSnapshot(config: AppConfig): void {
  hostedSnapshotPusherSingleton().schedule(config);
}

export function scheduleHostedTickerSnapshot(): void {
  hostedSnapshotPusherSingleton().scheduleTickers();
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
  const remoteTime = Date.parse(remote.updatedAt);
  const localTime = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
  // If local is newer, keep it — a stale remote must never clobber it.
  if (Number.isFinite(localTime) && Number.isFinite(remoteTime) && localTime > remoteTime) {
    return null;
  }
  const loaded = normalizeLoadedConfig(remote.config, baseConfig.dataDir).config;
  return Object.assign(baseConfig, loaded, { dataDir: baseConfig.dataDir });
}
