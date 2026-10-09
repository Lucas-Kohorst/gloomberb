export const FAMA_FRENCH_PANE_ID = "fama-french";

export const FACTOR_MONTHS = 36;

export interface FactorMonth {
  /** `YYYYMM`. */
  month: string;
  marketMinusRf: number;
  size: number;
  value: number;
  rf: number;
}

export interface FactorReturns {
  vintage: string;
  months: FactorMonth[];
}

export const FACTOR_FIELDS = [
  { key: "month", header: "Month", align: "left", width: 9 },
  { key: "marketMinusRf", header: "Mkt − RF", align: "right", width: 10 },
  { key: "size", header: "Size", align: "right", width: 10 },
  { key: "value", header: "Value", align: "right", width: 10 },
  { key: "rf", header: "RF", align: "right", width: 9 },
] as const;

export type FactorFieldKey = (typeof FACTOR_FIELDS)[number]["key"];

export function formatFactorMonth(month: string): string {
  return `${month.slice(0, 4)}-${month.slice(4, 6)}`;
}

/** Signed percent, already in percent points. A value that rounds to zero reads 0.00%. */
export function formatFactorPercent(value: number): string {
  const rounded = Number(value.toFixed(2));
  if (rounded === 0) return "0.00%";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}
