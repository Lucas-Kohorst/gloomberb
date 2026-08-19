import type {
  PredictionBrowseTab,
  PredictionCategoryId,
  PredictionHistoryPoint,
  PredictionMarketSummary,
} from "../../types";
import { matchesPredictionCategory } from "../../categories";
import { fetchJson, parseFloatSafe } from "../fetch";

const ADJACENT_PUBLIC_MARKETS = "https://api.adjacent.markets/api/v1/public/markets";
const ADJACENT_KALSHI_MAX_PAGES = 8;

export interface KalshiAdjacentMarketRecord {
  market_id?: string;
  ticker?: string;
  platform?: string;
  question?: string;
  description?: string;
  yes_sub_title?: string;
  link?: string;
  probability?: number;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  event_ticker?: string;
  series_ticker?: string;
  status?: string;
  category?: string;
  end_date?: string;
  open_time?: string;
  rules_primary?: string;
  rules_secondary?: string;
  settlement?: unknown;
}

interface AdjacentKalshiMarketsPage {
  data?: KalshiAdjacentMarketRecord[];
  meta?: {
    total_pages?: number;
    has_next?: boolean;
    page?: number;
  };
}

interface AdjacentKalshiPricesPage {
  data?: Array<{ timestamp?: string; price?: number }>;
}

export function isKalshiRateLimitedError(error: unknown): boolean {
  return error instanceof Error && /\(429\)|too many requests|Rate limited/i.test(error.message);
}

export function kalshiSeriesTickerFromEvent(eventTicker: string | undefined): string | undefined {
  const trimmed = eventTicker?.trim().toUpperCase();
  if (!trimmed) return undefined;
  const withoutDateSuffix = trimmed.replace(/-[0-9].*$/, "");
  return withoutDateSuffix || trimmed;
}

function centsOrShare(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

function settlementLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const names = value.flatMap((entry) => {
      if (typeof entry === "string" && entry.trim()) return [entry.trim()];
      if (entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
        const name = (entry as { name: string }).name.trim();
        return name ? [name] : [];
      }
      return [];
    });
    return names.length > 0 ? names.join(", ") : undefined;
  }
  if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") {
    const name = (value as { name: string }).name.trim();
    return name || undefined;
  }
  return undefined;
}

export function normalizeKalshiAdjacentMarket(
  record: KalshiAdjacentMarketRecord,
): PredictionMarketSummary | null {
  const ticker = (record.ticker ?? record.market_id?.replace(/^kalshi:/i, "") ?? "").trim().toUpperCase();
  if (!ticker) return null;
  const question = record.question?.trim() || ticker;
  const target = record.yes_sub_title?.trim() || record.description?.trim();
  const marketLabel = target && target.toLowerCase() !== "yes" && target.toLowerCase() !== question.toLowerCase()
    ? target
    : question;
  const yesPrice = centsOrShare(record.probability);
  const yesBid = centsOrShare(record.yes_bid);
  const yesAsk = centsOrShare(record.yes_ask);
  const noBid = centsOrShare(record.no_bid);
  const noAsk = centsOrShare(record.no_ask);
  const eventTicker = record.event_ticker?.trim().toUpperCase();
  const seriesTicker = record.series_ticker?.trim().toUpperCase()
    || kalshiSeriesTickerFromEvent(eventTicker);
  const resolutionSource = settlementLabel(record.settlement);

  return {
    key: `kalshi:${ticker}`,
    venue: "kalshi",
    marketId: ticker,
    title: question,
    marketLabel,
    eventLabel: question,
    ...(eventTicker ? { eventTicker } : {}),
    ...(seriesTicker ? { seriesTicker } : {}),
    ...(record.category?.trim() ? { category: record.category.trim() } : {}),
    tags: record.category?.trim() ? [record.category.trim()] : [],
    status: record.status === "active" ? "open" : (record.status ?? "unknown"),
    url: record.link?.trim() || `https://kalshi.com/markets/${ticker}`,
    description: [record.rules_primary, record.rules_secondary].filter(Boolean).join("\n\n"),
    endsAt: record.end_date ?? null,
    updatedAt: record.open_time ?? record.end_date ?? null,
    createdAt: record.open_time ?? null,
    yesPrice,
    noPrice: yesPrice != null ? Math.max(0, 1 - yesPrice) : null,
    yesBid: yesBid ?? null,
    yesAsk: yesAsk ?? null,
    noBid: noBid ?? null,
    noAsk: noAsk ?? null,
    spread: yesBid != null && yesAsk != null ? yesAsk - yesBid : null,
    lastTradePrice: yesPrice,
    volume24h: parseFloatSafe(record.volume_24h) ?? null,
    volume24hUnit: "usd",
    totalVolume: parseFloatSafe(record.volume) ?? null,
    totalVolumeUnit: "usd",
    openInterest: parseFloatSafe(record.open_interest) ?? null,
    openInterestUnit: "usd",
    liquidity: null,
    liquidityUnit: "usd",
    ...(resolutionSource ? { resolutionSource } : {}),
    ...(record.rules_primary ? { rulesPrimary: record.rules_primary } : {}),
    ...(record.rules_secondary ? { rulesSecondary: record.rules_secondary } : {}),
  };
}

function sortAdjacentKalshiMarkets(
  markets: PredictionMarketSummary[],
  browseTab: PredictionBrowseTab,
): PredictionMarketSummary[] {
  return [...markets].sort((left, right) => {
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

export async function loadKalshiCatalogFromAdjacent(
  searchQuery: string,
  categoryId: PredictionCategoryId,
  browseTab: PredictionBrowseTab,
): Promise<PredictionMarketSummary[]> {
  const firstUrl = `${ADJACENT_PUBLIC_MARKETS}?platform=kalshi&page=1`;
  const firstPage = await fetchJson<AdjacentKalshiMarketsPage>(firstUrl);
  const totalPages = Math.min(
    Math.max(firstPage.meta?.total_pages ?? 1, 1),
    ADJACENT_KALSHI_MAX_PAGES,
  );
  const pages = [firstPage];
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) => (
        fetchJson<AdjacentKalshiMarketsPage>(
          `${ADJACENT_PUBLIC_MARKETS}?platform=kalshi&page=${index + 2}`,
        ).catch(() => ({ data: [] }) as AdjacentKalshiMarketsPage)
      )),
    );
    pages.push(...rest);
  }

  const query = searchQuery.trim().toLowerCase();
  const deduped = new Map<string, PredictionMarketSummary>();
  for (const page of pages) {
    for (const record of page.data ?? []) {
      if (record.platform && record.platform !== "kalshi") continue;
      const summary = normalizeKalshiAdjacentMarket(record);
      if (!summary) continue;
      if (categoryId !== "all" && !matchesPredictionCategory(summary, categoryId)) continue;
      if (query) {
        const haystack = [
          summary.title,
          summary.marketLabel,
          summary.eventLabel,
          summary.marketId,
          summary.category ?? "",
        ].join(" ").toLowerCase();
        if (!haystack.includes(query)) continue;
      }
      deduped.set(summary.key, summary);
    }
  }
  return sortAdjacentKalshiMarkets([...deduped.values()], browseTab);
}

export async function loadKalshiAdjacentMarket(
  ticker: string,
): Promise<PredictionMarketSummary | null> {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return null;
  try {
    const record = await fetchJson<KalshiAdjacentMarketRecord>(
      `${ADJACENT_PUBLIC_MARKETS}/kalshi:${encodeURIComponent(normalized)}`,
    );
    return normalizeKalshiAdjacentMarket(record);
  } catch {
    return null;
  }
}

export async function loadKalshiAdjacentHistory(
  ticker: string,
): Promise<PredictionHistoryPoint[]> {
  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return [];
  try {
    const response = await fetchJson<AdjacentKalshiPricesPage>(
      `${ADJACENT_PUBLIC_MARKETS}/kalshi:${encodeURIComponent(normalized)}/prices?interval=1d`,
    );
    return (response.data ?? []).flatMap((point) => {
      const date = point.timestamp ? new Date(point.timestamp) : null;
      const close = centsOrShare(point.price);
      if (!date || !Number.isFinite(date.getTime()) || close == null) return [];
      return [{ date, close }];
    });
  } catch {
    return [];
  }
}
