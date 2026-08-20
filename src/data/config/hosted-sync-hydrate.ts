import type { AppConfig } from "../../types/config";
import type { TickerRecord } from "../../types/ticker";
import type { SyncSnapshot } from "../../sync/types";
import { overlayCoreConfigPayload } from "../../sync/core-contributors";
import {
  fetchHostedConfigSnapshot,
  mergeRemoteConfigSnapshot,
  shouldKeepNewerHostedLocalConfig,
  type HostedConfigSnapshotResponse,
} from "./hosted-config-snapshot";
import { peekHostedUserConfigStamp, writeHostedUserConfig } from "./hosted-user-persist";
import { mergeHostedTickers, parseIncomingTickerRecords, readHostedTickers } from "./hosted-ticker-persist";
import { hydrateHostedByokConfig } from "../../plugins/builtin/byok/hosted-persist";
import { isRecord } from "../../utils/is-record";

export interface HostedSyncPull {
  snapshot: SyncSnapshot | null;
  updatedAt?: string | null;
}

function contributorPayload(snapshot: SyncSnapshot | null, id: string): unknown {
  return snapshot?.contributors[id]?.payload;
}

function overlayCoreConfigFromSnapshot(
  config: AppConfig,
  snapshot: SyncSnapshot | null,
): AppConfig {
  const payload = contributorPayload(snapshot, "core.config");
  if (!payload) return config;
  const localStamp = peekHostedUserConfigStamp();
  if (shouldKeepNewerHostedLocalConfig(config, localStamp?.updatedAt, snapshot?.createdAt)) {
    return config;
  }
  return overlayCoreConfigPayload(config, payload, config) ?? config;
}

/**
 * Overlays Worker `/api/config` and Gloom Cloud `/sync/snapshot` onto the
 * hosted boot config and ticker book. Call after `hydrateHostedUserConfig`.
 */
export async function hydrateHostedWorkspaceFromCloud(
  config: AppConfig,
  pull: {
    pullConfig?: () => Promise<HostedConfigSnapshotResponse>;
    pullSync?: () => Promise<HostedSyncPull>;
  } = {},
): Promise<{ config: AppConfig; tickers: TickerRecord[] }> {
  const pullConfig = pull.pullConfig ?? fetchHostedConfigSnapshot;
  try {
    const remote = await pullConfig();
    const merged = mergeRemoteConfigSnapshot(
      config,
      remote,
      peekHostedUserConfigStamp()?.updatedAt ?? null,
    );
    if (merged) Object.assign(config, merged, { dataDir: config.dataDir });
  } catch {
    // Network or parse failure — continue with local hydration.
  }

  let snapshot: SyncSnapshot | null = null;
  if (pull.pullSync) {
    try {
      snapshot = (await pull.pullSync()).snapshot;
    } catch {
      snapshot = null;
    }
  }

  const overlaid = overlayCoreConfigFromSnapshot(config, snapshot);
  Object.assign(config, overlaid, { dataDir: config.dataDir });

  const collectionsPayload = contributorPayload(snapshot, "core.collections");
  if (isRecord(collectionsPayload)) {
    const collectionPatch: Record<string, unknown> = {};
    if (Array.isArray(collectionsPayload.portfolios)) {
      collectionPatch.portfolios = collectionsPayload.portfolios;
    }
    if (Array.isArray(collectionsPayload.watchlists)) {
      collectionPatch.watchlists = collectionsPayload.watchlists;
    }
    if (Object.keys(collectionPatch).length > 0) {
      const overlay = overlayCoreConfigPayload(config, collectionPatch, config);
      if (overlay) Object.assign(config, overlay, { dataDir: config.dataDir });
    }
  }
  const incoming = parseIncomingTickerRecords(collectionsPayload);
  const tickers = incoming.length > 0 ? mergeHostedTickers(incoming) : readHostedTickers();
  writeHostedUserConfig(config);
  hydrateHostedByokConfig(config);
  return { config, tickers };
}
