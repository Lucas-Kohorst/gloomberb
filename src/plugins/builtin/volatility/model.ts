import type { CloudFredObservationPayload } from "../../../api-client";
import type {
  VolData,
  VolMetric,
  VolTermStructurePoint,
} from "./types";

const SPARKLINE_POINTS = 30;

/** Parse a FRED observation date string ("2024-01-15") into a Date. */
function parseObsDate(dateStr: string): Date | null {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Extract numeric values from observations, filtering nulls (FRED uses "." for missing). */
function numericObservations(
  observations: CloudFredObservationPayload[],
): { date: Date; value: number }[] {
  const out: { date: Date; value: number }[] = [];
  for (const obs of observations) {
    if (obs.value == null || !Number.isFinite(obs.value)) continue;
    const date = parseObsDate(obs.date);
    if (!date) continue;
    out.push({ date, value: obs.value });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Latest numeric value from observations, or null. */
function latestValue(observations: CloudFredObservationPayload[]): number | null {
  const numeric = numericObservations(observations);
  return numeric.length > 0 ? numeric[numeric.length - 1]!.value : null;
}

/** Latest observation date, or null. */
function latestDate(observations: CloudFredObservationPayload[]): Date | null {
  const numeric = numericObservations(observations);
  return numeric.length > 0 ? numeric[numeric.length - 1]!.date : null;
}

/** Last N observations as sparkline data. */
function sparkline(observations: CloudFredObservationPayload[], count = SPARKLINE_POINTS): { date: Date; value: number }[] {
  const numeric = numericObservations(observations);
  return numeric.slice(-count);
}

function buildMetric(
  id: string,
  label: string,
  unit: string,
  description: string,
  observations: CloudFredObservationPayload[],
): VolMetric {
  return {
    id,
    label,
    value: latestValue(observations),
    unit,
    sparkline: sparkline(observations),
    description,
  };
}

/**
 * Classify the VXV/VIX ratio: >1 means the 3-month implied vol is higher than
 * spot — a contango (calm) term structure. <1 means backwardation (stress).
 */
export type TermStructureRegime = "contango" | "backwardation" | "neutral";

export function classifyTermStructure(ratio: number | null): TermStructureRegime {
  if (ratio == null) return "neutral";
  if (ratio > 1.0) return "contango";
  if (ratio < 1.0) return "backwardation";
  return "neutral";
}

/**
 * Build the complete VolData view from raw FRED observation arrays for VIX,
 * VXV, and VXMT.  Any series may be empty (e.g. VXMTCLS has limited history);
 * the model degrades gracefully by showing null values.
 */
export function buildVolData(
  vixObs: CloudFredObservationPayload[],
  vxvObs: CloudFredObservationPayload[],
  vxmtObs: CloudFredObservationPayload[],
): VolData {
  const vix = buildMetric("vix", "VIX", "pts", "CBOE Volatility Index — 30-day implied volatility", vixObs);
  const vxv = buildMetric("vxv", "VXV", "pts", "3-month VIX — implied volatility over 3 months", vxvObs);
  const vxmt = buildMetric("vxmt", "VXMT", "pts", "6-month VIX — implied volatility over 6 months", vxmtObs);

  const vixVal = vix.value;
  const vxvVal = vxv.value;
  const ratio = vixVal != null && vxvVal != null && vixVal !== 0 ? vxvVal / vixVal : null;

  // Build a ratio sparkline by aligning VIX and VXV by date
  const vixByDate = new Map<string, number>();
  for (const pt of vix.sparkline) {
    vixByDate.set(pt.date.toISOString().slice(0, 10), pt.value);
  }
  const ratioSparkline: { date: Date; value: number }[] = [];
  for (const pt of vxv.sparkline) {
    const v = vixByDate.get(pt.date.toISOString().slice(0, 10));
    if (v != null && v !== 0) {
      ratioSparkline.push({ date: pt.date, value: pt.value / v });
    }
  }

  const vxvVixRatio: VolMetric = {
    id: "vxv-vix-ratio",
    label: "VXV/VIX",
    value: ratio,
    unit: "ratio",
    sparkline: ratioSparkline,
    description: "Term-structure signal: >1 contango (calm), <1 backwardation (stress)",
  };

  const termStructure: VolTermStructurePoint[] = [
    { tenor: "Spot", value: vix.value },
    { tenor: "3M", value: vxv.value },
    { tenor: "6M", value: vxmt.value },
  ];

  const allDates = [latestDate(vixObs), latestDate(vxvObs), latestDate(vxmtObs)].filter(
    (d): d is Date => d != null,
  );
  const updatedAt = allDates.length > 0
    ? new Date(Math.max(...allDates.map((d) => d.getTime())))
    : null;

  return { vix, vxv, vxmt, vxvVixRatio, termStructure, updatedAt };
}
