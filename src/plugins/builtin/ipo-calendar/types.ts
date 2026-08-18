export type IPOStatus = "upcoming" | "priced" | "trading" | "withdrawn";

export interface IPORecord {
  ticker: string;
  companyName: string;
  date: Date;
  status: IPOStatus;
  exchange: string | null;
  offerSize: number | null;
  priceRange: [number, number] | null;
  pricedPrice: number | null;
  shares: number | null;
  closePrice: number | null;
  change1D: number | null;
  secUrl: string | null;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
