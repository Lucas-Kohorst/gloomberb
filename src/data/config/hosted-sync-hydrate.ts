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
import {
  captureHostedPersistenceIdentity,
  isHostedPersistenceIdentityCurrent,
  peekHostedUserConfigStamp,
  readHostedUserConfigRecord,
  writeHostedUserConfig,
  type HostedPersistenceIdentity,
} from "./hosted-user-persist";
import {
  mergeTickerRecords,
  parseIncomingTickerRecords,
  readHostedTickers,
  writeHostedTickers,
} from "./hosted-ticker-persist";
import {
  applyHostedNotesPayload,
  mergeHostedNotesPayload,
  readHostedNotes,
  writeHostedNotes,
} from "./hosted-notes-persist";
import {
  hydrateHostedByokConfig,
  writeHostedByokKeys,
} from "../../plugins/builtin/byok/hosted-persist";
import { isRecord } from "../../utils/is-record";
import type { NotesSyncPayload } from "../../plugins/builtin/notes/files";

export interface HostedSyncPull {
  snapshot: SyncSnapshot | null;
  updatedAt?: string | null;
}

export interface HostedWorkspaceHydration {
  config: AppConfig;
  tickers: TickerRecord[];
  notes: NotesSyncPayload;
  identity: HostedPersistenceIdentity;
  localUpdatedAt: string | null;
  localRevision: number | null;
}

function contributorPayload(snapshot: SyncSnapshot | null, id: string): unknown {
  return snapshot?.contributors[id]?.payload;
}

function isOlderThanLocal(remoteDate: string | null | undefined, localDate: string | null): boolean {
  return !!remoteDate && !!localDate && Date.parse(remoteDate) < Date.parse(localDate);
}

/** Restores tickers/notes stored beside the per-user config blob. */
export function restoreHostedLocalWorkspaceExtras(): void {
  const record = readHostedUserConfigRecord();
  if (!record) return;
  const fromRecord = parseIncomingTickerRecords(record.tickers);
  if (fromRecord.length > 0 && readHostedTickers(record.userId).length === 0) {
    writeHostedTickers(fromRecord, record.userId, false);
  }
  if (record.notes) applyHostedNotesPayload(record.notes, record.userId, false);
}

export function isHostedWorkspaceHydrationCurrent(
  hydration: Pick<HostedWorkspaceHydration, "identity" | "localRevision">,
): boolean {
  if (!isHostedPersistenceIdentityCurrent(hydration.identity)) return false;
  return (peekHostedUserConfigStamp(hydration.identity.userId)?.revision ?? null)
    === hydration.localRevision;
}

export function persistHostedWorkspaceHydration(
  hydration: HostedWorkspaceHydration,
): boolean {
  if (!isHostedWorkspaceHydrationCurrent(hydration)) return false;
  const userId = hydration.identity.userId;
  writeHostedUserConfig(hydration.config, userId);
  writeHostedTickers(hydration.tickers, userId);
  writeHostedNotes(hydration.notes, userId);
  writeHostedByokKeys(hydration.config, userId);
  return true;
}

function overlayCoreConfigFromSnapshot(
  config: AppConfig,
  snapshot: SyncSnapshot | null,
  localUpdatedAt: string | null,
): AppConfig {
  const payload = contributorPayload(snapshot, "core.config");
  if (!payload) return config;
  if (shouldKeepNewerHostedLocalConfig(config, localUpdatedAt, snapshot?.createdAt)) {
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
    /**
     * When false, skip `writeHostedUserConfig`. Use this for a post-paint overlay
     * so a stale pull cannot stamp localStorage before the caller decides to apply.
     */
    persist?: boolean;
  } = {},
): Promise<HostedWorkspaceHydration> {
  const userId = captureHostedPersistenceIdentity().userId;
  const record = readHostedUserConfigRecord(userId);
  let tickers = mergeTickerRecords(
    readHostedTickers(userId),
    parseIncomingTickerRecords(record?.tickers),
  );
  let notes = mergeHostedNotesPayload(
    readHostedNotes(userId, config.dataDir),
    record?.notes,
  );
  const identity = captureHostedPersistenceIdentity();
  const localStamp = peekHostedUserConfigStamp(userId);
  const localUpdatedAt = localStamp?.updatedAt ?? null;
  const workspaceUpdatedAt = record?.updatedAt ?? null;
  const localRevision = localStamp?.revision ?? null;
  const pullConfig = pull.pullConfig ?? fetchHostedConfigSnapshot;
  let remote: HostedConfigSnapshotResponse | null = null;
  try {
    remote = await pullConfig();
    const merged = mergeRemoteConfigSnapshot(
      config,
      remote,
      localUpdatedAt,
    );
    if (merged) Object.assign(config, merged, { dataDir: config.dataDir });
    if (remote.tickers && !isOlderThanLocal(remote.updatedAt, workspaceUpdatedAt)) {
      tickers = mergeTickerRecords(tickers, parseIncomingTickerRecords(remote.tickers));
    }
    if (remote.notes && !isOlderThanLocal(remote.updatedAt, workspaceUpdatedAt)) {
      notes = mergeHostedNotesPayload(notes, remote.notes);
    }
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

  const overlaid = overlayCoreConfigFromSnapshot(config, snapshot, localUpdatedAt);
  Object.assign(config, overlaid, { dataDir: config.dataDir });

  const collectionsPayload = contributorPayload(snapshot, "core.collections");
  const keepLocal = shouldKeepNewerHostedLocalConfig(
    config,
    localUpdatedAt,
    snapshot?.createdAt,
  );
  if (isRecord(collectionsPayload) && !keepLocal) {
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
  if (incoming.length > 0 && !isOlderThanLocal(snapshot?.createdAt, workspaceUpdatedAt)) {
    tickers = mergeTickerRecords(tickers, incoming);
  }
  hydrateHostedByokConfig(config, userId, false);
  const hydration = { config, tickers, notes, identity, localUpdatedAt, localRevision };
  if (pull.persist !== false) persistHostedWorkspaceHydration(hydration);
  return hydration;
}

/** Shallow copy so a background overlay cannot mutate live React state. */
export function cloneAppConfigForOverlay(config: AppConfig): AppConfig {
  return { ...config };
}
