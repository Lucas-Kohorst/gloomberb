/**
 * The share payload model, deliberately free of runtime dependencies on the
 * terminal.
 *
 * The slim share page (`src/renderers/share`) imports this module, so anything
 * pulled in here lands in that bundle. Keep it to types, plain data, and the
 * base64url codec — no React, no plugins, no theme, no market-data stack.
 *
 * Every payload is a *snapshot*: it carries the values that were on screen when
 * the link was created rather than a query to re-run. That is what lets a share
 * render immediately for a logged-out stranger, and it is why an "open in the
 * terminal" affordance matters — the terminal is where live data lives.
 */

import type { ChartSpec, SeriesStyle, PanelScale } from "../time-series/types";

export const SHARE_KINDS = ["article", "chart", "table"] as const;

export type ShareKind = typeof SHARE_KINDS[number];

// ---------------------------------------------------------------------------
// Article
// ---------------------------------------------------------------------------

export interface ArticleShareStoryItem {
  id: string;
  sourceKey: string;
  sourceName: string;
  title: string;
  summary?: string;
  url: string;
  publishedAt: string;
}

export interface ArticleSharePayload {
  type: "news" | "substack";
  id: string;
  title: string;
  url: string;
  source: string;
  summary?: string;
  publishedAt?: string;
  topics?: string[];
  categories?: string[];
  tickers?: string[];
  importance?: number;
  items?: ArticleShareStoryItem[];
  // Substack-specific
  subtitle?: string;
  publicationName?: string;
  publicationBaseUrl?: string;
  slug?: string;
  previewText?: string;
  bodyHtml?: string;
  imageUrls?: string[];
  wordCount?: number;
  readMinutes?: number;
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

/**
 * Keys are single letters because a chart snapshot is mostly points and the
 * KV record has a 512 KB ceiling: `{"t":1,"v":2}` against
 * `{"time":1,"value":2}` is a third of the bytes across thousands of points.
 */
export interface ChartSharePoint {
  /** Epoch milliseconds. */
  t: number;
  v?: number | null;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
}

export interface ChartShareSeries {
  id: string;
  label: string;
  color: string;
  style: SeriesStyle;
  axis: "left" | "right";
  panelId: string;
  unit?: string;
  points: ChartSharePoint[];
}

export interface ChartSharePanel {
  id: string;
  label?: string;
  height?: number;
  scale?: PanelScale;
}

export interface ChartSharePayload {
  title: string;
  subtitle?: string;
  capturedAt: string;
  panels: ChartSharePanel[];
  series: ChartShareSeries[];
  /** Inclusive bounds the snapshot was captured at, as ISO strings. */
  window?: { start: string; end: string };
  /**
   * The authored spec, so the terminal can reopen the chart live instead of
   * replaying frozen points. Absent on legacy shares.
   */
  spec?: ChartSpec;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export interface TableShareColumn {
  id: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Relative width hint in characters, mirroring the pane's column config. */
  width?: number;
}

export interface TableShareCell {
  text: string;
  color?: string;
}

export interface TableShareRow {
  cells: TableShareCell[];
  /** External destination for the row, when the source pane had one. */
  url?: string;
}

export interface TableSharePayload {
  title: string;
  subtitle?: string;
  capturedAt: string;
  columns: TableShareColumn[];
  rows: TableShareRow[];
  /** Set when rows were capped, so the page can say the view is partial. */
  truncatedFrom?: number;
  /** Pane template the rows came from, so the terminal can reopen it live. */
  paneTemplateId?: string;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type SharePayload =
  | { kind: "article"; data: ArticleSharePayload }
  | { kind: "chart"; data: ChartSharePayload }
  | { kind: "table"; data: TableSharePayload };

export interface ShareEnvelope {
  kind: ShareKind;
  data: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// base64url codec (browser, Node, Bun, and Workers)
// ---------------------------------------------------------------------------

export function base64urlEncode(data: string): string {
  const bytes = new TextEncoder().encode(data);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(data, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(encoded: string): string | null {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const base64 = pad ? padded + "=".repeat(4 - pad) : padded;
    if (typeof atob === "function") {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation
//
// Share payloads arrive from a URL or from KV, so both are untrusted input.
// These parsers are the single gate: they return null rather than throwing so
// callers can fall back to "this link is no longer available".
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseArticleSharePayload(value: unknown): ArticleSharePayload | null {
  const record = asRecord(value);
  if (!record) return null;
  if (asString(record.id) === null) return null;
  if (asString(record.title) === null) return null;
  if (asString(record.url) === null) return null;
  if (record.type !== "news" && record.type !== "substack") return null;
  return record as unknown as ArticleSharePayload;
}

export function parseChartSharePayload(value: unknown): ChartSharePayload | null {
  const record = asRecord(value);
  if (!record) return null;
  if (!Array.isArray(record.series) || !Array.isArray(record.panels)) return null;
  if (asString(record.title) === null) return null;
  return record as unknown as ChartSharePayload;
}

export function parseTableSharePayload(value: unknown): TableSharePayload | null {
  const record = asRecord(value);
  if (!record) return null;
  if (!Array.isArray(record.columns) || !Array.isArray(record.rows)) return null;
  if (asString(record.title) === null) return null;
  return record as unknown as TableSharePayload;
}

/** Narrow an untrusted `{ kind, data }` pair into a renderable payload. */
export function parseSharePayload(kind: unknown, data: unknown): SharePayload | null {
  if (kind === "article") {
    const parsed = parseArticleSharePayload(data);
    return parsed ? { kind: "article", data: parsed } : null;
  }
  if (kind === "chart") {
    const parsed = parseChartSharePayload(data);
    return parsed ? { kind: "chart", data: parsed } : null;
  }
  if (kind === "table") {
    const parsed = parseTableSharePayload(data);
    return parsed ? { kind: "table", data: parsed } : null;
  }
  return null;
}

/**
 * Chart shares created before snapshots stored only the authored spec, which
 * the slim page cannot draw — it has no market-data stack. Those links stay
 * valid by handing off to the terminal, which can still resolve them live.
 */
export function isSpecOnlyChartShare(data: unknown): boolean {
  const record = asRecord(data);
  return !!record && !!asRecord(record.spec) && !Array.isArray(record.series);
}

/** Decode an inline `?a=` article payload. */
export function decodeArticleSharePayload(encoded: string): ArticleSharePayload | null {
  const json = base64urlDecode(encoded);
  if (!json) return null;
  try {
    return parseArticleSharePayload(JSON.parse(json));
  } catch {
    return null;
  }
}

export function encodeArticleSharePayload(payload: ArticleSharePayload): string {
  return base64urlEncode(JSON.stringify(payload));
}
