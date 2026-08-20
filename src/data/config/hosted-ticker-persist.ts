import type { TickerRecord } from "../../types/ticker";
import { hydrateTickerMetadata } from "../../tickers/metadata";
import { tryLocalStorage } from "../../utils/browser-storage";
import { isRecord } from "../../utils/is-record";
import { readLastHostedUserId, resolveHostedPersistUserId } from "./hosted-user-persist";

const STORAGE_PREFIX = "gloomberb:hosted-tickers:";
const LEGACY_STORAGE_KEY = "gloomberb:hosted-tickers";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function parseTickerRecord(entry: unknown): TickerRecord | null {
  if (!isRecord(entry)) return null;
  const nested = isRecord(entry.metadata) ? entry.metadata : entry;
  const ticker = typeof nested.ticker === "string" && nested.ticker.trim()
    ? nested.ticker.trim()
    : typeof nested.symbol === "string" && nested.symbol.trim()
      ? nested.symbol.trim()
      : typeof entry.ticker === "string" && entry.ticker.trim()
        ? entry.ticker.trim()
        : "";
  if (!ticker) return null;
  return { metadata: hydrateTickerMetadata({ ...nested, ticker }) };
}

function parseTickerList(raw: string | null): TickerRecord[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.tickers)
        ? parsed.tickers
        : isRecord(parsed)
          ? Object.values(parsed)
          : [];
    const tickers: TickerRecord[] = [];
    for (const entry of entries) {
      const record = parseTickerRecord(entry);
      if (record) tickers.push(record);
    }
    return tickers;
  } catch {
    return [];
  }
}

function writeTickers(userId: string, tickers: TickerRecord[]): void {
  const backend = tryLocalStorage();
  if (!backend) return;
  try {
    backend.setItem(storageKey(userId), JSON.stringify(tickers));
  } catch {
    // Ignore quota or security errors.
  }
}

function maybeMigrateLegacyTickers(userId: string): TickerRecord[] {
  const backend = tryLocalStorage();
  if (!backend) return [];
  let raw: string | null = null;
  try {
    raw = backend.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  // The unscoped book belonged to whoever last used this browser. Never copy
  // it onto a different Gloom Cloud account.
  if (readLastHostedUserId() !== userId) return [];
  const migrated = parseTickerList(raw);
  if (migrated.length > 0) writeTickers(userId, migrated);
  try {
    backend.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore quota or security errors.
  }
  return migrated;
}

/** Reads the signed-in user's hosted ticker book. Empty when none exists. */
export function readHostedTickers(userId = resolveHostedPersistUserId()): TickerRecord[] {
  if (!userId) return [];
  const backend = tryLocalStorage();
  const stored = parseTickerList(backend?.getItem(storageKey(userId)) ?? null);
  if (stored.length > 0 || backend?.getItem(storageKey(userId))) return stored;
  return maybeMigrateLegacyTickers(userId);
}

/** Replaces the signed-in user's hosted ticker book. */
export function writeHostedTickers(tickers: TickerRecord[], userId = resolveHostedPersistUserId()): void {
  if (!userId) return;
  writeTickers(userId, tickers);
}

/**
 * Merges snapshot/local records into the signed-in user's book.
 * Unknown shapes still hydrate when a ticker symbol can be recovered.
 */
export function mergeHostedTickers(
  incoming: Iterable<TickerRecord>,
  userId = resolveHostedPersistUserId(),
): TickerRecord[] {
  if (!userId) return [...incoming];
  const merged = new Map<string, TickerRecord>();
  for (const ticker of readHostedTickers(userId)) {
    merged.set(ticker.metadata.ticker, ticker);
  }
  for (const ticker of incoming) {
    const symbol = ticker.metadata.ticker.trim();
    if (!symbol) continue;
    merged.set(symbol, ticker);
  }
  const next = [...merged.values()];
  writeTickers(userId, next);
  return next;
}

export function parseIncomingTickerRecord(entry: unknown): TickerRecord | null {
  return parseTickerRecord(entry);
}

export function parseIncomingTickerRecords(payload: unknown): TickerRecord[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      const record = parseTickerRecord(entry);
      return record ? [record] : [];
    });
  }
  if (!isRecord(payload)) return [];
  const raw = Array.isArray(payload.tickers)
    ? payload.tickers
    : isRecord(payload.tickers)
      ? Object.values(payload.tickers)
      : [];
  return parseIncomingTickerRecords(raw);
}

export function hostedTickerStorageKey(userId: string): string {
  return storageKey(userId);
}
