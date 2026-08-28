export const USASPENDING_PLUGIN_ID = "usaspending";
export const USASPENDING_CONNECTION_ID = "usaspending";
export const USASPENDING_API_BASE_URL = "https://api.usaspending.gov";

export interface SpendingAward {
  id: string;
  recipientName: string;
  awardingAgency: string;
  awardAmount: number | null;
  startDate: string;
  endDate: string;
  awardType: string;
  description: string;
}

export interface SpendingPage {
  awards: SpendingAward[];
  total: number | null;
  hasNext: boolean;
}

export interface SpendingDetail {
  award: SpendingAward;
  recipientAddress: string;
  placeOfPerformance: string;
  sourceUrl: string;
}
