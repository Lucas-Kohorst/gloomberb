import {
  hostedNotesUserIdFromDataDir,
  readHostedNotes,
  writeHostedNotes,
} from "../../../data/config/hosted-notes-persist";
import { getHostedConfigSnapshotPusher } from "../../../data/config/hosted-config-snapshot";

export interface QuickNoteEntry {
  id: string;
  title: string;
  updatedAt?: number;
}

/** A stored note: `key` is what `load`/`save` take, not the file path. */
export interface NoteFileEntry {
  key: string;
  text: string;
  updatedAt: number;
}

const QUICK_NOTES_INDEX = "__quick-notes-index__";
const STORAGE_PREFIX = "gloomberb:notes:";
const LOCAL_TIMESTAMP_KEY = "gloomberb:notes:__updated-at__";
const MAX_NOTE_KEY_LENGTH = 64;

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

export function isSafeNoteKey(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_NOTE_KEY_LENGTH
    && !value.includes("..")
    && !value.startsWith(".")
    && /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(value);
}

export function isSafeQuickNoteId(value: unknown): value is string {
  return typeof value === "string" && isSafeNoteKey(`__note-${value}__`);
}

function assertSafeNoteKey(value: string): void {
  if (!isSafeNoteKey(value)) throw new Error("Invalid note key");
}

interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  length: number;
  key(index: number): string | null;
}

function getLocalStorage(): LocalStorageLike | null {
  return (globalThis as { localStorage?: LocalStorageLike }).localStorage ?? null;
}

async function readTextFile(path: string): Promise<string> {
  if (typeof Bun !== "undefined") {
    const fsModulePath = "fs/promises";
    const { readFile } = await import(fsModulePath) as typeof import("fs/promises");
    return readFile(path, "utf-8");
  }
  return getLocalStorage()?.getItem(`gloomberb:notes:${path}`) ?? "";
}

/** Browsers have no mtime, so note writes keep their own timestamp index. */
function readLocalTimestamps(): Record<string, number> {
  try {
    const raw = getLocalStorage()?.getItem(LOCAL_TIMESTAMP_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, number>
      : {};
  } catch {
    return {};
  }
}

function writeLocalTimestamp(path: string, updatedAt: number | null): void {
  const storage = getLocalStorage();
  if (!storage) return;
  const timestamps = readLocalTimestamps();
  if (updatedAt == null) delete timestamps[path];
  else timestamps[path] = updatedAt;
  try { storage.setItem(LOCAL_TIMESTAMP_KEY, JSON.stringify(timestamps)); } catch {}
}

async function writeTextFile(path: string, value: string): Promise<void> {
  if (typeof Bun !== "undefined") {
    const fsModulePath = "fs/promises";
    const { writeFile } = await import(fsModulePath) as typeof import("fs/promises");
    await writeFile(path, value, "utf-8");
    return;
  }
  getLocalStorage()?.setItem(`gloomberb:notes:${path}`, value);
  writeLocalTimestamp(path, Date.now());
}

async function deleteTextFile(path: string): Promise<void> {
  if (typeof Bun !== "undefined") {
    const fsModulePath = "fs/promises";
    const { unlink } = await import(fsModulePath) as typeof import("fs/promises");
    await unlink(path);
    return;
  }
  getLocalStorage()?.removeItem(`gloomberb:notes:${path}`);
  writeLocalTimestamp(path, null);
}

function isHostedNotesDir(dataDir: string): boolean {
  return dataDir.startsWith("cloud:");
}

export class NotesFiles {
  constructor(private readonly dataDir: string) {}

  private pathFor(symbol: string): string {
    assertSafeNoteKey(symbol);
    return joinPath(this.dataDir, `${symbol}.md`);
  }

  private hostedUserId(): string | null {
    if (!isHostedNotesDir(this.dataDir)) return null;
    return hostedNotesUserIdFromDataDir(this.dataDir);
  }

  /**
   * A note that was never written is empty, but any other read failure is
   * rethrown: an unreadable note must not present itself as an empty editable
   * one, or the next save silently overwrites real content.
   */
  async load(symbol: string): Promise<string> {
    const path = this.pathFor(symbol);
    const userId = this.hostedUserId();
    if (userId) {
      const payload = readHostedNotes(userId, this.dataDir);
      if (symbol.startsWith("__note-") && symbol.endsWith("__")) {
        return payload.quickNotes[symbol.slice("__note-".length, -2)] ?? "";
      }
      return payload.tickerNotes[symbol] ?? "";
    }
    try {
      return await readTextFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "";
      throw error;
    }
  }

  async save(symbol: string, notes: string): Promise<void> {
    const path = this.pathFor(symbol);
    const userId = this.hostedUserId();
    if (userId) {
      const payload = readHostedNotes(userId, this.dataDir);
      if (symbol.startsWith("__note-") && symbol.endsWith("__")) {
        const id = symbol.slice("__note-".length, -2);
        if (notes) payload.quickNotes[id] = notes;
        else delete payload.quickNotes[id];
      } else if (notes) {
        payload.tickerNotes[symbol] = notes;
      } else {
        delete payload.tickerNotes[symbol];
      }
      writeHostedNotes(payload, userId);
      writeLocalTimestamp(path, notes ? Date.now() : null);
      getHostedConfigSnapshotPusher().scheduleFromLast();
      return;
    }
    await writeTextFile(path, notes || "");
  }

  async delete(symbol: string): Promise<void> {
    const path = this.pathFor(symbol);
    const userId = this.hostedUserId();
    if (userId) {
      await this.save(symbol, "");
      return;
    }
    try {
      await deleteTextFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  /** Every stored note, ticker notes and quick notes alike, newest first. */
  async list(): Promise<NoteFileEntry[]> {
    const entries: NoteFileEntry[] = [];
    for (const [key, updatedAt] of await this.listKeys()) {
      try {
        entries.push({ key, text: await this.load(key), updatedAt });
      } catch {
        // An unreadable note is skipped rather than synced as empty.
      }
    }
    return entries.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  private async listKeys(): Promise<Array<[string, number]>> {
    const userId = this.hostedUserId();
    if (userId) {
      const notes = readHostedNotes(userId, this.dataDir);
      const timestamps = readLocalTimestamps();
      const keys = [
        ...Object.keys(notes.tickerNotes).filter(isSafeNoteKey),
        ...Object.keys(notes.quickNotes)
          .filter(isSafeQuickNoteId)
          .map((id) => this.quickNoteKey(id)),
      ];
      return keys.map((key) => {
        const path = this.pathFor(key);
        const updatedAt = timestamps[path] ?? Date.now();
        if (timestamps[path] == null) writeLocalTimestamp(path, updatedAt);
        return [key, updatedAt];
      });
    }
    if (typeof Bun !== "undefined") {
      const fsModulePath = "fs/promises";
      const { readdir, stat } = await import(fsModulePath) as typeof import("fs/promises");
      let names: string[];
      try {
        names = await readdir(this.dataDir);
      } catch {
        return [];
      }
      const keys: Array<[string, number]> = [];
      for (const name of names) {
        if (!name.endsWith(".md") || !isSafeNoteKey(name.slice(0, -3))) continue;
        try {
          const info = await stat(joinPath(this.dataDir, name));
          keys.push([name.slice(0, -3), Math.round(info.mtimeMs)]);
        } catch {}
      }
      return keys;
    }
    const prefix = joinPath(this.dataDir, "");
    const timestamps = readLocalTimestamps();
    const storageKeyPrefix = `gloomberb:notes:${prefix}`;
    // Notes written before the index existed are stamped now rather than at
    // the epoch, so an older cloud copy cannot overwrite them on first sync.
    for (const storageKey of Object.keys(globalThis.localStorage ?? {})) {
      if (!storageKey.startsWith(storageKeyPrefix) || !storageKey.endsWith(".md")) continue;
      const path = storageKey.slice("gloomberb:notes:".length);
      if (timestamps[path] == null) writeLocalTimestamp(path, timestamps[path] = Date.now());
    }
    return Object.entries(timestamps)
      .filter(([path]) => path.startsWith(prefix)
        && path.endsWith(".md")
        && isSafeNoteKey(path.slice(prefix.length, -3)))
      .map(([path, updatedAt]) => [path.slice(prefix.length, -3), updatedAt]);
  }

  private indexPath(): string {
    return joinPath(this.dataDir, `${QUICK_NOTES_INDEX}.json`);
  }

  async loadQuickNotesIndex(): Promise<QuickNoteEntry[]> {
    const userId = this.hostedUserId();
    if (userId) return readHostedNotes(userId, this.dataDir).quickNotesIndex;
    try {
      const raw = await readTextFile(this.indexPath());
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async saveQuickNotesIndex(entries: QuickNoteEntry[]): Promise<void> {
    const userId = this.hostedUserId();
    if (userId) {
      const payload = readHostedNotes(userId, this.dataDir);
      payload.quickNotesIndex = entries;
      writeHostedNotes(payload, userId);
      getHostedConfigSnapshotPusher().scheduleFromLast();
      return;
    }
    await writeTextFile(this.indexPath(), JSON.stringify(entries));
  }

  quickNoteKey(id: string): string {
    return `__note-${id}__`;
  }

  async listAllNoteSymbols(): Promise<string[]> {
    const userId = this.hostedUserId();
    if (userId) return Object.keys(readHostedNotes(userId, this.dataDir).tickerNotes).filter(isSafeNoteKey);
    if (typeof Bun !== "undefined") {
      const fsModulePath = "fs/promises";
      const { readdir } = await import(fsModulePath) as typeof import("fs/promises");
      try {
        const entries = await readdir(this.dataDir);
        return entries
          .filter((entry) => entry.endsWith(".md")
            && !entry.startsWith(QUICK_NOTES_INDEX)
            && isSafeNoteKey(entry.slice(0, -3)))
          .map((entry) => entry.slice(0, -3));
      } catch {
        return [];
      }
    }
    const storage = getLocalStorage();
    if (!storage) return [];
    const symbols: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      const path = key.slice(STORAGE_PREFIX.length);
      if (path.endsWith(".md")
        && !path.startsWith(QUICK_NOTES_INDEX)
        && isSafeNoteKey(path.slice(0, -3))) {
        symbols.push(path.slice(0, -3));
      }
    }
    return symbols;
  }

  async collectAllForSync(): Promise<NotesSyncPayload> {
    const quickNotesIndex = await this.loadQuickNotesIndex();
    const quickNotes: Record<string, string> = {};
    for (const entry of quickNotesIndex) {
      if (!isSafeQuickNoteId(entry.id)) continue;
      const text = await this.load(this.quickNoteKey(entry.id));
      if (text) quickNotes[entry.id] = text;
    }
    const symbols = await this.listAllNoteSymbols();
    const tickerNotes: Record<string, string> = {};
    for (const symbol of symbols) {
      const text = await this.load(symbol);
      if (text) tickerNotes[symbol] = text;
    }
    return { quickNotesIndex, quickNotes, tickerNotes };
  }

  async applySyncData(data: NotesSyncPayload): Promise<void> {
    if (Array.isArray(data.quickNotesIndex)) {
      await this.saveQuickNotesIndex(data.quickNotesIndex);
    }
    if (data.quickNotes && typeof data.quickNotes === "object") {
      for (const [id, text] of Object.entries(data.quickNotes)) {
        if (typeof text === "string" && isSafeQuickNoteId(id)) {
          await this.save(this.quickNoteKey(id), text);
        }
      }
    }
    if (data.tickerNotes && typeof data.tickerNotes === "object") {
      for (const [symbol, text] of Object.entries(data.tickerNotes)) {
        if (typeof text === "string" && isSafeNoteKey(symbol)) {
          await this.save(symbol, text);
        }
      }
    }
  }
}

export interface NotesSyncPayload {
  quickNotesIndex: QuickNoteEntry[];
  quickNotes: Record<string, string>;
  tickerNotes: Record<string, string>;
}
