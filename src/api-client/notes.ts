import { ApiRequestError } from "./errors";
import type { CloudNote, CloudNoteScope, CloudNoteSummary, NoteKind } from "./types";

type CloudApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

/** A save refused because the note changed since it was loaded. */
export class NoteConflictError extends Error {
  constructor(
    message: string,
    public readonly current: CloudNote | null,
  ) {
    super(message);
    this.name = "NoteConflictError";
  }
}

function scopeQuery(scope: CloudNoteScope): string {
  const params = new URLSearchParams({ scope: scope.scope });
  if (scope.teamId) params.set("teamId", scope.teamId);
  return params.toString();
}

export class CloudNotesApi {
  constructor(private readonly request: CloudApiRequest) {}

  async listNotes(scope: CloudNoteScope): Promise<CloudNoteSummary[]> {
    const body = await this.request<{ items: CloudNoteSummary[] }>(`/notes?${scopeQuery(scope)}`);
    return body.items;
  }

  async getNote(id: string): Promise<CloudNote | null> {
    try {
      return await this.request<CloudNote>(`/notes/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Upserts by (owner, kind, key). `expectedRevision` becomes If-Match; a 412
   * throws NoteConflictError carrying the note the server holds now.
   */
  async putNote(input: {
    scope: CloudNoteScope;
    kind: NoteKind;
    key: string;
    title?: string | null;
    content: string;
    expectedRevision?: number;
  }): Promise<CloudNote> {
    try {
      return await this.request<CloudNote>("/notes", {
        method: "PUT",
        headers: input.expectedRevision ? { "if-match": String(input.expectedRevision) } : {},
        body: JSON.stringify({
          scope: input.scope.scope,
          ...(input.scope.teamId ? { teamId: input.scope.teamId } : {}),
          kind: input.kind,
          key: input.key,
          ...(input.title !== undefined ? { title: input.title } : {}),
          content: input.content,
        }),
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 412) {
        // The 412 body carries the current note, but the transport keeps only
        // the message. One extra read gets the editor's name and content.
        const current = await this.findNote(input.scope, input.kind, input.key).catch(() => null);
        throw new NoteConflictError(error.message, current);
      }
      throw error;
    }
  }

  async deleteNote(id: string): Promise<void> {
    try {
      await this.request<unknown>(`/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return;
      throw error;
    }
  }

  private async findNote(scope: CloudNoteScope, kind: NoteKind, key: string): Promise<CloudNote | null> {
    const summary = (await this.listNotes(scope)).find((entry) => entry.kind === kind && entry.key === key);
    return summary ? this.getNote(summary.id) : null;
  }
}
