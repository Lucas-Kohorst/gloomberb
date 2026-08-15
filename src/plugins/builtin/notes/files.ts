export interface QuickNoteEntry {
  id: string;
  title: string;
  updatedAt?: number;
}

const QUICK_NOTES_INDEX = "__quick-notes-index__";
const STORAGE_PREFIX = "gloomberb:notes:";

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
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

async function writeTextFile(path: string, value: string): Promise<void> {
  if (typeof Bun !== "undefined") {
    const fsModulePath = "fs/promises";
    const { writeFile } = await import(fsModulePath) as typeof import("fs/promises");
    await writeFile(path, value, "utf-8");
    return;
  }
  getLocalStorage()?.setItem(`gloomberb:notes:${path}`, value);
}

async function deleteTextFile(path: string): Promise<void> {
  if (typeof Bun !== "undefined") {
    const fsModulePath = "fs/promises";
    const { unlink } = await import(fsModulePath) as typeof import("fs/promises");
    await unlink(path);
    return;
  }
  getLocalStorage()?.removeItem(`gloomberb:notes:${path}`);
}

export class NotesFiles {
  constructor(private readonly dataDir: string) {}

  private pathFor(symbol: string): string {
    return joinPath(this.dataDir, `${symbol}.md`);
  }

  async load(symbol: string): Promise<string> {
    try {
      return await readTextFile(this.pathFor(symbol));
    } catch {
      return "";
    }
  }

  async save(symbol: string, notes: string): Promise<void> {
    await writeTextFile(this.pathFor(symbol), notes || "");
  }

  async delete(symbol: string): Promise<void> {
    try {
      await deleteTextFile(this.pathFor(symbol));
    } catch {
      // ignore missing files
    }
  }

  private indexPath(): string {
    return joinPath(this.dataDir, `${QUICK_NOTES_INDEX}.json`);
  }

  async loadQuickNotesIndex(): Promise<QuickNoteEntry[]> {
    try {
      const raw = await readTextFile(this.indexPath());
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async saveQuickNotesIndex(entries: QuickNoteEntry[]): Promise<void> {
    await writeTextFile(this.indexPath(), JSON.stringify(entries));
  }

  quickNoteKey(id: string): string {
    return `__note-${id}__`;
  }

  async listAllNoteSymbols(): Promise<string[]> {
    if (typeof Bun !== "undefined") {
      const fsModulePath = "fs/promises";
      const { readdir } = await import(fsModulePath) as typeof import("fs/promises");
      try {
        const entries = await readdir(this.dataDir);
        return entries
          .filter((entry) => entry.endsWith(".md") && !entry.startsWith(QUICK_NOTES_INDEX))
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
      if (path.endsWith(".md") && !path.startsWith(QUICK_NOTES_INDEX)) {
        symbols.push(path.slice(0, -3));
      }
    }
    return symbols;
  }

  async collectAllForSync(): Promise<NotesSyncPayload> {
    const quickNotesIndex = await this.loadQuickNotesIndex();
    const quickNotes: Record<string, string> = {};
    for (const entry of quickNotesIndex) {
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
        if (typeof text === "string") {
          await this.save(this.quickNoteKey(id), text);
        }
      }
    }
    if (data.tickerNotes && typeof data.tickerNotes === "object") {
      for (const [symbol, text] of Object.entries(data.tickerNotes)) {
        if (typeof text === "string") {
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
