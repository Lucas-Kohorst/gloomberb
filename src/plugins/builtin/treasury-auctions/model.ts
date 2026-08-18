import type { DataTableColumn } from "../../../components";
import type { TreasuryAuction } from "./types";

export type SortDirection = "asc" | "desc";
export type AuctionColumnId =
  | "date"
  | "type"
  | "term"
  | "rate"
  | "btc"
  | "indirect";

export interface AuctionColumn extends DataTableColumn {
  id: AuctionColumnId;
}

export type AuctionSortPreference = {
  columnId: AuctionColumnId;
  direction: SortDirection;
};

export const DEFAULT_AUCTION_SORT: AuctionSortPreference = {
  columnId: "date",
  direction: "desc",
};

export type AuctionFilter = "all" | "bill" | "note" | "bond";

export const AUCTION_FILTERS: ReadonlyArray<{
  value: AuctionFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "bill", label: "Bills" },
  { value: "note", label: "Notes" },
  { value: "bond", label: "Bonds" },
];

const BILL_TYPES = new Set(["Bill", "CMB"]);
const NOTE_TYPES = new Set(["Note", "FRN"]);
const BOND_TYPES = new Set(["Bond", "TIPS"]);

export function matchesFilter(
  auction: TreasuryAuction,
  filter: AuctionFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "bill":
      return BILL_TYPES.has(auction.secType);
    case "note":
      return NOTE_TYPES.has(auction.secType);
    case "bond":
      return BOND_TYPES.has(auction.secType);
  }
}

export function nextFilter(current: AuctionFilter): AuctionFilter {
  const idx = AUCTION_FILTERS.findIndex((f) => f.value === current);
  const next = (idx + 1) % AUCTION_FILTERS.length;
  return AUCTION_FILTERS[next]!.value;
}

export function filterAuctions(
  auctions: TreasuryAuction[],
  filter: AuctionFilter,
): TreasuryAuction[] {
  if (filter === "all") return auctions;
  return auctions.filter((a) => matchesFilter(a, filter));
}

export function filterAuctionsByQuery(
  auctions: TreasuryAuction[],
  query: string,
): TreasuryAuction[] {
  const q = query.trim().toLowerCase();
  if (!q) return auctions;
  return auctions.filter(
    (a) =>
      a.secType.toLowerCase().includes(q) ||
      a.securityTerm.toLowerCase().includes(q) ||
      a.auctionDate.includes(q),
  );
}

function dateValue(value: string): number {
  const ts = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ts) ? ts : 0;
}

/** Convert a term label like "4-Week" / "10-Year" / "39-Day" to a day count. */
function termLengthDays(term: string): number {
  const m = term.match(/^(\d+)\s*-(Day|Week|Month|Year)/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number(m[1]);
  switch (m[2]!.toLowerCase()) {
    case "day":
      return n;
    case "week":
      return n * 7;
    case "month":
      return n * 30;
    case "year":
      return n * 365;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

export function indirectPct(auction: TreasuryAuction): number | null {
  if (
    auction.indirectAccepted == null ||
    auction.totalAccepted == null ||
    auction.totalAccepted === 0
  ) {
    return null;
  }
  return (auction.indirectAccepted / auction.totalAccepted) * 100;
}

/**
 * The headline rate for an auction: Bills and FRNs report a high investment
 * rate, while Notes and Bonds report a high yield. Prefer the investment rate
 * when present and fall back to yield.
 */
export function rateValue(auction: TreasuryAuction): number | null {
  return auction.highInvestmentRate ?? auction.highYield;
}

function compareAuctions(
  a: TreasuryAuction,
  b: TreasuryAuction,
  columnId: AuctionColumnId,
): number {
  switch (columnId) {
    case "date":
      return dateValue(a.auctionDate) - dateValue(b.auctionDate);
    case "type":
      return a.secType.localeCompare(b.secType, "en-US", {
        sensitivity: "base",
      });
    case "term": {
      const la = termLengthDays(a.securityTerm);
      const lb = termLengthDays(b.securityTerm);
      if (la !== lb) return la - lb;
      return a.securityTerm.localeCompare(b.securityTerm, "en-US");
    }
    case "rate":
      return (
        (rateValue(a) ?? -Infinity) -
        (rateValue(b) ?? -Infinity)
      );
    case "btc":
      return (
        (a.bidToCoverRatio ?? -Infinity) -
        (b.bidToCoverRatio ?? -Infinity)
      );
    case "indirect":
      return (
        (indirectPct(a) ?? -Infinity) -
        (indirectPct(b) ?? -Infinity)
      );
  }
}

export function sortedAuctions(
  auctions: TreasuryAuction[],
  sort: AuctionSortPreference,
): TreasuryAuction[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...auctions].sort((a, b) => {
    const cmp = compareAuctions(a, b, sort.columnId) * direction;
    if (cmp !== 0) return cmp;
    return dateValue(b.auctionDate) - dateValue(a.auctionDate);
  });
}

export function buildAuctionColumns(width: number): AuctionColumn[] {
  const dateWidth = 8;
  const typeWidth = 6;
  const rateWidth = 8;
  const btcWidth = 7;
  const indirectWidth = 10;
  const termWidth = Math.max(
    10,
    width - dateWidth - typeWidth - rateWidth - btcWidth - indirectWidth - 6,
  );
  return [
    { id: "date", label: "DATE", width: dateWidth, align: "left" },
    { id: "type", label: "TYPE", width: typeWidth, align: "left" },
    { id: "term", label: "TERM", width: termWidth, align: "left" },
    { id: "rate", label: "RATE", width: rateWidth, align: "right" },
    { id: "btc", label: "BTC", width: btcWidth, align: "right" },
    {
      id: "indirect",
      label: "INDIRECT%",
      width: indirectWidth,
      align: "right",
    },
  ];
}
