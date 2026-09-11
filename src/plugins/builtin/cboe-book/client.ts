import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  CBOE_BOOK_BASE_URL,
  CBOE_BOOK_CONNECTION_ID,
  CBOE_BOOK_PAGE_BASE_URL,
  DEFAULT_CBOE_MARKET,
  normalizeCboeMarket,
  type CboeBook,
  type CboeBookLevel,
  type CboeBookStats,
  type CboeBookTrade,
  type CboeMarket,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Cboe asks for at most one book poll per 5 seconds per symbol
 * ("API requests for book data should be sent not more than once per
 * 5-second period"). 12/min stays inside that budget.
 */
const cboeFetch = createThrottledFetch({
  requestsPerMinute: 12,
  maxRetries: 1,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function bookUrl(symbol: string, market: CboeMarket = DEFAULT_CBOE_MARKET): string {
  const normalizedMarket = normalizeCboeMarket(market);
  return `${CBOE_BOOK_BASE_URL}/${normalizedMarket}/book/${encodeURIComponent(normalizeSymbol(symbol))}`;
}

export function bookPageUrl(symbol: string, market: CboeMarket = DEFAULT_CBOE_MARKET): string {
  const normalizedMarket = normalizeCboeMarket(market);
  return `${CBOE_BOOK_PAGE_BASE_URL}/${encodeURIComponent(normalizeSymbol(symbol))}/?mkt=${normalizedMarket}`;
}

function bookReferer(symbol: string, market: CboeMarket): string {
  return bookPageUrl(symbol, market);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseLevel(raw: unknown): CboeBookLevel | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  // Book Viewer encodes a level as [shares, price].
  const shares = asNumber(raw[0]);
  const price = asNumber(raw[1]);
  if (shares == null || price == null) return null;
  if (!(shares >= 0) || !(price > 0)) return null;
  return { shares, price };
}

function parseLevels(raw: unknown): CboeBookLevel[] {
  if (!Array.isArray(raw)) return [];
  const levels: CboeBookLevel[] = [];
  for (const entry of raw) {
    const level = parseLevel(entry);
    if (level) levels.push(level);
  }
  return levels;
}

function parseTrade(raw: unknown): CboeBookTrade | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  // Tape encodes a print as [time, shares, price, timeMs?].
  // The second field is shares ("1") and the third is price ("315.86"):
  // price is always near the quote, shares is the small lot.
  const time = asString(raw[0]);
  const shares = asNumber(raw[1]);
  const price = asNumber(raw[2]);
  if (!time || shares == null || price == null) return null;
  if (!(shares >= 0) || !(price > 0)) return null;
  return { time, shares, price };
}

function parseTrades(raw: unknown): CboeBookTrade[] {
  if (!Array.isArray(raw)) return [];
  const trades: CboeBookTrade[] = [];
  for (const entry of raw) {
    const trade = parseTrade(entry);
    if (trade) trades.push(trade);
  }
  return trades;
}

/**
 * Parse the Book Viewer JSON envelope:
 * `{ success, reload, data: { symbol, company, asks: [[shares, price]],
 * bids: [[shares, price]], trades: [[time, shares, price]], ... } }`.
 * Asks sort ascending, bids sort descending, so the best pair always
 * brackets the spread row.
 */
export function parseCboeBook(data: unknown): CboeBook {
  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const envelope = (record.data && typeof record.data === "object" ? record.data : record) as Record<
    string,
    unknown
  >;

  const symbol = asString(envelope.symbol)?.toUpperCase() ?? "";
  const asks = parseLevels(envelope.asks).sort((a, b) => a.price - b.price);
  const bids = parseLevels(envelope.bids).sort((a, b) => b.price - a.price);
  const trades = parseTrades(envelope.trades).slice(0, 10);

  return {
    symbol,
    company: asString(envelope.company),
    prev: asNumber(envelope.prev),
    open: asNumber(envelope.open),
    high: asNumber(envelope.high),
    low: asNumber(envelope.low),
    last: asNumber(envelope.last),
    change: asNumber(envelope.change),
    volume: asNumber(envelope.volume),
    orders: asNumber(envelope.ordersOrTrades ?? envelope.orders),
    asks,
    bids,
    trades,
    timestamp: asString(envelope.timestamp),
    status: asString(envelope.status),
  };
}

export function computeBookStats(book: Pick<CboeBook, "asks" | "bids">): CboeBookStats {
  const bestBid = book.bids.length > 0 ? book.bids[0]!.price : null;
  const bestAsk = book.asks.length > 0 ? book.asks[0]!.price : null;
  if (bestBid == null || bestAsk == null) {
    return { bestBid, bestAsk, spread: null, spreadBps: null, mid: null };
  }
  const spread = bestAsk - bestBid;
  const mid = (bestAsk + bestBid) / 2;
  const spreadBps = mid > 0 ? (spread / mid) * 10_000 : null;
  return { bestBid, bestAsk, spread, spreadBps, mid };
}

function bookFetchError(status: number, symbol: string): Error {
  if (status === 403) {
    return new Error(
      `Cboe rejected the book request for ${symbol} (403). The Book Viewer endpoint requires browser headers (Referer + X-Requested-With); retry from a network that permits them.`,
    );
  }
  if (status === 404) {
    return new Error(`No Cboe book for ${symbol} (404). Check the ticker.`);
  }
  if (status === 429) {
    return new Error(`Cboe rate-limited the book request for ${symbol}. Try again shortly.`);
  }
  return new Error(`Cboe book request failed for ${symbol}: ${status}`);
}

export class CboeBookClient {
  async getBook(symbol: string, market: CboeMarket = DEFAULT_CBOE_MARKET): Promise<CboeBook> {
    const normalizedSymbol = normalizeSymbol(symbol);
    if (!normalizedSymbol) throw new Error("Enter a ticker to load the book.");
    const normalizedMarket = normalizeCboeMarket(market);
    return withConnectionRequest(CBOE_BOOK_CONNECTION_ID, "fetch", async () => {
      const url = bookUrl(normalizedSymbol, normalizedMarket);
      const response = await cboeFetch.fetch(url, {
        headers: {
          Accept: "application/json",
          // The Book Viewer JSON requires the viewer page as Referer plus an
          // XHR marker; without them Cboe answers 403. Send both so a plain
          // fetch behaves like the page's own poll.
          Referer: bookReferer(normalizedSymbol, normalizedMarket),
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "gloomberb-cboe-book",
        },
      });
      if (!response.ok) throw bookFetchError(response.status, normalizedSymbol);
      const payload = (await response.json()) as unknown;
      const book = parseCboeBook(payload);
      if (!book.symbol) book.symbol = normalizedSymbol;
      return book;
    });
  }
}
