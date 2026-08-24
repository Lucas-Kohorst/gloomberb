import { NOTES_FILES_CAPABILITY_ID } from "../../../capabilities";
import {
  NotesFiles as HostedNotesFiles,
  type NotesSyncPayload,
} from "../../../plugins/builtin/notes/files";
import { isHostedWebClient } from "../../../shared/hosted-api";
import { backendRequest } from "./backend-rpc";

export interface QuickNoteEntry {
  id: string;
  title: string;
  updatedAt?: number;
}

export class NotesFiles {
  private readonly hosted: HostedNotesFiles | null;

  constructor(private readonly dataDir: string) {
    this.hosted = isHostedWebClient() ? new HostedNotesFiles(dataDir) : null;
  }

  private invoke<T>(operationId: string, payload: Record<string, unknown> = {}): Promise<T> {
    return backendRequest<T>("capability.invoke", {
      capabilityId: NOTES_FILES_CAPABILITY_ID,
      operationId,
      payload: {
        dataDir: this.dataDir,
        ...payload,
      },
    });
  }

  async load(symbol: string): Promise<string> {
    if (this.hosted) return this.hosted.load(symbol);
    return this.invoke<string>("load", {
      symbol,
    });
  }

  async save(symbol: string, notes: string): Promise<void> {
    if (this.hosted) {
      await this.hosted.save(symbol, notes);
      return;
    }
    await this.invoke("save", {
      symbol,
      notes,
    });
  }

  async delete(symbol: string): Promise<void> {
    if (this.hosted) {
      await this.hosted.delete(symbol);
      return;
    }
    await this.invoke("delete", {
      symbol,
    });
  }

  async loadQuickNotesIndex(): Promise<QuickNoteEntry[]> {
    if (this.hosted) return this.hosted.loadQuickNotesIndex();
    return this.invoke<QuickNoteEntry[]>("loadQuickNotesIndex");
  }

  async saveQuickNotesIndex(entries: QuickNoteEntry[]): Promise<void> {
    if (this.hosted) {
      await this.hosted.saveQuickNotesIndex(entries);
      return;
    }
    await this.invoke("saveQuickNotesIndex", {
      entries,
    });
  }

  async collectAllForSync(): Promise<NotesSyncPayload> {
    if (this.hosted) return this.hosted.collectAllForSync();
    return this.invoke<NotesSyncPayload>("collectAllForSync");
  }

  async applySyncData(data: NotesSyncPayload): Promise<void> {
    if (this.hosted) {
      await this.hosted.applySyncData(data);
      return;
    }
    await this.invoke("applySyncData", { data });
  }

  quickNoteKey(id: string): string {
    return `__note-${id}__`;
  }
}
