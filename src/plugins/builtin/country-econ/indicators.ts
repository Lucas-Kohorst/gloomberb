import type { CountryEconIndicator } from "./types";

export const COUNTRY_ECON_INDICATORS: CountryEconIndicator[] = [
  { id: "gdp", label: "GDP", unit: "current US$", wbCode: "NY.GDP.MKTP.CD" },
  { id: "growth", label: "GDP growth", unit: "%", wbCode: "NY.GDP.MKTP.KD.ZG" },
  { id: "cpi", label: "Inflation (CPI)", unit: "%", wbCode: "FP.CPI.TOTL.ZG" },
  { id: "unemp", label: "Unemployment", unit: "%", wbCode: "SL.UEM.TOTL.ZS" },
  { id: "pop", label: "Population", unit: "people", wbCode: "SP.POP.TOTL" },
];

/** World Bank aggregates treated as regions rather than countries. */
export const WORLD_BANK_REGION_CODES = new Set([
  "WLD", "EUU", "EMU", "EAS", "ECS", "LCN", "MEA", "NAC", "SAS", "SSF",
  "HIC", "LIC", "LMC", "UMC", "OED", "PSS", "CSS", "TEA", "TEC", "TLA",
  "TMN", "TSA", "TSS", "CEB", "EAR", "ECA", "IBD", "IBT", "IDB", "IDX",
  "LAC", "LDC", "LMY", "MIC", "MNA", "PRE", "SST", "AFE", "AFW",
]);

export const DEFAULT_INDICATOR_ID = "gdp";
