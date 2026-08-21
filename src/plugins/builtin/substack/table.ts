import type {
  SubstackArticleSummary,
  SubstackColumn,
  SubstackPublication,
  SubstackSortColumnId,
  SubstackSortDirection,
} from "./types";
import { publicationKey } from "./normalize";
import { timestamp } from "./utils";

export function isSubstackSortColumnId(value: string): value is SubstackSortColumnId {
  return value === "published" || value === "publication" || value === "title" || value === "read";
}

export function nextSubstackSort(
  current: { columnId: SubstackSortColumnId; direction: SubstackSortDirection },
  columnId: SubstackSortColumnId,
): { columnId: SubstackSortColumnId; direction: SubstackSortDirection } {
  if (current.columnId === columnId) {
    return { columnId, direction: current.direction === "desc" ? "asc" : "desc" };
  }
  return {
    columnId,
    direction: columnId === "title" || columnId === "publication" ? "asc" : "desc",
  };
}

export function sortedSubstackArticles(
  articles: SubstackArticleSummary[],
  sort: { columnId: SubstackSortColumnId; direction: SubstackSortDirection },
): SubstackArticleSummary[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...articles].sort((a, b) => {
    let result = 0;
    switch (sort.columnId) {
      case "published":
        result = timestamp(a.publishedAt) - timestamp(b.publishedAt);
        break;
      case "publication":
        result = (a.publicationName ?? "").localeCompare(b.publicationName ?? "");
        break;
      case "title":
        result = a.title.localeCompare(b.title);
        break;
      case "read":
        result = a.readMinutes - b.readMinutes;
        break;
    }
    return result === 0 ? timestamp(b.publishedAt) - timestamp(a.publishedAt) : result * direction;
  });
}

export function formatPublishedAt(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const datePart = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" as const }),
  });
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart}`;
}

export function formatReadTime(minutes: number): string {
  return `${Math.max(1, Math.ceil(minutes))}m`;
}

export function formatWordCount(words: number): string {
  if (words >= 1000) return `${(words / 1000).toFixed(words >= 10_000 ? 0 : 1)}k words`;
  return `${Math.max(0, Math.round(words))} words`;
}

export function buildSubstackColumns(
  width: number,
  includePublication: boolean,
  columnIds?: readonly SubstackSortColumnId[],
): SubstackColumn[] {
  const publishedWidth = 13;
  const readWidth = 5;
  const publicationWidth = includePublication ? Math.max(12, Math.min(21, Math.floor(width * 0.18))) : 0;
  const requested = columnIds && columnIds.length > 0
    ? columnIds.filter((id) => id !== "publication" || includePublication)
    : undefined;
  const visible = requested && requested.length > 0
    ? (requested.includes("title") ? requested : [...requested, "title" as const])
    : ([
      "published",
      ...(includePublication ? ["publication" as const] : []),
      "title",
      "read",
    ] satisfies SubstackSortColumnId[]);
  const layout: Record<SubstackSortColumnId, { label: string; width: number; align: "left" | "right"; flex?: boolean }> = {
    published: { label: "Published", width: publishedWidth, align: "left" },
    publication: { label: "Publication", width: publicationWidth, align: "left" },
    title: { label: "Title", width: 18, align: "left", flex: true },
    read: { label: "Read", width: readWidth, align: "right" },
  };
  const flexId = visible.includes("title") ? "title" : visible[0];
  const fixed = visible.filter((id) => id !== flexId).reduce((sum, id) => sum + layout[id]!.width, 0);
  const flexWidth = Math.max(layout[flexId ?? "title"]!.width, width - fixed - visible.length);
  return visible.map((id) => ({
    id,
    label: layout[id]!.label,
    width: id === flexId ? flexWidth : layout[id]!.width,
    align: layout[id]!.align,
    flexGrow: id === flexId ? 1 : undefined,
  }));
}

export function tabIdForPublication(publication: SubstackPublication): string {
  return `pub:${publicationKey(publication)}`;
}

export function publicationFromTabId(
  tabId: string,
  publications: SubstackPublication[],
): SubstackPublication | null {
  if (!tabId.startsWith("pub:")) return null;
  const key = tabId.slice(4);
  return publications.find((publication) => publicationKey(publication) === key) ?? null;
}
