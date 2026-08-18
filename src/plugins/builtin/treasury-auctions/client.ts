import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { TREASURY_CONNECTION_ID } from "./types";
import type { TreasuryAuction, TreasuryAuctionRaw } from "./types";

const BASE_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query";

const FIELDS = [
  "security_type",
  "security_term",
  "auction_date",
  "high_investment_rate",
  "high_yield",
  "high_price",
  "low_price",
  "avg_med_price",
  "bid_to_cover_ratio",
  "comp_accepted",
  "indirect_bidder_accepted",
  "total_accepted",
].join(",");

const PAGE_SIZE = 200;
const DEFAULT_SINCE_DAYS = 45;

const TREASURY_FETCH = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 800,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-treasury-auctions",
  },
  transport: httpFetch,
});

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the request URL. Brackets in `page[size]` are kept literal to match
 * the documented Fiscal Data API format rather than percent-encoded.
 */
function buildUrl(sinceDays: number): string {
  const params = [
    `fields=${FIELDS}`,
    `filter=auction_date:gte:${isoDateDaysAgo(sinceDays)}`,
    "sort=-auction_date",
    `page[size]=${PAGE_SIZE}`,
  ];
  return `${BASE_URL}?${params.join("&")}`;
}

function toNumber(value: string | undefined | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeAuction(raw: unknown): TreasuryAuction | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Partial<TreasuryAuctionRaw>;
  const secType = (record.security_type ?? "").trim();
  const securityTerm = (record.security_term ?? "").trim();
  const auctionDate = (record.auction_date ?? "").trim();
  if (!secType || !auctionDate) return null;
  return {
    id: `${secType}|${auctionDate}|${securityTerm}`,
    secType,
    securityTerm: securityTerm || "--",
    auctionDate,
    highInvestmentRate: toNumber(record.high_investment_rate),
    highYield: toNumber(record.high_yield),
    highPrice: toNumber(record.high_price),
    lowPrice: toNumber(record.low_price),
    avgMedPrice: toNumber(record.avg_med_price),
    bidToCoverRatio: toNumber(record.bid_to_cover_ratio),
    competitiveAccepted: toNumber(record.comp_accepted),
    indirectAccepted: toNumber(record.indirect_bidder_accepted),
    totalAccepted: toNumber(record.total_accepted),
  };
}

export function parseTreasuryAuctionsPayload(body: unknown): TreasuryAuction[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const auctions: TreasuryAuction[] = [];
  for (const raw of data) {
    const auction = normalizeAuction(raw);
    if (auction) auctions.push(auction);
  }
  return auctions;
}

export async function fetchTreasuryAuctions(
  sinceDays: number = DEFAULT_SINCE_DAYS,
): Promise<TreasuryAuction[]> {
  const url = buildUrl(sinceDays);
  return withConnectionRequest(TREASURY_CONNECTION_ID, "auctions", async () => {
    const response = await TREASURY_FETCH.fetch(url);
    if (!response.ok) {
      throw new Error(
        `Treasury Fiscal Data request failed (${response.status})`,
      );
    }
    return parseTreasuryAuctionsPayload(await response.json());
  });
}
