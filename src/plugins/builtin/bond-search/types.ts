export interface CorporateYieldEntry {
  seriesId: string; // "BAMLC0A0CM", "BAMLH0A0HYM", ...
  label: string; // "IG All-Rated", "High Yield", "BBB", "AAA"
  rating: string; // "AAA", "BBB", "HY", "IG"
  maturityRange: string; // "1-3Y", "5-10Y", "All"
  yield: number | null; // percent, e.g. 5.42
  treasuryYield: number | null; // matched Treasury yield, percent
  spreadBp: number | null; // (corporate - treasury) * 100, basis points
  updatedAt: Date | null;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export type BondTab = "yields" | "search";

export interface YieldColumn {
  id: "label" | "rating" | "maturity" | "yield" | "spread";
  label: string;
  width: number;
  align: "left" | "right";
}
