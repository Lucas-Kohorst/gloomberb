export const TREASURY_AUCTIONS_PLUGIN_ID = "treasury-auctions";
export const TREASURY_AUCTIONS_PANE_ID = "treasury-auctions";

export const TREASURY_CONNECTION_ID = "treasury-fiscal-data";

/**
 * Normalized Treasury auction record. The Fiscal Data API returns every field
 * as a string (including the literal `"null"`); numeric fields are parsed here
 * so the rest of the pane can work with real numbers.
 */
export interface TreasuryAuction {
  /** security_type | auction_date | security_term */
  id: string;
  /** "Bill", "Note", "Bond", "CMB", "FRN", "TIPS", ... */
  secType: string;
  /** "4-Week", "2-Year", "10-Year", "29-Year 6-Month", ... */
  securityTerm: string;
  /** ISO date string "YYYY-MM-DD" */
  auctionDate: string;
  /** High investment rate — set for Bills and FRNs. */
  highInvestmentRate: number | null;
  /** High yield — set for Notes and Bonds. */
  highYield: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  /** Average/Median price. */
  avgMedPrice: number | null;
  bidToCoverRatio: number | null;
  /** Competitive accepted dollar amount. */
  competitiveAccepted: number | null;
  /** Indirect bidder accepted dollar amount (foreign central banks etc.). */
  indirectAccepted: number | null;
  totalAccepted: number | null;
}

/** Raw shape returned by the Treasury Fiscal Data auctions_query endpoint. */
export interface TreasuryAuctionRaw {
  security_type: string;
  security_term: string;
  auction_date: string;
  high_investment_rate?: string;
  high_yield?: string;
  high_price?: string;
  low_price?: string;
  avg_med_price?: string;
  bid_to_cover_ratio?: string;
  comp_accepted?: string;
  indirect_bidder_accepted?: string;
  total_accepted?: string;
}

export interface TreasuryAuctionsResponse {
  data: TreasuryAuctionRaw[];
  meta?: {
    count?: number;
    "total-count"?: number;
  };
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
