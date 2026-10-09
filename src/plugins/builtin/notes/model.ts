import { formatApproximateAge } from "../../../utils/datetime-format";

export type { QuickNoteEntry } from "./files";

let nextNoteId = 1;

export function generateNoteId(): string {
  return `${Date.now()}-${nextNoteId++}`;
}

export function formatLastEdited(updatedAt: number | undefined): string {
  if (!updatedAt || !Number.isFinite(updatedAt)) return "not edited";
  return formatApproximateAge(updatedAt);
}

export function formatDeleteNoteTitle(title: string): string {
  return title.length > 28 ? `${title.slice(0, 25)}...` : title;
}
