export type HaltStatus = "active" | "quote_resumed" | "resumed";

export interface MarketHalt {
  ticker: string;
  exchange: string;
  name: string | null;
  haltCode: string;
  haltCodeDesc: string;
  haltTime: Date;
  quoteResumeTime: Date | null;
  resumeTime: Date | null;
  status: HaltStatus;
}

export type HaltFilter = "all" | "active" | "resumed";

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
