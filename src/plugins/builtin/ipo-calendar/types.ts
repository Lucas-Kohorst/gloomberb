export const IPO_CALENDAR_PANE_ID = "ipo-calendar";

export type IPOStatus = "upcoming" | "priced" | "trading";

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
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
