export interface DividendPayment {
  exDate: Date;
  recordDate: Date | null;
  paymentDate: Date | null;
  declarationDate: Date | null;
  amount: number;
  currency: string;
  type: "cash" | "special" | "stock" | "unknown";
}

export interface DividendMetrics {
  trailingYield: number | null;
  forwardYield: number | null;
  trailingRate: number | null;
  forwardRate: number | null;
  payoutRatio: number | null;
  growth1Y: number | null;
  growth3Y: number | null;
  paymentFrequency: "monthly" | "quarterly" | "semi-annual" | "annual" | "irregular" | null;
  exDividendDate: Date | null;
  nextPayDate: Date | null;
}
