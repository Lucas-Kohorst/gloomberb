import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { computeStatus, haltCodeDescription } from "./model";
import type { MarketHalt } from "./types";

const HALTS_FEED_URL = "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts";
const HALTS_CONNECTION_ID = "nasdaq-trader-halts";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function isDomRuntime(): boolean {
  return typeof (globalThis as { document?: unknown }).document !== "undefined";
}

function haltsFetchHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/rss+xml,application/xml,text/xml,*/*",
  };

  if (!isDomRuntime()) {
    headers["User-Agent"] = USER_AGENT;
  }

  return headers;
}

function getTagContent(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1]!.trim() : null;
}

function getTagValue(xml: string, tag: string): string | null {
  // Slash is required so <ndaq:IssueSymbol> is not treated as empty.
  const selfClosing = xml.match(new RegExp(`<${tag}\\s*/>`, "i"));
  if (selfClosing) return null;

  const content = getTagContent(xml, tag);
  return content;
}

function parseNasdaqDate(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  // dateStr: "08/18/2026", timeStr: "13:25:32.636" or "13:25:32"
  const [month, day, year] = dateStr.split("/").map(Number);
  if (!month || !day || !year) return null;
  const timeParts = timeStr.split(":").map(Number);
  const hours = timeParts[0] ?? 0;
  const minutes = timeParts[1] ?? 0;
  const seconds = timeParts[2] ?? 0;
  // Nasdaq times are Eastern Time. We store as UTC-4 (EDT) approximation.
  // The Date is constructed in local time; we shift to approximate ET.
  const utcApprox = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  // Shift from UTC to ET (UTC-4 during EDT, UTC-5 during EST)
  // Use a fixed -4 offset as approximation (EDT is in effect during market hours)
  utcApprox.setUTCHours(utcApprox.getUTCHours() + 4);
  return utcApprox;
}

export function parseHaltsXml(xml: string): MarketHalt[] {
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  const halts: MarketHalt[] = [];
  let match: RegExpExecArray | null;

  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1]!;

    const ticker = getTagValue(block, "ndaq:IssueSymbol");
    if (!ticker) continue;

    const name = getTagValue(block, "ndaq:IssueName");
    const exchange = getTagValue(block, "ndaq:Market") ?? "";
    const haltCode = getTagValue(block, "ndaq:ReasonCode") ?? "";
    const haltDate = getTagValue(block, "ndaq:HaltDate");
    const haltTimeStr = getTagValue(block, "ndaq:HaltTime");
    const resumeDate = getTagValue(block, "ndaq:ResumptionDate");
    const resumeQuoteTimeStr = getTagValue(block, "ndaq:ResumptionQuoteTime");
    const resumeTradeTimeStr = getTagValue(block, "ndaq:ResumptionTradeTime");

    const haltTime = haltDate && haltTimeStr
      ? parseNasdaqDate(haltDate, haltTimeStr)
      : null;
    if (!haltTime) continue;

    const quoteResumeTime = resumeDate && resumeQuoteTimeStr
      ? parseNasdaqDate(resumeDate, resumeQuoteTimeStr)
      : null;
    const resumeTime = resumeDate && resumeTradeTimeStr
      ? parseNasdaqDate(resumeDate, resumeTradeTimeStr)
      : null;

    const halt: MarketHalt = {
      ticker,
      exchange,
      name,
      haltCode,
      haltCodeDesc: haltCodeDescription(haltCode),
      haltTime,
      quoteResumeTime,
      resumeTime,
      status: computeStatus({ quoteResumeTime, resumeTime }),
    };

    halts.push(halt);
  }

  return halts;
}

export async function fetchMarketHalts(options: {
  forceRefresh?: boolean;
} = {}): Promise<MarketHalt[]> {
  return withConnectionRequest(
    HALTS_CONNECTION_ID,
    "fetch-halts",
    async () => {
      const response = await httpFetch(HALTS_FEED_URL, {
        headers: haltsFetchHeaders(),
        cache: options.forceRefresh ? "no-store" : "default",
      });

      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Nasdaq Trader halts request failed (${response.status}): ${body.slice(0, 120)}`);
      }

      const halts = parseHaltsXml(body);
      if (halts.length === 0) {
        // Could be no halts today or a parse failure; check if we got items
        const hasItems = /<item>/i.test(body);
        if (!hasItems) return [];
        // Items exist but none parsed — return empty (feed may have only non-halt items)
      }

      return halts;
    },
  );
}
