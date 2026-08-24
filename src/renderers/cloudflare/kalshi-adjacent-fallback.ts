/**
 * Kalshi's origin 429s/522s Cloudflare Worker egress. Catalog list requests
 * can still be answered from Adjacent's public markets API, which Workers
 * can reach and which the browser can also fetch directly (CORS *).
 */
const ADJACENT_PUBLIC_MARKETS = "https://api.adjacent.markets/api/v1/public/markets";
const ADJACENT_TIMEOUT_MS = 12_000;

export const KALSHI_ORIGIN_FAILURE_STATUSES = new Set([429, 522, 524, 530]);

interface AdjacentMarketRow {
  market_id?: string;
  ticker?: string;
  display_ticker?: string;
  question?: string;
  title?: string;
  category?: string;
  status?: string;
  probability?: number | null;
  volume_24h?: number | null;
  volume?: number | null;
  open_interest?: number | null;
  end_date?: string | null;
  event_id?: string;
  event_ticker?: string;
  event_title?: string;
  series_ticker?: string;
  subtitle?: string;
}

function stripKalshiPrefix(value: string | undefined): string {
  return (value ?? "").replace(/^kalshi:/i, "").trim();
}

function kalshiListKind(upstreamPath: string): "events" | "markets" | null {
  const path = upstreamPath.split("?")[0]?.replace(/\/$/, "") ?? "";
  if (path === "events") return "events";
  if (path === "markets") return "markets";
  return null;
}

function rowToKalshiMarket(row: AdjacentMarketRow): Record<string, unknown> | null {
  const ticker = stripKalshiPrefix(row.ticker ?? row.display_ticker ?? row.market_id);
  if (!ticker) return null;
  const probability = typeof row.probability === "number" ? row.probability / 100 : null;
  const eventTicker = stripKalshiPrefix(row.event_id) || row.event_ticker?.trim() || undefined;
  return {
    ticker,
    title: (row.question ?? row.title ?? ticker).trim(),
    yes_sub_title: row.subtitle?.trim() || undefined,
    event_ticker: eventTicker,
    status: row.status === "active" ? "open" : (row.status ?? "open"),
    market_type: "binary",
    last_price_dollars: probability != null ? String(probability) : undefined,
    volume_24h_fp: row.volume_24h != null ? String(row.volume_24h) : undefined,
    volume_fp: row.volume != null ? String(row.volume) : undefined,
    open_interest_fp: row.open_interest != null ? String(row.open_interest) : undefined,
    close_time: row.end_date ?? undefined,
  };
}

function groupKalshiEvents(markets: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const events = new Map<string, Record<string, unknown>>();
  for (const market of markets) {
    const eventTicker = typeof market.event_ticker === "string" && market.event_ticker
      ? market.event_ticker
      : String(market.ticker);
    const existing = events.get(eventTicker);
    if (existing) {
      (existing.markets as unknown[]).push(market);
      continue;
    }
    events.set(eventTicker, {
      title: typeof market.title === "string" ? market.title : eventTicker,
      category: undefined,
      event_ticker: eventTicker,
      series_ticker: eventTicker.split("-")[0],
      markets: [market],
    });
  }
  return [...events.values()];
}

export async function fetchKalshiListFromAdjacent(
  upstreamPath: string,
  search: URLSearchParams,
): Promise<Response | null> {
  const kind = kalshiListKind(upstreamPath);
  if (!kind) return null;

  const url = new URL(ADJACENT_PUBLIC_MARKETS);
  url.searchParams.set("platform", "kalshi");
  url.searchParams.set("scope", "all");
  url.searchParams.set("per_page", search.get("limit") || "50");
  const category = search.get("category");
  if (category) url.searchParams.set("category", category);
  const cursor = search.get("cursor");
  if (cursor && /^\d+$/.test(cursor)) url.searchParams.set("page", cursor);

  try {
    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "gloomberb-adjacent",
      },
      signal: AbortSignal.timeout(ADJACENT_TIMEOUT_MS),
    });
    if (!upstream.ok) return null;
    const raw = await upstream.json() as { data?: AdjacentMarketRow[]; meta?: { has_next?: boolean; page?: number } };
    const markets = (raw.data ?? [])
      .map(rowToKalshiMarket)
      .filter((row): row is Record<string, unknown> => row != null);
    const nextPage = raw.meta?.has_next ? String((raw.meta.page ?? 1) + 1) : "";
    const body = kind === "markets"
      ? { markets, cursor: nextPage }
      : { events: groupKalshiEvents(markets), cursor: nextPage };
    return Response.json(body, {
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=60",
      },
    });
  } catch {
    return null;
  }
}
