import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import type { ShortInterestRecord } from "./types";

const FETCH_TIMEOUT_MS = 20_000;
const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const YAHOO_REFERER = "https://finance.yahoo.com/";

const CONNECTION_ID = "yahoo-short-interest";

interface YahooRawValue {
  raw?: number;
  fmt?: string;
}

interface YahooDefaultKeyStatistics {
  sharesShort?: YahooRawValue | number | null;
  sharesShortPriorMonth?: YahooRawValue | number | null;
  sharesShortPreviousMonthDate?: YahooRawValue | number | string | null;
  dateShortInterest?: YahooRawValue | number | string | null;
  shortRatio?: YahooRawValue | number | null;
  shortPercentOfFloat?: YahooRawValue | number | null;
  floatShares?: YahooRawValue | number | null;
}

interface YahooQuoteSummaryResult {
  defaultKeyStatistics?: YahooDefaultKeyStatistics;
}

interface YahooQuoteSummaryResponse {
  quoteSummary?: {
    result?: YahooQuoteSummaryResult[];
  } | null;
  finance?: {
    error?: { description?: string } | null;
  } | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rawNumber(value: YahooRawValue | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = value.raw;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function rawDate(value: YahooRawValue | number | string | null | undefined): Date | null {
  const raw = typeof value === "object" && value !== null ? value.raw : value;
  if (raw == null) return null;
  if (typeof raw === "number") {
    const date = new Date(raw * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof raw === "string") {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function defaultHeaders(): Record<string, string> {
  return {
    "User-Agent": YAHOO_USER_AGENT,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: YAHOO_REFERER,
  };
}

function isDomRuntime(): boolean {
  return typeof (globalThis as { document?: unknown }).document !== "undefined";
}

function yahooHeaders(): HeadersInit {
  const headers: Record<string, string> = { ...defaultHeaders() };
  if (isDomRuntime()) {
    delete headers["User-Agent"];
    delete headers.Referer;
  }
  return headers;
}

let crumbCache: { crumb: string; cookie: string } | null = null;
let crumbPromise: Promise<{ crumb: string; cookie: string }> | null = null;

async function ensureCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (crumbCache) return crumbCache;
  if (crumbPromise) return crumbPromise;

  crumbPromise = (async () => {
    try {
      const cookieResp = await httpFetch("https://fc.yahoo.com/", {
        headers: defaultHeaders(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "manual",
      });
      const setCookie = cookieResp.headers.get("set-cookie");
      if (!setCookie) throw new Error("Failed to get Yahoo cookie");
      const cookie = setCookie
        .split(",")
        .map((c) => c.split(";")[0]!.trim())
        .join("; ");

      const crumbResp = await httpFetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
        headers: { ...defaultHeaders(), Cookie: cookie },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!crumbResp.ok) throw new Error(`Failed to get Yahoo crumb: ${crumbResp.status}`);
      const crumb = await crumbResp.text();
      if (!crumb) throw new Error("Empty Yahoo crumb response");

      crumbCache = { crumb, cookie };
      return crumbCache;
    } catch (error) {
      crumbCache = null;
      throw error;
    } finally {
      crumbPromise = null;
    }
  })();

  return crumbPromise;
}

async function fetchQuoteSummary(symbol: string): Promise<YahooQuoteSummaryResult | null> {
  const { crumb, cookie } = await ensureCrumb();
  const params = new URLSearchParams({
    modules: "defaultKeyStatistics",
    crumb,
  });
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${params}`;
  const resp = await httpFetch(url, {
    headers: { ...yahooHeaders(), Cookie: cookie },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (resp.status === 401) {
    crumbCache = null;
    throw new Error("Yahoo crumb expired — retry");
  }
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Yahoo Finance request failed (${resp.status}): ${body.slice(0, 120)}`);
  }

  let parsed: unknown;
  try {
    parsed = await resp.json();
  } catch {
    const body = await resp.text();
    throw new Error(`Yahoo Finance returned non-JSON: ${body.slice(0, 120)}`);
  }

  if (!isObject(parsed)) {
    throw new Error("Yahoo Finance response was not an object");
  }

  const data = parsed as YahooQuoteSummaryResponse;
  const errorDesc = data.finance?.error?.description;
  if (errorDesc) {
    throw new Error(`Yahoo Finance error: ${errorDesc}`);
  }

  const result = data.quoteSummary?.result?.[0];
  if (!result) {
    throw new Error(`No short interest data for ${symbol}`);
  }

  return result;
}

function normalizeRecords(result: YahooQuoteSummaryResult): ShortInterestRecord[] {
  const stats = result.defaultKeyStatistics;
  if (!stats) return [];

  const records: ShortInterestRecord[] = [];

  const currentDate = rawDate(stats.dateShortInterest);
  const currentShares = rawNumber(stats.sharesShort);
  const shortRatio = rawNumber(stats.shortRatio);
  const shortPercentFloat = rawNumber(stats.shortPercentOfFloat);
  const floatShares = rawNumber(stats.floatShares);

  if (currentDate && currentShares != null) {
    records.push({
      settlementDate: currentDate,
      sharesShort: currentShares,
      shortRatio,
      averageDailyVolume: shortRatio != null && shortRatio > 0
        ? Math.round(currentShares / shortRatio)
        : null,
      shortPercentFloat: shortPercentFloat != null
        ? shortPercentFloat * 100
        : floatShares != null && floatShares > 0
          ? (currentShares / floatShares) * 100
          : null,
    });
  }

  const priorDate = rawDate(stats.sharesShortPreviousMonthDate);
  const priorShares = rawNumber(stats.sharesShortPriorMonth);

  if (priorDate && priorShares != null) {
    records.push({
      settlementDate: priorDate,
      sharesShort: priorShares,
      shortRatio: null,
      averageDailyVolume: null,
      shortPercentFloat: floatShares != null && floatShares > 0
        ? (priorShares / floatShares) * 100
        : null,
    });
  }

  return records.sort((a, b) => a.settlementDate.getTime() - b.settlementDate.getTime());
}

export async function fetchShortInterest(symbol: string): Promise<ShortInterestRecord[]> {
  return withConnectionRequest(CONNECTION_ID, "fetch-short-interest", async () => {
    const result = await fetchQuoteSummary(symbol);
    if (!result) return [];
    return normalizeRecords(result);
  });
}

export function resetShortInterestCrumbCache(): void {
  crumbCache = null;
}
