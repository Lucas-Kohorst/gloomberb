import type { DayWindowKind } from "./day-window";
import type { ObservationPrint, ObservationPrintKind } from "./observation-tape";

export type ExtremeMode = "cli" | "metar";

const HIGH_KINDS_CLI: ReadonlySet<ObservationPrintKind> = new Set([
  "metar",
  "speci",
  "six-hour-high",
  "dsm-high",
  "cli-high",
]);
const LOW_KINDS_CLI: ReadonlySet<ObservationPrintKind> = new Set([
  "metar",
  "speci",
  "six-hour-low",
  "dsm-low",
  "cli-low",
]);
const POINT_KINDS: ReadonlySet<ObservationPrintKind> = new Set(["metar", "speci"]);

export interface ConfirmedExtremes {
  wethrHigh: number | null;
  wethrLow: number | null;
  potentialHigh: number | null;
  potentialLow: number | null;
  hvtMs: number | null;
  lvtMs: number | null;
  highPrint: ObservationPrint | null;
  lowPrint: ObservationPrint | null;
}

function allowsHigh(print: ObservationPrint, mode: ExtremeMode): boolean {
  if (print.tempF == null) return false;
  if (mode === "metar") return POINT_KINDS.has(print.kind) && print.countsForToday === true;
  if (!HIGH_KINDS_CLI.has(print.kind)) return false;
  if (print.kind === "six-hour-high") return print.countsForToday === true;
  return print.countsForToday !== false;
}

function allowsLow(print: ObservationPrint, mode: ExtremeMode): boolean {
  if (print.tempF == null) return false;
  if (mode === "metar") return POINT_KINDS.has(print.kind) && print.countsForToday === true;
  if (!LOW_KINDS_CLI.has(print.kind)) return false;
  if (print.kind === "six-hour-low") return print.countsForToday === true;
  return print.countsForToday !== false;
}

export function extremeModeForWindow(kind: DayWindowKind): ExtremeMode {
  return kind === "lst" ? "cli" : "metar";
}

export function confirmedExtremes(
  prints: readonly ObservationPrint[],
  mode: ExtremeMode,
): ConfirmedExtremes {
  let wethrHigh: number | null = null;
  let wethrLow: number | null = null;
  let hvtMs: number | null = null;
  let lvtMs: number | null = null;
  let highPrint: ObservationPrint | null = null;
  let lowPrint: ObservationPrint | null = null;
  let potentialHigh: number | null = null;
  let potentialLow: number | null = null;

  for (const print of prints) {
    if (print.tempF == null) continue;
    if (allowsHigh(print, mode)) {
      if (wethrHigh == null || print.tempF > wethrHigh) {
        wethrHigh = print.tempF;
        highPrint = print;
        hvtMs = print.validToMs;
      } else if (print.tempF === wethrHigh && (hvtMs == null || print.validToMs > hvtMs)) {
        hvtMs = print.validToMs;
        highPrint = print;
      }
    } else if (
      print.kind === "six-hour-high"
      && print.countsForToday == null
      && (potentialHigh == null || print.tempF > potentialHigh)
    ) {
      potentialHigh = print.tempF;
    }

    if (allowsLow(print, mode)) {
      if (wethrLow == null || print.tempF < wethrLow) {
        wethrLow = print.tempF;
        lowPrint = print;
        lvtMs = print.validToMs;
      } else if (print.tempF === wethrLow && (lvtMs == null || print.validToMs > lvtMs)) {
        lvtMs = print.validToMs;
        lowPrint = print;
      }
    } else if (
      print.kind === "six-hour-low"
      && print.countsForToday == null
      && (potentialLow == null || print.tempF < potentialLow)
    ) {
      potentialLow = print.tempF;
    }
  }

  if (potentialHigh != null && wethrHigh != null && potentialHigh <= wethrHigh) potentialHigh = null;
  if (potentialLow != null && wethrLow != null && potentialLow >= wethrLow) potentialLow = null;

  return {
    wethrHigh,
    wethrLow,
    potentialHigh,
    potentialLow,
    hvtMs,
    lvtMs,
    highPrint,
    lowPrint,
  };
}
