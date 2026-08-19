import type { TickerMetadata, TickerRecord } from "../../types/ticker";
import { hydrateTickerMetadata } from "../../tickers/metadata";
import { tryLocalStorage } from "../../utils/browser-storage";
import { isRecord } from "../../utils/is-record";
import { getHostedConfigUserId } from "./hosted-user-persist";

const STORAGE_PREFIX = "gloomberb:hosted-user-tickers:";
export const HOSTED_GUEST_USER_ID = "guest";

export interface HostedUserTickerStamp {
  userId: string;
  updatedAt: string;
}

interface HostedUserTickerRecord extends HostedUserTickerStamp {
  tickers: TickerMetadata[];
}

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function parseRecord(raw: string | null): HostedUserTickerRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const userId = typeof parsed.userId === "string" ? parsed.userId.trim() : "";
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
    if (!userId || !updatedAt || !Array.isArray(parsed.tickers)) return null;
    const tickers: TickerMetadata[] = [];
    for (const entry of parsed.tickers) {
      if (!isRecord(entry)) continue;
      const metadata = hydrateTickerMetadata(entry);
      if (metadata.ticker) tickers.push(metadata);
    }
    return { userId, updatedAt, tickers };
  } catch {
    return null;
  }
}

function recordsFromMetadata(tickers: TickerMetadata[]): TickerRecord[] {
  return tickers.map((metadata) => ({ metadata }));
}

/** Copies guest tickers onto a newly signed-in account that has none yet. */
export function adoptGuestHostedTickers(userId: string): void {
  const trimmed = userId.trim();
  if (!trimmed || trimmed === HOSTED_GUEST_USER_ID) return;
  if (readHostedUserTickers(trimmed).length > 0) return;
  const guest = readHostedUserTickers(HOSTED_GUEST_USER_ID);
  if (guest.length === 0) return;
  writeHostedUserTickers(guest, trimmed);
}

export function peekHostedUserTickerStamp(userId = getHostedConfigUserId()): HostedUserTickerStamp | null {
  if (!userId) return null;
  const record = parseRecord(tryLocalStorage()?.getItem(storageKey(userId)) ?? null);
  if (!record) return null;
  return { userId: record.userId, updatedAt: record.updatedAt };
}

/** Reads the signed-in user's hosted tickers from localStorage. */
export function readHostedUserTickers(userId = getHostedConfigUserId()): TickerRecord[] {
  if (!userId) return [];
  const record = parseRecord(tryLocalStorage()?.getItem(storageKey(userId)) ?? null);
  return record ? recordsFromMetadata(record.tickers) : [];
}

/** Writes the signed-in user's tickers to hosted localStorage. */
export function writeHostedUserTickers(
  tickers: readonly TickerRecord[],
  userId = getHostedConfigUserId(),
): void {
  if (!userId) return;
  const backend = tryLocalStorage();
  if (!backend) return;
  try {
    const record: HostedUserTickerRecord = {
      userId,
      updatedAt: new Date().toISOString(),
      tickers: tickers.map((ticker) => ticker.metadata),
    };
    backend.setItem(storageKey(userId), JSON.stringify(record));
  } catch {
    // Ignore quota or security errors.
  }
}

export function upsertHostedUserTicker(
  ticker: TickerRecord,
  userId = getHostedConfigUserId(),
): void {
  const symbol = ticker.metadata.ticker.trim().toUpperCase();
  if (!symbol) return;
  const next = readHostedUserTickers(userId).filter(
    (entry) => entry.metadata.ticker.trim().toUpperCase() !== symbol,
  );
  next.push({
    metadata: {
      ...ticker.metadata,
      ticker: symbol,
    },
  });
  writeHostedUserTickers(next, userId);
}

export function deleteHostedUserTicker(
  symbol: string,
  userId = getHostedConfigUserId(),
): void {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return;
  writeHostedUserTickers(
    readHostedUserTickers(userId).filter(
      (entry) => entry.metadata.ticker.trim().toUpperCase() !== normalized,
    ),
    userId,
  );
}

export function parseHostedTickerRecords(raw: unknown): TickerRecord[] {
  if (!Array.isArray(raw)) return [];
  const tickers: TickerRecord[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const metadata = hydrateTickerMetadata(entry);
    if (metadata.ticker) tickers.push({ metadata });
  }
  return tickers;
}

/**
 * Restores tickers from a hosted snapshot when it is newer than the local
 * stamp. Returns the records to apply, or null when local should be kept.
 */
export function mergeRemoteTickerSnapshot(
  remoteTickers: unknown[] | null | undefined,
  remoteUpdatedAt: string | null,
  localUpdatedAt: string | null,
): TickerRecord[] | null {
  if (!Array.isArray(remoteTickers) || !remoteUpdatedAt) return null;
  const remoteTime = Date.parse(remoteUpdatedAt);
  const localTime = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
  if (Number.isFinite(localTime) && Number.isFinite(remoteTime) && localTime > remoteTime) {
    return null;
  }
  return parseHostedTickerRecords(remoteTickers);
}

/** Writes remote snapshot tickers locally when they should win. */
export function hydrateHostedUserTickersFromSnapshot(
  remoteTickers: unknown[] | null | undefined,
  remoteUpdatedAt: string | null,
  userId = getHostedConfigUserId(),
): TickerRecord[] | null {
  const merged = mergeRemoteTickerSnapshot(
    remoteTickers,
    remoteUpdatedAt,
    peekHostedUserTickerStamp(userId)?.updatedAt ?? null,
  );
  if (!merged) return null;
  writeHostedUserTickers(merged, userId);
  return merged;
}
