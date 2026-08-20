import { tryLocalStorage } from "../../utils/browser-storage";
import { isRecord } from "../../utils/is-record";
import type { NotesSyncPayload, QuickNoteEntry } from "../../plugins/builtin/notes/files";
import { resolveHostedPersistUserId } from "./hosted-user-persist";

const STORAGE_PREFIX = "gloomberb:hosted-notes:";
const LEGACY_NOTES_PREFIX = "gloomberb:notes:";

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function emptyPayload(): NotesSyncPayload {
  return { quickNotesIndex: [], quickNotes: {}, tickerNotes: {} };
}

function parsePayload(raw: string | null): NotesSyncPayload | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const quickNotesIndex = Array.isArray(parsed.quickNotesIndex)
      ? parsed.quickNotesIndex.filter((entry): entry is QuickNoteEntry => (
        isRecord(entry) && typeof entry.id === "string"
      ))
      : [];
    const quickNotes = isRecord(parsed.quickNotes)
      ? Object.fromEntries(
        Object.entries(parsed.quickNotes).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
      : {};
    const tickerNotes = isRecord(parsed.tickerNotes)
      ? Object.fromEntries(
        Object.entries(parsed.tickerNotes).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
      : {};
    return { quickNotesIndex, quickNotes, tickerNotes };
  } catch {
    return null;
  }
}

function userIdFromCloudDataDir(dataDir: string): string | null {
  const match = /^cloud:\/+users\/([^/]+)/.exec(dataDir.trim());
  return match?.[1]?.trim() || null;
}

/**
 * Older hosted notes used `gloomberb:notes:${dataDir}/${symbol}.md`. `joinPath`
 * collapsed `cloud://` to `cloud:/`, so we accept both when migrating.
 */
function migrateLegacyNotes(userId: string, dataDir: string): NotesSyncPayload {
  const backend = tryLocalStorage();
  if (!backend) return emptyPayload();
  const payload = emptyPayload();
  const prefixes = [
    `${LEGACY_NOTES_PREFIX}cloud://users/${userId}/`,
    `${LEGACY_NOTES_PREFIX}cloud:/users/${userId}/`,
    `${LEGACY_NOTES_PREFIX}${dataDir}/`,
  ];
  try {
    for (let index = 0; index < backend.length; index += 1) {
      const key = backend.key(index);
      if (!key?.startsWith(LEGACY_NOTES_PREFIX)) continue;
      const prefix = prefixes.find((entry) => key.startsWith(entry));
      if (!prefix) continue;
      const rest = key.slice(prefix.length);
      const value = backend.getItem(key);
      if (typeof value !== "string" || !value) continue;
      if (rest === "__quick-notes-index__.json") {
        try {
          const parsed: unknown = JSON.parse(value);
          if (Array.isArray(parsed)) payload.quickNotesIndex = parsed as QuickNoteEntry[];
        } catch {
          // Ignore malformed index.
        }
        continue;
      }
      if (!rest.endsWith(".md")) continue;
      const symbol = rest.slice(0, -3);
      if (symbol.startsWith("__note-") && symbol.endsWith("__")) {
        payload.quickNotes[symbol.slice("__note-".length, -2)] = value;
      } else if (!symbol.startsWith("__")) {
        payload.tickerNotes[symbol] = value;
      }
    }
  } catch {
    return payload;
  }
  return payload;
}

export function readHostedNotes(
  userId = resolveHostedPersistUserId(),
  dataDir?: string,
): NotesSyncPayload {
  if (!userId) return emptyPayload();
  const stored = parsePayload(tryLocalStorage()?.getItem(storageKey(userId)) ?? null);
  if (stored) return stored;
  const migrated = migrateLegacyNotes(userId, dataDir ?? `cloud://users/${userId}`);
  if (
    migrated.quickNotesIndex.length > 0
    || Object.keys(migrated.quickNotes).length > 0
    || Object.keys(migrated.tickerNotes).length > 0
  ) {
    writeHostedNotes(migrated, userId);
  }
  return migrated;
}

export function writeHostedNotes(payload: NotesSyncPayload, userId = resolveHostedPersistUserId()): void {
  if (!userId) return;
  const backend = tryLocalStorage();
  if (!backend) return;
  try {
    backend.setItem(storageKey(userId), JSON.stringify(payload));
  } catch {
    // Ignore quota or security errors.
  }
}

export function hasHostedNotes(userId = resolveHostedPersistUserId()): boolean {
  const payload = readHostedNotes(userId);
  return payload.quickNotesIndex.length > 0
    || Object.keys(payload.quickNotes).length > 0
    || Object.keys(payload.tickerNotes).length > 0;
}

export function applyHostedNotesPayload(
  incoming: unknown,
  userId = resolveHostedPersistUserId(),
): NotesSyncPayload {
  const current = readHostedNotes(userId);
  if (!isRecord(incoming)) return current;
  const parsed = parsePayload(JSON.stringify(incoming)) ?? emptyPayload();
  const merged: NotesSyncPayload = {
    quickNotesIndex: parsed.quickNotesIndex.length > 0 ? parsed.quickNotesIndex : current.quickNotesIndex,
    quickNotes: { ...current.quickNotes, ...parsed.quickNotes },
    tickerNotes: { ...current.tickerNotes, ...parsed.tickerNotes },
  };
  writeHostedNotes(merged, userId);
  return merged;
}

export function hostedNotesUserIdFromDataDir(dataDir: string): string | null {
  return userIdFromCloudDataDir(dataDir) ?? resolveHostedPersistUserId();
}
