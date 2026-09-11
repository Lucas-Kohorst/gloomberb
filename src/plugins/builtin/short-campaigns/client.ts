import { decodeHtmlEntities } from "../../../utils/html-entities";
import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  SHORT_CAMPAIGNS_CONNECTION_ID,
  SHORT_REPORT_BASE_URL,
  SHORT_REPORT_CAMPAIGNS_URL,
  type ShortCampaign,
  type ShortCampaignPage,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

const shortReportFetch = createThrottledFetch({
  requestsPerMinute: 15,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 800,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "User-Agent": "gloomberb-short-campaigns",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

export const SHORT_CAMPAIGN_DISPLAY_CAP = 100;

export const SHORT_REPORT_MARKUP_ERROR =
  "ShortReportImpact listings could not be read — the site markup may have changed.";

// ---------------------------------------------------------------------------
// Tolerant HTML table scraping.
//
// Deliberately regex-based with no DOM dependency: match on table/row/cell
// structure and header keywords, never on exact class names or ids. Column
// order is resolved per-table from its header row, with per-cell content
// sniffing as a fallback when no header is recognizable.
// ---------------------------------------------------------------------------

const TABLE_RE = /<table\b[\s\S]*?<\/table\s*>/gi;
const ROW_RE = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
const CELL_RE = /<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const LINK_RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/i;
const SCRIPT_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const TAG_RE = /<[^>]*>/g;

const SKIP_ROW_RE = /load more|show more|next|previous|page \d+|no results?|no campaigns?|nothing found/i;

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const DATE_LIKE_RES = [
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/,
  new RegExp(`\\b(?:${MONTHS})[a-z]*\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{2,4}\\b`, "i"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})[a-z]*\\s+\\d{2,4}\\b`, "i"),
  new RegExp("\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b"),
];
const TICKER_PAREN_RE = /\(([A-Z]{1,6}(?:\.[A-Z]{1,2})?)\)/;
const BARE_TICKER_RE = /^[A-Z]{1,6}(?:\.[A-Z]{1,2})?$/;

type ColumnGroup = "target" | "ticker" | "seller" | "date" | "performance";

const GROUP_PATTERNS: Record<ColumnGroup, RegExp> = {
  target: /target|compan|name|stock|security|issuer/,
  ticker: /ticker|symbol/,
  seller: /seller|short seller|author|fund|research|activist|publisher|firm|source/,
  date: /date|publish|announc|posted|time/,
  performance: /perform|return|change|since|%|price|impact|result/,
};

interface ParsedCell {
  text: string;
  href: string | null;
  linkText: string | null;
  isHeader: boolean;
}

function stripToText(html: string): string {
  const withoutScripts = html.replace(SCRIPT_STYLE_RE, " ");
  const withoutTags = withoutScripts.replace(TAG_RE, " ");
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function parseCell(tag: string, inner: string): ParsedCell {
  const link = inner.match(LINK_RE);
  return {
    text: stripToText(inner),
    href: link?.[1]?.trim() || null,
    linkText: link?.[2] != null ? stripToText(link[2]) : null,
    isHeader: tag.toLowerCase() === "th",
  };
}

function parseRows(tableHtml: string): ParsedCell[][] {
  const rows: ParsedCell[][] = [];
  for (const rowMatch of tableHtml.matchAll(ROW_RE)) {
    const cells: ParsedCell[] = [];
    for (const cellMatch of rowMatch[1]!.matchAll(CELL_RE)) {
      cells.push(parseCell(cellMatch[1]!, cellMatch[2] ?? ""));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function groupHits(text: string): Set<ColumnGroup> {
  const lowered = text.toLowerCase();
  const hits = new Set<ColumnGroup>();
  for (const [group, pattern] of Object.entries(GROUP_PATTERNS) as Array<[ColumnGroup, RegExp]>) {
    if (pattern.test(lowered)) hits.add(group);
  }
  return hits;
}

type ColumnMap = Partial<Record<ColumnGroup, number>>;

function mapColumnsFromHeader(header: ParsedCell[]): ColumnMap | null {
  const map: ColumnMap = {};
  const matchedGroups = new Set<ColumnGroup>();
  header.forEach((cell, index) => {
    for (const group of groupHits(cell.text)) {
      if (!(group in map)) {
        map[group] = index;
        matchedGroups.add(group);
      }
    }
  });
  // A header names at least two distinct concerns (e.g. target + date).
  return matchedGroups.size >= 2 ? map : null;
}

function looksLikeDate(text: string): boolean {
  if (!text || text.length > 40) return false;
  return DATE_LIKE_RES.some((re) => re.test(text));
}

/** Resolve a column map when the table has no recognizable header. */
function sniffColumns(cells: ParsedCell[]): ColumnMap {
  const map: ColumnMap = {};
  const used = new Set<number>();
  cells.forEach((cell, index) => {
    if (map.date == null && looksLikeDate(cell.text)) {
      map.date = index;
      used.add(index);
    }
  });
  cells.forEach((cell, index) => {
    if (map.performance == null && !used.has(index) && /%/.test(cell.text)) {
      map.performance = index;
      used.add(index);
    }
  });
  const textCells = cells
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell, index }) => !used.has(index) && cell.text.length > 0);
  // Prefer the linked cell as the target: listings link the company name.
  const linked = textCells.find(({ cell }) => cell.href);
  if (linked) {
    map.target = linked.index;
    used.add(linked.index);
  } else if (textCells[0]) {
    map.target = textCells[0].index;
    used.add(textCells[0].index);
  }
  const sellerCell = textCells.find(({ index }) => !used.has(index));
  if (sellerCell) map.seller = sellerCell.index;
  return map;
}

export function parseCampaignDate(raw: string): Date | null {
  const text = raw.trim();
  if (!text) return null;
  const cleaned = text.replace(/(\d+)(st|nd|rd|th)\b/gi, "$1");
  const parsed = Date.parse(cleaned);
  if (Number.isFinite(parsed)) return new Date(parsed);
  return null;
}

/**
 * Parse a performance cell such as "+12.5%", "-3.2%", "(8.1%)" or "N/A".
 * Parenthesized values are negative (accounting style). Bare numbers in a
 * performance column are read as percent. Returns null when not listed.
 */
export function parsePerformancePct(raw: string): number | null {
  const text = raw.trim();
  if (!text || /^(n\/a|na|—|-|–|pending|tbd|\.+)$/i.test(text)) return null;
  const cleaned = text.replace(/,/g, "");
  const parenthesized = /^\(.*\)$/.test(cleaned);
  const match = cleaned.match(/([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;
  let value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (parenthesized && value > 0) value = -value;
  return value;
}

function extractTicker(target: string, symbolCell: string): string | null {
  const symbol = symbolCell.trim().toUpperCase();
  if (symbol && BARE_TICKER_RE.test(symbol)) return symbol;
  const match = target.match(TICKER_PAREN_RE);
  return match?.[1] ?? null;
}

function cleanTarget(target: string): string {
  return target.replace(/\s*\([A-Z]{1,6}(?:\.[A-Z]{1,2})?\)\s*$/, "").trim() || target;
}

function resolveUrl(href: string | null, baseUrl: string): string {
  if (!href) return baseUrl;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

function parseCampaignRow(
  cells: ParsedCell[],
  map: ColumnMap,
  baseUrl: string,
): ShortCampaign | null {
  const at = (group: ColumnGroup): ParsedCell | null => {
    const index = map[group];
    return index != null && cells[index] ? cells[index]! : null;
  };
  const targetCell = at("target");
  const sellerCell = at("seller");
  const dateCell = at("date");
  const perfCell = at("performance");
  const tickerCell = at("ticker");

  const rawTarget = (targetCell?.linkText || targetCell?.text || "").trim();
  if (!rawTarget) return null;
  if (SKIP_ROW_RE.test(cells.map((cell) => cell.text).join(" "))) return null;

  const ticker = extractTicker(rawTarget, tickerCell?.text ?? "");
  const target = cleanTarget(rawTarget);
  const seller = (sellerCell?.text || "").trim() || "Unknown seller";
  const date = (dateCell && parseCampaignDate(dateCell.text)) ?? new Date(0);
  const performancePct = perfCell ? parsePerformancePct(perfCell.text) : null;
  const targetHref = targetCell?.href ?? null;
  const reportUrl =
    resolveUrl(targetHref, baseUrl) !== baseUrl
      ? resolveUrl(targetHref, baseUrl)
      : resolveUrl(cells.find((cell) => cell.href)?.href ?? null, baseUrl);
  const thesis = "";
  const datePart = date.getTime() === 0 ? "nodate" : date.toISOString().slice(0, 10);
  const id = `${seller}|${target}|${datePart}`;

  return { id, target, ticker, seller, date, performancePct, reportUrl, thesis };
}

/**
 * Parse campaign listings out of ShortReportImpact HTML. Matches on
 * table/row/cell structure and header keywords — never on class names —
 * so cosmetic redesigns keep working. Throws a clear error when no
 * campaign table can be recognized, so a markup change degrades to an
 * error state instead of a misleading empty list.
 */
export function parseShortCampaignsHtml(
  html: string,
  baseUrl: string = SHORT_REPORT_BASE_URL,
  cap: number = SHORT_CAMPAIGN_DISPLAY_CAP,
): ShortCampaignPage {
  const tables = [...html.matchAll(TABLE_RE)].map((match) => match[0]!);
  if (tables.length === 0) {
    throw new Error(SHORT_REPORT_MARKUP_ERROR);
  }

  const campaigns: ShortCampaign[] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    const rows = parseRows(table);
    if (rows.length === 0) continue;

    let headerMap: ColumnMap | null = null;
    let headerIndex = -1;
    for (let index = 0; index < Math.min(rows.length, 3); index += 1) {
      const candidate = mapColumnsFromHeader(rows[index]!);
      if (candidate) {
        headerMap = candidate;
        headerIndex = index;
        break;
      }
      if (rows[index]!.every((cell) => cell.isHeader) && rows[index]!.length >= 3) {
        headerMap = {};
        headerIndex = index;
        break;
      }
    }

    for (let index = 0; index < rows.length; index += 1) {
      if (index === headerIndex) continue;
      const cells = rows[index]!;
      const sniffed = headerMap == null;
      const map = headerMap ?? sniffColumns(cells);
      if (sniffed) {
        // Without a header the column assignment is a guess: only trust rows
        // with enough cells and at least one strongly-typed anchor (a date,
        // a percent, or a link). Otherwise an unrelated single-cell table
        // would parse as a phantom campaign instead of raising the
        // markup-changed error below.
        const nonEmpty = cells.filter((cell) => cell.text.length > 0).length;
        const anchored =
          map.date != null || map.performance != null || cells.some((cell) => cell.href);
        if (nonEmpty < 2 || !anchored) continue;
      }
      const campaign = parseCampaignRow(cells, map, baseUrl);
      if (!campaign || seen.has(campaign.id)) continue;
      seen.add(campaign.id);
      campaigns.push(campaign);
      if (campaigns.length >= cap) break;
    }
    if (campaigns.length >= cap) break;
  }

  if (campaigns.length === 0) {
    throw new Error(SHORT_REPORT_MARKUP_ERROR);
  }
  return { campaigns, total: campaigns.length };
}

export function matchesCampaignSearch(campaign: ShortCampaign, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    campaign.target.toLowerCase().includes(normalized) ||
    (campaign.ticker ?? "").toLowerCase().includes(normalized) ||
    campaign.seller.toLowerCase().includes(normalized)
  );
}

export class ShortCampaignsClient {
  /**
   * Fetch campaign listings from ShortReportImpact. `searchQuery` filters by
   * target, ticker, or seller client-side because the site has no query API.
   */
  async listCampaigns(options: {
    searchQuery?: string;
    signal?: AbortSignal;
  } = {}): Promise<ShortCampaignPage> {
    return withConnectionRequest(SHORT_CAMPAIGNS_CONNECTION_ID, "fetch", async () => {
      const response = await shortReportFetch.fetch(SHORT_REPORT_CAMPAIGNS_URL, {
        signal: options.signal,
      });
      if (!response.ok) {
        throw new Error(
          `ShortReportImpact request failed: ${response.status} ${response.statusText}`,
        );
      }
      const page = parseShortCampaignsHtml(await response.text());
      const searchQuery = options.searchQuery?.trim();
      if (!searchQuery) return page;
      const campaigns = page.campaigns.filter((campaign) =>
        matchesCampaignSearch(campaign, searchQuery),
      );
      return { ...page, campaigns };
    });
  }
}
