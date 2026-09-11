import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import type {
  DocumentSearchHit,
  DocumentSearchProvider,
  SearchDocument,
} from "../../../types/plugin";
import { withConnectionRequest } from "../connections/register";
import {
  GOOGLE_BOOKS_API_BASE_URL,
  GOOGLE_BOOKS_CONNECTION_ID,
  GOOGLE_BOOKS_DOCUMENT_PROVIDER_ID,
  type BookVolume,
  type BookVolumePage,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 20;
const MAX_MAX_RESULTS = 40;

const booksFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-google-books",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    const text = asString(entry);
    if (text) result.push(text);
  }
  return result;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return null;
}

/**
 * Parse a Google Books publishedDate ("YYYY", "YYYY-MM", or "YYYY-MM-DD").
 * Missing month/day default to January/first so partial dates still sort.
 */
export function parsePublishedDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  const day = match[3] ? Number(match[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Parse a single volumes item into a BookVolume. */
export function parseVolume(raw: unknown): BookVolume | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const id = asString(record.id);
  if (!id) return null;

  const volumeInfo = (record.volumeInfo && typeof record.volumeInfo === "object"
    ? record.volumeInfo
    : {}) as Record<string, unknown>;
  const title = asString(volumeInfo.title);
  if (!title) return null;

  const publishedDate = asString(volumeInfo.publishedDate) ?? "";

  return {
    id,
    title,
    authors: asStringArray(volumeInfo.authors),
    publishedDate,
    publishedTime: parsePublishedDate(publishedDate),
    publisher: asString(volumeInfo.publisher) ?? "",
    pageCount: asPositiveInt(volumeInfo.pageCount),
    categories: asStringArray(volumeInfo.categories),
    description: asString(volumeInfo.description) ?? "",
    infoLink: asString(volumeInfo.infoLink) ?? "",
  };
}

export const BOOKS_DISPLAY_CAP = 40;

export function parseVolumesPayload(data: unknown, cap = BOOKS_DISPLAY_CAP): BookVolumePage {
  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const items = Array.isArray(record.items) ? record.items : [];
  const total = typeof record.totalItems === "number" && Number.isFinite(record.totalItems)
    ? Math.max(0, Math.floor(record.totalItems))
    : items.length;
  const volumes: BookVolume[] = [];
  for (const item of items) {
    const volume = parseVolume(item);
    if (!volume) continue;
    volumes.push(volume);
    if (volumes.length >= cap) break;
  }
  return { volumes, total };
}

/**
 * Build the volumes list URL. The raw query is passed through as `q` so the
 * API's own qualifiers (`inauthor:`, `intitle:`) keep working. No API key:
 * the endpoint is free for anonymous use.
 */
export function buildVolumesUrl(query: string, maxResults = DEFAULT_MAX_RESULTS): string {
  const clamped = Math.max(1, Math.min(Math.floor(maxResults) || DEFAULT_MAX_RESULTS, MAX_MAX_RESULTS));
  const params = new URLSearchParams();
  params.set("q", query.trim());
  params.set("maxResults", String(clamped));
  params.set("printType", "books");
  return `${GOOGLE_BOOKS_API_BASE_URL}/volumes?${params.toString()}`;
}

function buildVolumeUrl(id: string): string {
  return `${GOOGLE_BOOKS_API_BASE_URL}/volumes/${encodeURIComponent(id)}`;
}

export class GoogleBooksClient {
  /**
   * Search book volumes. An empty query returns an empty page without a
   * network call so the pane can render its empty state for free.
   */
  async searchVolumes(options: {
    query: string;
    maxResults?: number;
  }): Promise<BookVolumePage> {
    const query = options.query.trim();
    if (!query) return { volumes: [], total: 0 };
    return withConnectionRequest(GOOGLE_BOOKS_CONNECTION_ID, "search", async () => {
      const response = await booksFetch.fetch(buildVolumesUrl(query, options.maxResults));
      if (!response.ok) {
        throw new Error(
          `Google Books request failed: ${response.status} ${response.statusText}`,
        );
      }
      return parseVolumesPayload(await response.json());
    });
  }

  /** Fetch a single volume by id for the document reader. */
  async getVolume(id: string): Promise<BookVolume | null> {
    const trimmed = id.trim();
    if (!trimmed) return null;
    return withConnectionRequest(GOOGLE_BOOKS_CONNECTION_ID, "fetch", async () => {
      const response = await booksFetch.fetch(buildVolumeUrl(trimmed));
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(
          `Google Books request failed: ${response.status} ${response.statusText}`,
        );
      }
      return parseVolume(await response.json());
    });
  }
}

const COMMAND_BAR_RESULT_LIMIT = 4;

const ROUTING_TERMS = new Set([
  "art",
  "article",
  "articles",
  "srch",
  "search",
  "book",
  "books",
  "gbook",
  "gbooks",
]);

/** Strip command and corpus words while retaining the company/person terms books index. */
export function normalizeGoogleBooksDocumentQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter((term) => !ROUTING_TERMS.has(term.toLowerCase().replace(/[^a-z0-9]+/g, "")))
    .join(" ")
    .trim();
}

function volumeSnippet(volume: BookVolume): string {
  return volume.description.length > 280
    ? `${volume.description.slice(0, 280).trimEnd()}…`
    : volume.description;
}

export function bookVolumeToDocumentHit(volume: BookVolume): DocumentSearchHit {
  return {
    id: volume.id,
    title: volume.title,
    publishedAt: volume.publishedTime?.toISOString(),
    snippet: volumeSnippet(volume),
    source: volume.authors[0] ?? volume.publisher,
    documentType: "book",
    url: volume.infoLink || undefined,
    keywords: [...volume.authors, ...volume.categories, "book"].filter(Boolean).slice(0, 8),
    metadata: {
      authors: volume.authors.join(", "),
      publisher: volume.publisher,
      ...(volume.publishedDate ? { publishedDate: volume.publishedDate } : {}),
    },
  };
}

export function bookVolumeToSearchDocument(volume: BookVolume): SearchDocument {
  const facts = [
    volume.authors.length > 0 ? `By ${volume.authors.join(", ")}` : null,
    volume.publishedDate ? `Published ${volume.publishedDate}` : null,
    volume.publisher ? volume.publisher : null,
    volume.pageCount ? `${volume.pageCount} pages` : null,
    volume.categories.length > 0 ? volume.categories.join(", ") : null,
  ].filter((line): line is string => !!line);
  return {
    id: volume.id,
    title: volume.title,
    markdown: [...facts, "", volume.description || "No description available."].join("\n"),
    sourceUrl: volume.infoLink || undefined,
    metadata: {
      source: "Google Books",
      type: "book",
      authors: volume.authors.join(", "),
      ...(volume.publishedDate ? { date: volume.publishedDate } : {}),
    },
  };
}

export function createGoogleBooksDocumentSearchProvider(): DocumentSearchProvider {
  const client = new GoogleBooksClient();
  return {
    id: GOOGLE_BOOKS_DOCUMENT_PROVIDER_ID,
    name: "Google Books",
    sourceId: GOOGLE_BOOKS_CONNECTION_ID,
    documentTypes: ["book"],
    minQueryLength: 2,
    async search(rawQuery, signal) {
      const query = normalizeGoogleBooksDocumentQuery(rawQuery);
      if (!query || signal.aborted) return [];
      const limit = COMMAND_BAR_RESULT_LIMIT;
      const page = await client.searchVolumes({ query, maxResults: limit });
      if (signal.aborted) return [];
      return page.volumes.slice(0, limit).map(bookVolumeToDocumentHit);
    },
    async load(id, signal): Promise<SearchDocument> {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const volume = await client.getVolume(id);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (!volume) throw new Error("Google Books volume was not found.");
      return bookVolumeToSearchDocument(volume);
    },
  };
}
