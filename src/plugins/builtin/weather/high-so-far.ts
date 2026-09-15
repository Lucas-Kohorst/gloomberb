import {
  inSettlementWindow,
  observationMs,
  settlementWindow,
  type DayWindowKind,
} from "./day-window";

export interface ExtremeObservation {
  timestamp: string | null;
  tempF: number | null;
}

export interface ObservedExtreme {
  high: number | null;
  low: number | null;
  sampleCount: number;
  firstMs: number | null;
  lastMs: number | null;
  validThroughMs: number | null;
}

/**
 * High/low so far from METAR/SPECI-style point temperatures that fall inside
 * the settlement window. 24-hour max fields are ignored: they always straddle
 * yesterday. 6-hour max is omitted until the print's valid-through is parsed.
 */
export function observedExtreme(args: {
  observations: readonly ExtremeObservation[];
  dateKey: string;
  timeZone: string;
  kind: DayWindowKind;
}): ObservedExtreme {
  const window = settlementWindow({
    dateKey: args.dateKey,
    timeZone: args.timeZone,
    kind: args.kind,
  });
  let high: number | null = null;
  let low: number | null = null;
  let sampleCount = 0;
  let firstMs: number | null = null;
  let lastMs: number | null = null;

  for (const observation of args.observations) {
    const ms = observationMs(observation.timestamp);
    if (ms == null || !inSettlementWindow(ms, window)) continue;
    sampleCount += 1;
    if (firstMs == null || ms < firstMs) firstMs = ms;
    if (lastMs == null || ms > lastMs) lastMs = ms;
    if (observation.tempF == null || !Number.isFinite(observation.tempF)) continue;
    if (high == null || observation.tempF > high) high = observation.tempF;
    if (low == null || observation.tempF < low) low = observation.tempF;
  }

  return {
    high,
    low,
    sampleCount,
    firstMs,
    lastMs,
    validThroughMs: lastMs,
  };
}
