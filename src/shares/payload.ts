import {
  parseMarketplaceLayoutPayload,
  type LayoutMarketplacePayload,
} from "../layout-marketplace/payload";
import type { ChartSpec, PanelScale, SeriesStyle } from "../time-series/types";
import { safeExternalUrl } from "../utils/external-url";

export const MAX_SHARE_BYTES = 128 * 1024;
const MAX_TITLE_LENGTH = 200;
/** Tweets are stored as the article title; 200 chars rejects a normal post. */
const MAX_ARTICLE_TITLE_LENGTH = 4_000;
const MAX_TEXT_LENGTH = 50_000;
const MAX_TABLE_COLUMNS = 20;
export const MAX_TABLE_ROWS = 200;
const MAX_CHART_SERIES = 20;
const MAX_CHART_POINTS = 500;
const MAX_PANE_DESCRIPTION_LENGTH = 500;
const MAX_PANE_DATA_DEPTH = 8;
const MAX_PANE_OBJECT_KEYS = 64;
const MAX_PANE_ARRAY_ITEMS = 5_000;
const MAX_PANE_STRING_LENGTH = 4_096;
const PANE_TEMPLATE_ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/;

type CellValue = string | number | boolean | null;
export type ShareJsonValue = CellValue | ShareJsonValue[] | { [key: string]: ShareJsonValue };

export interface TableShareData {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, CellValue>>;
  sourceUrl?: string;
}

export interface ChartShareData {
  title: string;
  series: Array<{
    name: string;
    points: Array<{ x: string | number; y: number }>;
  }>;
  sourceUrl?: string;
}

export interface ArticleShareData {
  title: string;
  text: string;
  sourceUrl?: string;
}

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

export interface LegacyPaneShareData {
  version: 1;
  templateId: string;
  title: string;
  description?: string;
  data: Record<string, ShareJsonValue>;
}

export interface PortablePaneShareData {
  version: 2;
  title: string;
  description?: string;
  layout: LayoutMarketplacePayload;
}

export type PaneShareData = LegacyPaneShareData | PortablePaneShareData;

export type SharePayload =
  | { kind: "table"; data: TableShareData }
  | { kind: "chart"; data: ChartShareData }
  | { kind: "article"; data: ArticleShareData }
  | { kind: "pane"; data: PaneShareData };

/**
 * What the slim share page renders: snapshots captured from the terminal,
 * distinct from the terminal's envelope model above. `parseSharePayload`
 * returns this union only for the page's `(kind, data)` calling convention.
 */
export type SharePagePayload =
  | { kind: "article"; data: ArticleSharePayload }
  | { kind: "chart"; data: ChartSharePayload }
  | { kind: "table"; data: TableSharePayload };

// ---------------------------------------------------------------------------
// Slim share page snapshot model
//
// The share document (`src/renderers/share`) renders snapshots captured from
// the terminal: a chart keeps its panels and points, a table keeps its
// rendered cells. These types describe that stored shape; the fork's own
// terminal sharing API additionally carries the `pane` kind above.
// ---------------------------------------------------------------------------

export const SHARE_KINDS = ["article", "chart", "table"] as const;

export type ShareKind = typeof SHARE_KINDS[number];

/**
 * Keys are single letters because a chart snapshot is mostly points and the
 * stored record has a size ceiling: `{"t":1,"v":2}` against
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
  /** ISO timestamp the snapshot was captured at. */
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
  /** ISO timestamp the snapshot was captured at. */
  capturedAt: string;
  columns: TableShareColumn[];
  rows: TableShareRow[];
  /** Set when rows were capped, so the page can say the view is partial. */
  truncatedFrom?: number;
  /** Pane template the rows came from, so the terminal can reopen it live. */
  paneTemplateId?: string;
}

export interface ShareEnvelope {
  kind: ShareKind;
  data: unknown;
  createdAt: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function shortString(value: unknown, max = MAX_TITLE_LENGTH): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function safeOptionalUrl(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && safeExternalUrl(value) !== null);
}

function isCell(value: unknown): value is CellValue {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isTableData(value: unknown): value is TableShareData {
  if (!record(value) || !shortString(value.title) || !safeOptionalUrl(value.sourceUrl)) return false;
  if (!Array.isArray(value.columns) || value.columns.length === 0 || value.columns.length > MAX_TABLE_COLUMNS) return false;
  const keys = new Set<string>();
  for (const column of value.columns) {
    if (!record(column) || !shortString(column.key, 80) || !shortString(column.label, 120) || keys.has(column.key)) return false;
    keys.add(column.key);
  }
  return Array.isArray(value.rows)
    && value.rows.length <= MAX_TABLE_ROWS
    && value.rows.every((row) => record(row)
      && Object.keys(row).every((key) => keys.has(key))
      && Object.values(row).every(isCell));
}

function isChartData(value: unknown): value is ChartShareData {
  if (!record(value) || !shortString(value.title) || !safeOptionalUrl(value.sourceUrl)) return false;
  return Array.isArray(value.series)
    && value.series.length > 0
    && value.series.length <= MAX_CHART_SERIES
    && value.series.every((series) => record(series)
      && shortString(series.name, 120)
      && Array.isArray(series.points)
      && series.points.length > 0
      && series.points.length <= MAX_CHART_POINTS
      && series.points.every((point) => record(point)
        && ((typeof point.x === "string" && point.x.length <= 100) || (typeof point.x === "number" && Number.isFinite(point.x)))
        && typeof point.y === "number"
        && Number.isFinite(point.y)));
}

function isArticleData(value: unknown): value is ArticleShareData {
  return record(value)
    && shortString(value.title, MAX_ARTICLE_TITLE_LENGTH)
    && typeof value.text === "string"
    && value.text.length <= MAX_TEXT_LENGTH
    && safeOptionalUrl(value.sourceUrl);
}

function boundedJson(value: unknown, depth = 0): value is ShareJsonValue {
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.length <= MAX_PANE_STRING_LENGTH;
  if (depth >= MAX_PANE_DATA_DEPTH) return false;
  if (Array.isArray(value)) {
    return value.length <= MAX_PANE_ARRAY_ITEMS && value.every((entry) => boundedJson(entry, depth + 1));
  }
  if (!record(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_PANE_OBJECT_KEYS && entries.every(([, entry]) => boundedJson(entry, depth + 1));
}

function parsePaneData(value: unknown): PaneShareData | null {
  if (!record(value) || !shortString(value.title)) return null;
  if (
    value.version === 1
    && Object.keys(value).every((key) => ["version", "templateId", "title", "description", "data"].includes(key))
    && typeof value.templateId === "string"
    && PANE_TEMPLATE_ID.test(value.templateId)
    && (value.description === undefined || shortString(value.description, MAX_PANE_DESCRIPTION_LENGTH))
    && record(value.data)
    && boundedJson(value.data)
  ) return value as unknown as LegacyPaneShareData;
  if (
    value.version !== 2
    || !Object.keys(value).every((key) => ["version", "title", "description", "layout"].includes(key))
    || (value.description !== undefined && !shortString(value.description, MAX_PANE_DESCRIPTION_LENGTH))
  ) return null;
  const layout = parseMarketplaceLayoutPayload(value.layout);
  return layout?.schemaVersion === 2 && layout.layout.instances.length === 1
    ? {
        version: 2,
        title: value.title,
        ...(value.description === undefined ? {} : { description: value.description }),
        layout,
      }
    : null;
}

/** Narrow a `{ kind, data }` envelope exactly as it was stored. */
function parseShareEnvelope(value: Record<string, unknown>): SharePayload | null {
  if (!shortString(value.kind, 20) || !("data" in value)) return null;
  let json: string;
  try { json = JSON.stringify(value); } catch { return null; }
  if (new TextEncoder().encode(json).byteLength > MAX_SHARE_BYTES) return null;
  if (value.kind === "table" && isTableData(value.data)) return value as unknown as SharePayload;
  if (value.kind === "chart" && isChartData(value.data)) return value as unknown as SharePayload;
  if (value.kind === "article" && isArticleData(value.data)) return value as unknown as SharePayload;
  if (value.kind === "pane") {
    const data = parsePaneData(value.data);
    if (data) return { kind: "pane", data };
  }
  return null;
}

/**
 * The slim share page stores snapshots captured from the terminal: tables
 * carry rendered cells and charts carry panels plus series. Those are trusted
 * enough to render by their presence — title and the two arrays — since the
 * page draws only what it can address.
 */
export function parseTableSharePayload(value: unknown): TableSharePayload | null {
  if (!record(value)) return null;
  if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) return null;
  if (!shortString(value.title)) return null;
  return value as unknown as TableSharePayload;
}

export function parseChartSharePayload(value: unknown): ChartSharePayload | null {
  if (!record(value)) return null;
  if (!Array.isArray(value.series) || !Array.isArray(value.panels)) return null;
  if (!shortString(value.title)) return null;
  return value as unknown as ChartSharePayload;
}

/** Narrow an untrusted `(kind, data)` pair the slim share page renders. */
function parseShareByKind(kind: unknown, data: unknown): SharePagePayload | null {
  if (kind === "article") {
    const parsed = parseArticleSharePayload(data);
    return parsed ? { kind: "article", data: parsed } : null;
  }
  if (kind === "table") {
    const parsed = parseTableSharePayload(data);
    return parsed ? { kind: "table", data: parsed } : null;
  }
  if (kind === "chart") {
    const parsed = parseChartSharePayload(data);
    return parsed ? { kind: "chart", data: parsed } : null;
  }
  return null;
}

/**
 * Two calling conventions are live in this codebase: the terminal sharing API
 * passes the whole `{ kind, data }` envelope, while the slim share page hands
 * the pair separately. Accept both so neither drift breaks the other.
 */
export function parseSharePayload(envelope: unknown): SharePayload | null;
export function parseSharePayload(kind: unknown, data: unknown): SharePagePayload | null;
export function parseSharePayload(kindOrEnvelope: unknown, data?: unknown): SharePayload | SharePagePayload | null {
  if (record(kindOrEnvelope) && "kind" in kindOrEnvelope && "data" in kindOrEnvelope) {
    return parseShareEnvelope(kindOrEnvelope);
  }
  return parseShareByKind(kindOrEnvelope, data);
}

/**
 * A chart share predating snapshots stored only a spec, which needs the
 * market-data stack to draw; a snapshot carries rendered series instead.
 * True when the envelope holds a spec but no top-level series.
 */
export function isSpecOnlyChartShare(data: unknown): boolean {
  if (!record(data)) return false;
  return record(data.spec) && !Array.isArray(data.series);
}

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

export function parseArticleSharePayload(value: unknown): ArticleSharePayload | null {
  if (!record(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.title !== "string") return null;
  if (typeof value.url !== "string") return null;
  if (value.type !== "news" && value.type !== "substack") return null;
  return value as unknown as ArticleSharePayload;
}

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
