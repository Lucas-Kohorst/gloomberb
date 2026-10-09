import { DEFAULT_SEC_FROM, DEFAULT_SEC_USER_AGENT } from "../../../sources/sec-edgar/identity";
import { decodeHtmlEntities } from "../../../utils/html-entities";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import type { EdgarFiling, EdgarFilingPage } from "./types";

const CURRENT_URL = "https://www.sec.gov/cgi-bin/browse-edgar";
const FETCH_TIMEOUT_MS = 15_000;
/** The current-filings feed pages 100 acceptances at a time. */
export const EDGAR_FILINGS_PAGE_SIZE = 100;

const TITLE = /^(.+?) - (.+?) \((\d+)\) \(([^)]+)\)$/;
const ET = "America/New_York";

const filingsFetch = createThrottledFetch({
  requestsPerMinute: 60,
  maxRetries: 2,
  timeoutMs: FETCH_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    "User-Agent": DEFAULT_SEC_USER_AGENT,
    From: DEFAULT_SEC_FROM,
    Accept: "application/atom+xml, application/xml, text/xml",
  },
});

const padCik = (digits: string): string => digits.replace(/\D/g, "").padStart(10, "0");

function blockTag(block: string, name: string): string {
  return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim() ?? "";
}

function summaryText(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function absoluteSecUrl(href: string): string {
  return new URL(href, "https://www.sec.gov/").toString();
}

function parseEntry(block: string): EdgarFiling | null {
  const title = decodeHtmlEntities(blockTag(block, "title")).replace(/\s+/g, " ").trim();
  const named = TITLE.exec(title);
  if (!named) return null;
  const acceptedAt = new Date(blockTag(block, "updated"));
  if (Number.isNaN(acceptedAt.getTime())) return null;
  const summary = summaryText(blockTag(block, "summary"));
  const accessionNumber = /AccNo:\s*([0-9-]+)/.exec(summary)?.[1]
    ?? /accession-number=([0-9-]+)/.exec(blockTag(block, "id"))?.[1];
  const cik = padCik(named[3] ?? "");
  const href = /<link\b[^>]*\bhref="([^"]+)"/.exec(block)?.[1];
  if (!accessionNumber || !cik || !href) return null;
  const form = /<category\b[^>]*\bterm="([^"]+)"/.exec(block)?.[1]?.trim() || named[1]!.trim();
  const role = named[4]!.trim();
  const filed = /Filed:\s*(\d{4}-\d{2}-\d{2})/.exec(summary)?.[1];
  const size = /Size:\s*(.+)/.exec(summary)?.[1]?.trim();
  return {
    id: `${accessionNumber}:${cik}:${role}`,
    accessionNumber,
    form,
    companyName: named[2]!.trim(),
    role,
    cik,
    acceptedAt,
    filedDate: filed ?? formatEtDate(acceptedAt),
    ...(size ? { size } : {}),
    items: summary.split("\n").map((line) => line.trim()).filter((line) => /^Item\b/.test(line)),
    filingUrl: absoluteSecUrl(href),
  };
}

/** One page of the current-filings feed, newest acceptance first. */
export function parseLatestFilings(xml: string, offset: number, count = EDGAR_FILINGS_PAGE_SIZE): EdgarFilingPage {
  if (!xml.includes("<feed")) throw new Error("Latest filings failed");
  const blocks = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => match[1] ?? "");
  const rows: EdgarFiling[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    const filing = parseEntry(block);
    if (!filing || seen.has(filing.id)) continue;
    seen.add(filing.id);
    rows.push(filing);
  }
  const hasMore = blocks.length >= count;
  return { rows, hasMore, nextOffset: hasMore ? offset + blocks.length : null };
}

export function buildLatestFilingsUrl({ form, offset = 0, count = EDGAR_FILINGS_PAGE_SIZE }: {
  form?: string;
  offset?: number;
  count?: number;
}): string {
  const url = new URL(CURRENT_URL);
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("owner", "include");
  url.searchParams.set("count", String(count));
  url.searchParams.set("output", "atom");
  const type = form?.trim();
  if (type) url.searchParams.set("type", type.toUpperCase());
  if (offset > 0) url.searchParams.set("start", String(offset));
  return url.toString();
}

function etParts(date: Date): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function formatEtDate(date: Date): string {
  const parts = etParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Acceptance time in Eastern Time: `07:38` today, `10-06 18:02` on another day. */
export function formatAccepted(date: Date, now: Date): string {
  const parts = etParts(date);
  const time = `${parts.hour}:${parts.minute}`;
  const today = etParts(now);
  return parts.year === today.year && parts.month === today.month && parts.day === today.day
    ? time
    : `${parts.month}-${parts.day} ${time}`;
}

/** Full acceptance time for the open filing. */
export function formatAcceptedDetail(date: Date): string {
  const parts = etParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ET`;
}

/**
 * The latest page becomes the head of the list. Rows already loaded past that
 * page stay under it. When the previous head has fallen off the page, those
 * older rows would hide everything in between, so the list starts over.
 */
export function applyLatestFilings(current: readonly EdgarFiling[], latest: readonly EdgarFiling[]): {
  rows: EdgarFiling[];
  reset: boolean;
} {
  if (latest.length === 0) {
    return current.length === 0 ? { rows: current as EdgarFiling[], reset: false } : { rows: [], reset: true };
  }
  if (current.length === 0) return { rows: latest as EdgarFiling[], reset: false };
  const latestIds = new Set(latest.map((row) => row.id));
  if (!latestIds.has(current[0]!.id)) return { rows: latest as EdgarFiling[], reset: true };
  const sameHead = latest.length <= current.length && latest.every((row, index) => row.id === current[index]?.id);
  if (sameHead) return { rows: current as EdgarFiling[], reset: false };
  const older = current.filter((row) => !latestIds.has(row.id));
  return { rows: [...latest, ...older], reset: false };
}

/** A later page, without repeating a filing the list already has. */
export function appendFilings(current: readonly EdgarFiling[], page: readonly EdgarFiling[]): EdgarFiling[] {
  if (page.length === 0) return current as EdgarFiling[];
  const seen = new Set(current.map((row) => row.id));
  const rows = current.slice();
  for (const row of page) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

export class EdgarFilingsClient {
  async latestFilings(options: { form?: string; offset?: number; signal?: AbortSignal }): Promise<EdgarFilingPage> {
    const offset = options.offset ?? 0;
    const url = buildLatestFilingsUrl({ form: options.form, offset });
    const response = await filingsFetch.fetch(url, {
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]) : undefined,
    });
    if (!response.ok) throw new Error(`Latest filings failed (${response.status})`);
    const bytes = await response.arrayBuffer();
    const charset = /charset=([^;]+)/i.exec(response.headers.get("content-type") ?? "")?.[1]?.toLowerCase() ?? "";
    const encoding = charset.includes("8859") || charset.includes("latin") ? "iso-8859-1" : "utf-8";
    return parseLatestFilings(new TextDecoder(encoding).decode(bytes), offset);
  }
}
