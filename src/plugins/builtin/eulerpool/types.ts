export const EULERPOOL_PLUGIN_ID = "eulerpool";
export const EULERPOOL_CONNECTION_ID = "eulerpool";
export const EULERPOOL_BYOK_SERVICE_ID = "eulerpool";
export const EULERPOOL_PANE_ID = "eulerpool";
export const EULERPOOL_API_BASE_URL = "https://api.eulerpool.com/api/1";
export const EULERPOOL_SITE_BASE_URL = "https://eulerpool.com";

export interface EulerpoolProfile {
  ticker: string;
  name: string;
  isin: string;
  sector: string;
  industry: string;
  country: string;
  currency: string;
  website: string;
  description: string;
  employees: number | null;
}

export interface EulerpoolIncomePeriod {
  period: Date;
  year: number;
  ticker: string;
  revenue: number | null;
  grossIncome: number | null;
  ebit: number | null;
  pretaxIncome: number | null;
  netIncome: number | null;
  dilutedEps: number | null;
  researchDevelopment: number | null;
  sgaExpense: number | null;
}

export interface EulerpoolCashFlowPeriod {
  period: Date;
  year: number;
  operating: number | null;
  investing: number | null;
  financing: number | null;
  capex: number | null;
  fcf: number | null;
}

export interface EulerpoolFundamentals {
  identifier: string;
  profile: EulerpoolProfile | null;
  income: EulerpoolIncomePeriod[];
  cashFlow: EulerpoolCashFlowPeriod[];
}
