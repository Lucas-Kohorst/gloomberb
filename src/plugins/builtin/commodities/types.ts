export const COMMODITIES_PANE_ID = "commodities";
export const COMMODITIES_PLUGIN_ID = "market-overview";

export type CommoditySector = "energy" | "metals" | "agriculture";

export interface CommodityContract {
  /** Yahoo continuous-front-month symbol. */
  symbol: string;
  /** Exchange code traders use, e.g. CL. */
  code: string;
  name: string;
  sector: CommoditySector;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
