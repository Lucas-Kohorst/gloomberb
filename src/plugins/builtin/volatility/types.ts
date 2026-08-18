export interface VolMetric {
  id: string;
  label: string;
  value: number | null;
  unit: string; // "pts", "ratio"
  sparkline: { date: Date; value: number }[];
  description: string;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export interface VolTermStructurePoint {
  tenor: string; // "Spot", "3M", "6M"
  value: number | null;
}

export interface VolData {
  vix: VolMetric;
  vxv: VolMetric;
  vxmt: VolMetric;
  vxvVixRatio: VolMetric; // VXV/VIX — >1 = contango, <1 = backwardation
  termStructure: VolTermStructurePoint[];
  updatedAt: Date | null;
}
