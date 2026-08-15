export interface AdjacentCatalogMarket {
  category?: string;
  display_ticker?: string;
  end_date?: string | null;
  is_constituent?: boolean;
  link?: string;
  market_id?: string;
  open_interest?: number | null;
  open_interest_unit?: string | null;
  platform?: string;
  probability?: number | null;
  question?: string;
  status?: string;
  ticker?: string;
  volume?: number | null;
  volume_24h?: number | null;
  volume_24h_unit?: string | null;
  volume_unit?: string | null;
}

export interface AdjacentCatalogResponse {
  data?: AdjacentCatalogMarket[];
  markets?: AdjacentCatalogMarket[];
  meta?: {
    has_next?: boolean;
    page?: number;
    per_page?: number;
    total?: number;
    total_pages?: number;
  };
  next_cursor?: string | null;
}
