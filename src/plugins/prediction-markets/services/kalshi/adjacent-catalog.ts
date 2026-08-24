import { adjacentCloudDataAliasUrl } from "../../../builtin/connections/adjacent-cloud";
import { getKalshiCategoryNames, matchesPredictionCategory } from "../../categories";
import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionMarketSummary,
} from "../../types";
import {
  fetchJson,
  isHostedOriginFailureError,
  parseFloatSafe,
} from "../fetch";

const ADJACENT_MARKETS_PER_PAGE = 50;
const ADJACENT_PUBLIC_ORIGIN = "https://api.adjacent.markets/api/v1";
const ADJACENT_PUBLIC_PREFIXES = new Set(["markets", "indices", "rates", "events"]);

export interface AdjacentKalshiCatalogRow {
  market_id?: string;
  id?: string;
  ticker?: string;
  display_ticker?: string;
  platform?: string;
  question?: string;
  title?: string;
  subtitle?: string;
  category?: string;
  tags?: string[];
  status?: string;
  probability?: number | null;
  yes_price?: number | null;
  latest_price?: number | null;
  volume_24h?: number | null;
  volume?: number | null;
  open_interest?: number | null;
  end_date?: string | null;
  ends_at?: string | null;
  link?: string;
  url?: string;
  event_id?: string;
  event_ticker?: string;
  event_title?: string;
  series_ticker?: string;
  description?: string;
  created_at?: string | null;
  updated_at?: string | null;
  yes_bid?: number | null;
  yes_ask?: number | null;
  no_bid?: number | null;
  no_ask?: number | null;
  last_trade_price?: number | null;
  rules_primary?: string | null;
  rules_secondary?: string | null;
}

export interface AdjacentKalshiCatalogPage {
  markets: PredictionMarketSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

function hostedOrigin(): string {
  return typeof location !== "undefined" && location.origin
    ? location.origin
    : "https://terminal.kohor.st";
}

/**
 * Sticky once the Worker path has failed for this session.
 *
 * `/api/data/adjacent` is matched by filter lists and some zone WAF rules.
 * `/api/feed/mkt` is the same Adjacent provider without those tokens. A 522
 * on either is Cloudflare failing to reach Adjacent from the Worker; the
 * browser can still fetch Adjacent's CORS-open public origin directly.
 */
type HostedAdjacentPathMode = "feed" | "public-origin";
let hostedAdjacentPathMode: HostedAdjacentPathMode = "feed";

function applySearch(
  url: URL,
  search?: Record<string, string | number | undefined>,
): URL {
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value == null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

function publicAdjacentOriginPath(keyPath: string): string {
  const trimmed = keyPath.replace(/^\//, "");
  const head = trimmed.split("/")[0] ?? "";
  if (trimmed.startsWith("public/") || !ADJACENT_PUBLIC_PREFIXES.has(head)) {
    return trimmed;
  }
  return `public/${trimmed}`;
}

/** Browser-direct Adjacent public URL. Bypasses the Worker 522/429 path. */
export function hostedAdjacentPublicOriginUrl(
  keyPath: string,
  search?: Record<string, string | number | undefined>,
): string {
  return applySearch(
    new URL(`${ADJACENT_PUBLIC_ORIGIN}/${publicAdjacentOriginPath(keyPath)}`),
    search,
  ).toString();
}

/** Absolute same-origin URL for an Adjacent keyed-data path on the hosted Worker. */
export function hostedAdjacentUrl(
  keyPath: string,
  search?: Record<string, string | number | undefined>,
): string {
  const path = hostedAdjacentPathMode === "public-origin"
    ? hostedAdjacentPublicOriginUrl(keyPath, search)
    : adjacentCloudDataAliasUrl(keyPath);
  if (path.startsWith("http")) {
    return applySearch(new URL(path), search).toString();
  }
  return applySearch(new URL(path, hostedOrigin()), search).toString();
}

function hostedAdjacentCandidateUrls(
  keyPath: string,
  search?: Record<string, string | number | undefined>,
): string[] {
  const feed = applySearch(
    new URL(adjacentCloudDataAliasUrl(keyPath), hostedOrigin()),
    search,
  ).toString();
  const publicOrigin = hostedAdjacentPublicOriginUrl(keyPath, search);
  if (hostedAdjacentPathMode === "public-origin") return [publicOrigin, feed];
  return [feed, publicOrigin];
}

/**
 * Fetches an Adjacent keyed-data path. Defaults to the blocker-safe Worker
 * route (`/api/feed/mkt`). On 522 / 5xx / timeout / content-block, falls
 * through to Adjacent's public origin for the rest of the session.
 */
export async function fetchHostedAdjacentJson<T>(
  keyPath: string,
  search?: Record<string, string | number | undefined>,
): Promise<T> {
  const urls = hostedAdjacentCandidateUrls(keyPath, search);
  let lastError: unknown;
  for (const [index, url] of urls.entries()) {
    try {
      const result = await fetchJson<T>(url);
      hostedAdjacentPathMode = url.includes(ADJACENT_PUBLIC_ORIGIN)
        ? "public-origin"
        : "feed";
      return result;
    } catch (error) {
      lastError = error;
      const canFallback = index < urls.length - 1
        && isHostedOriginFailureError(error);
      if (!canFallback) throw error;
    }
  }
  throw lastError;
}

/** Test helper: forget an observed Worker-path failure. */
export function resetHostedAdjacentPathFallback(): void {
  hostedAdjacentPathMode = "feed";
}

/** Adjacent addresses venue markets and events as `{platform}:{ticker}`. */
export function adjacentKalshiId(ticker: string): string {
  return /^kalshi:/i.test(ticker) ? ticker : `kalshi:${ticker}`;
}

function centsToYesPrice(value: unknown): number | null {
  const parsed = parseFloatSafe(value);
  if (parsed == null) return null;
  return parsed / 100;
}

function finiteOrNull(value: unknown): number | null {
  const parsed = parseFloatSafe(value);
  return parsed;
}

export function kalshiTickerFromAdjacentId(
  marketId: string | undefined,
  ticker?: string,
): string | null {
  const raw = ticker?.trim() || marketId?.trim() || "";
  if (!raw) return null;
  const stripped = raw.replace(/^kalshi:/i, "").trim();
  return stripped.length > 0 ? stripped : null;
}

export function kalshiEventTickerFromAdjacent(
  row: AdjacentKalshiCatalogRow,
  ticker: string,
): string | undefined {
  const fromEventId = row.event_id?.replace(/^kalshi:/i, "").trim();
  if (fromEventId) return fromEventId;
  const fromField = row.event_ticker?.trim();
  if (fromField) return fromField;
  const lastHyphen = ticker.lastIndexOf("-");
  if (lastHyphen <= 0) return undefined;
  // Outcome contracts look like EVENT-TICKER-OUTCOME (at least two hyphens).
  if (!ticker.slice(0, lastHyphen).includes("-")) return undefined;
  return ticker.slice(0, lastHyphen);
}

function adjacentSortParams(
  searchQuery: string,
  browseTab: PredictionBrowseTab,
): { sort?: string; sortDir?: string } {
  if (searchQuery) return {};
  if (browseTab === "ending") return { sort: "expiration", sortDir: "asc" };
  if (browseTab === "new") return { sort: "created", sortDir: "desc" };
  return { sort: "volume", sortDir: "desc" };
}

interface AdjacentKalshiMarketsQuery {
  searchQuery?: string;
  category?: string;
  browseTab?: PredictionBrowseTab;
  page?: number;
}

function adjacentKalshiMarketsSearch(
  options: AdjacentKalshiMarketsQuery,
): Record<string, string | number | undefined> {
  const searchQuery = options.searchQuery?.trim() ?? "";
  const { sort, sortDir } = adjacentSortParams(
    searchQuery,
    options.browseTab ?? "top",
  );
  return {
    platform: "kalshi",
    scope: "all",
    per_page: ADJACENT_MARKETS_PER_PAGE,
    page: options.page ?? 1,
    search: searchQuery,
    category: options.category,
    sort,
    sort_dir: sortDir,
  };
}

export function buildHostedAdjacentKalshiMarketsUrl(
  options: AdjacentKalshiMarketsQuery,
): string {
  return hostedAdjacentUrl("markets", adjacentKalshiMarketsSearch(options));
}

export function hostedAdjacentKalshiPageCursor(page: number): string {
  return `page:${page}`;
}

export function parseHostedAdjacentKalshiPageCursor(
  cursor: string | null | undefined,
): number {
  if (!cursor) return 1;
  const prefixed = cursor.match(/^page:(\d+)$/i);
  if (prefixed) return Number(prefixed[1]);
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function unwrapAdjacentCatalogRows(raw: unknown): AdjacentKalshiCatalogRow[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as Record<string, unknown>;
  const rows = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.markets)
      ? record.markets
      : [];
  return rows.filter(
    (row): row is AdjacentKalshiCatalogRow =>
      !!row && typeof row === "object" && !Array.isArray(row),
  );
}

function adjacentCatalogHasMore(raw: unknown, page: number): boolean {
  if (!raw || typeof raw !== "object") return false;
  const record = raw as Record<string, unknown>;
  if (typeof record.next_cursor === "string" && record.next_cursor.trim()) {
    return true;
  }
  const meta = record.meta;
  if (!meta || typeof meta !== "object") return false;
  const info = meta as Record<string, unknown>;
  if (info.has_next === true) return true;
  if (typeof info.total_pages === "number" && page < info.total_pages) {
    return true;
  }
  return false;
}

export function mapAdjacentKalshiMarket(
  row: AdjacentKalshiCatalogRow,
): PredictionMarketSummary | null {
  const platform = row.platform?.trim().toLowerCase();
  if (platform && platform !== "kalshi") return null;
  const ticker = kalshiTickerFromAdjacentId(
    row.market_id ?? row.id,
    row.ticker ?? row.display_ticker,
  );
  if (!ticker) return null;

  const yesPrice = centsToYesPrice(
    row.probability ?? row.yes_price ?? row.latest_price,
  );
  const yesBid = centsToYesPrice(row.yes_bid);
  const yesAsk = centsToYesPrice(row.yes_ask);
  const noBid = centsToYesPrice(row.no_bid);
  const noAsk = centsToYesPrice(row.no_ask);
  const lastTradePrice = centsToYesPrice(row.last_trade_price) ?? yesPrice;
  const noPrice = yesPrice != null ? Math.max(0, 1 - yesPrice) : null;
  const eventTicker = kalshiEventTickerFromAdjacent(row, ticker);
  const title = (row.question ?? row.title ?? ticker).trim();
  const outcomeLabel = eventTicker && ticker.startsWith(`${eventTicker}-`)
    ? ticker.slice(eventTicker.length + 1)
    : "";
  const marketLabel = outcomeLabel || row.subtitle?.trim() || title;
  const eventLabel = (row.event_title ?? title).trim();
  const category = row.category?.trim();
  const status = row.status === "active" ? "open" : (row.status ?? "unknown");
  const volume24h = finiteOrNull(row.volume_24h);
  const totalVolume = finiteOrNull(row.volume);
  const openInterest = finiteOrNull(row.open_interest);
  const seriesTicker = row.series_ticker?.trim()
    || ticker.split("-")[0]
    || undefined;

  return {
    key: `kalshi:${ticker}`,
    venue: "kalshi",
    marketId: ticker,
    title,
    marketLabel,
    eventLabel,
    eventTicker,
    seriesTicker,
    category,
    tags: category
      ? [...new Set([category, ...(row.tags ?? [])])]
      : (row.tags ?? []),
    status,
    url: row.link?.trim()
      || row.url?.trim()
      || `https://kalshi.com/markets/${ticker}`,
    description: row.description?.trim() ?? "",
    rulesPrimary: row.rules_primary?.trim() || undefined,
    rulesSecondary: row.rules_secondary?.trim() || undefined,
    endsAt: row.end_date ?? row.ends_at ?? null,
    updatedAt: row.updated_at ?? null,
    createdAt: row.created_at ?? null,
    yesPrice,
    noPrice,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    spread: yesBid != null && yesAsk != null ? yesAsk - yesBid : null,
    lastTradePrice,
    volume24h,
    volume24hUnit: "usd",
    totalVolume,
    totalVolumeUnit: "usd",
    openInterest,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
  };
}

export function mapAdjacentKalshiCatalog(
  rows: AdjacentKalshiCatalogRow[],
  categoryId: PredictionCategoryId = "all",
  browseTab: PredictionBrowseTab = "top",
): PredictionMarketSummary[] {
  const deduped = new Map<string, PredictionMarketSummary>();
  for (const row of rows) {
    const mapped = mapAdjacentKalshiMarket(row);
    if (!mapped) continue;
    if (
      categoryId !== "all"
      && !matchesPredictionCategory(mapped, categoryId)
    ) {
      continue;
    }
    deduped.set(mapped.key, mapped);
  }

  return [...deduped.values()].sort((left, right) => {
    if (browseTab === "ending") {
      const leftEnds = left.endsAt ? new Date(left.endsAt).getTime() : Infinity;
      const rightEnds = right.endsAt ? new Date(right.endsAt).getTime() : Infinity;
      return leftEnds - rightEnds;
    }
    if (browseTab === "new") {
      const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return rightCreated - leftCreated;
    }
    return (right.volume24h ?? 0) - (left.volume24h ?? 0);
  });
}

export async function fetchHostedAdjacentKalshiCatalogPage(options: {
  searchQuery?: string;
  categoryId?: PredictionCategoryId;
  browseTab?: PredictionBrowseTab;
  page?: number;
}): Promise<AdjacentKalshiCatalogPage> {
  const searchQuery = options.searchQuery?.trim() ?? "";
  const categoryId = options.categoryId ?? "all";
  const browseTab = options.browseTab ?? "top";
  const page = options.page ?? 1;
  const category = getKalshiCategoryNames(categoryId)[0];
  const raw = await fetchHostedAdjacentJson<unknown>(
    "markets",
    adjacentKalshiMarketsSearch({ searchQuery, category, browseTab, page }),
  );
  const markets = mapAdjacentKalshiCatalog(
    unwrapAdjacentCatalogRows(raw),
    categoryId,
    browseTab,
  );
  const hasMore = adjacentCatalogHasMore(raw, page);
  return {
    markets,
    nextCursor: hasMore ? hostedAdjacentKalshiPageCursor(page + 1) : null,
    hasMore,
  };
}
