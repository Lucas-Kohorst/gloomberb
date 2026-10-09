import type { DataTableColumn } from "../../../components";

export const NORDIC_RATES_PANE_ID = "nordic-rates";

export type NordicRatesTab = "mortgage" | "bond";

export interface NordicMortgageRate {
  id: string;
  lender: string;
  term: string;
  /** Quoted rate in percent, as published. */
  rate: number;
}

export interface NordicBondYield {
  id: string;
  segment: string;
  maturity: string;
  /** Effective yield in percent, as published. */
  yield: number;
}

export type MortgageColumnId = "lender" | "term" | "rate";
export type BondColumnId = "segment" | "maturity" | "yield";
export type MortgageColumn = DataTableColumn & { id: MortgageColumnId };
export type BondColumn = DataTableColumn & { id: BondColumnId };

/** Issuer segments the Danish yield grid publishes untranslated. */
const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  "Alm & Særl. realkredit": "Ordinary & special mortgage credit",
  "Enhedsprioritet": "Unit priority mortgage",
  "Stat, fiskeri & Færøerne": "Government, fisheries & Faroe Islands",
  "Særlige institutter": "Special institutions",
};

export function segmentLabel(name: string): string {
  const text = name.trim().replace(/:$/, "");
  return SEGMENT_LABELS[text] ?? text;
}

export function formatRate(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const text = value.toFixed(2);
  return text === "-0.00" ? "0.00" : text;
}

export const MORTGAGE_COLUMNS: readonly MortgageColumn[] = [
  { id: "lender", label: "LENDER", width: 24, align: "left", flexGrow: 1 },
  { id: "term", label: "TERM", width: 6, align: "left" },
  { id: "rate", label: "RATE %", width: 8, align: "right" },
];

export const BOND_COLUMNS: readonly BondColumn[] = [
  { id: "segment", label: "SEGMENT", width: 28, align: "left", flexGrow: 1 },
  { id: "maturity", label: "MATURITY", width: 10, align: "left" },
  { id: "yield", label: "YIELD %", width: 8, align: "right" },
];
