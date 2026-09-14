export type { QuickNoteEntry } from "./files";
import type { NoteFileEntry, QuickNoteEntry } from "./files";

export interface NoteSearchMatch {
  key: string;
  title: string;
  text: string;
  updatedAt: number;
  kind: "quick" | "ticker";
}

export type NoteTickerToken =
  | {
  kind: "text";
  value: string;
}
  | {
  kind: "ticker";
  value: string;
  symbol: string;
};

let nextNoteId = 1;

export function generateNoteId(): string {
  return `${Date.now()}-${nextNoteId++}`;
}

export function formatLastEdited(updatedAt: number | undefined): string {
  if (!updatedAt) return "not edited";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (!Number.isFinite(elapsedSeconds)) return "not edited";
  if (elapsedSeconds < 60) return "now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return "yday";
  if (elapsedDays < 7) return `${elapsedDays}d ago`;

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 5) return `${elapsedWeeks}w ago`;

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${elapsedMonths}mo ago`;

  return `${Math.floor(elapsedDays / 365)}y ago`;
}

export function formatDeleteNoteTitle(title: string): string {
  return title.length > 28 ? `${title.slice(0, 25)}...` : title;
}

/** Matches quick-note titles and all note bodies without building an index. */
export function searchNotes(
  entries: readonly NoteFileEntry[],
  quickNotes: readonly QuickNoteEntry[],
  query: string,
): NoteSearchMatch[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const quickTitles = new Map(quickNotes.map((note) => [note.id, note]));
  return entries.flatMap((entry) => {
    const quickId = entry.key.match(/^__note-(.+)__$/)?.[1];
    const quick = quickId ? quickTitles.get(quickId) : undefined;
    const title = quick?.title ?? (quickId ? "Note" : entry.key);
    if (!title.toLocaleLowerCase().includes(normalizedQuery)
      && !entry.text.toLocaleLowerCase().includes(normalizedQuery)) {
      return [];
    }
    return [{
      key: entry.key,
      title,
      text: entry.text,
      updatedAt: entry.updatedAt,
      kind: quickId ? "quick" : "ticker",
    }];
  });
}

/**
 * Notes deliberately accept a narrower ticker grammar than general market
 * text: uppercase equities only, with an optional exchange suffix.
 */
export function tokenizeNoteTickers(text: string): NoteTickerToken[] {
  const tokens: NoteTickerToken[] = [];
  const pattern = /\$([A-Z]{1,5})(?::([A-Z]{1,10}))?/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text[start - 1] ?? "";
    const after = text[end] ?? "";
    if (/[\p{L}\p{N}_$]/u.test(before) || /[A-Za-z0-9_:]/.test(after)) continue;

    if (start > cursor) tokens.push({ kind: "text", value: text.slice(cursor, start) });
    tokens.push({
      kind: "ticker",
      value: match[0],
      symbol: match[1]! + (match[2] ? `:${match[2]}` : ""),
    });
    cursor = end;
  }

  if (cursor < text.length) tokens.push({ kind: "text", value: text.slice(cursor) });
  return tokens;
}
