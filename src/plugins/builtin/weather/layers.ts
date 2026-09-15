import type { ConfirmedExtremes } from "./hvt";
import type { ObservationPrint } from "./observation-tape";
import { latestOfKind } from "./observation-tape";
import { isBlindSpotF, probableRangeF } from "./rounding";

export interface LayerRow {
  id: string;
  group: string;
  label: string;
  value: string;
  detail: string;
  counts: string;
}

function formatTemp(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return decimals > 0 ? `${value.toFixed(decimals)}°F` : `${Math.round(value)}°F`;
}

function formatTime(ms: number | null, timeZone: string): string {
  if (ms == null) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

function countsLabel(print: ObservationPrint | null): string {
  if (!print) return "—";
  if (print.countsForToday === true) return "today";
  if (print.countsForToday === false) return "no";
  return "straddle";
}

export function buildLayerRows(args: {
  prints: readonly ObservationPrint[];
  extremes: ConfirmedExtremes;
  timeZone: string;
  yesterdayHigh: number | null;
  fiveDayMin: number | null;
  fiveDayMax: number | null;
}): LayerRow[] {
  const latestPoint = args.prints.find((print) => print.kind === "metar" || print.kind === "speci") ?? null;
  const publicTemp = latestPoint?.tempF ?? null;
  const probable = publicTemp == null ? null : probableRangeF(publicTemp);
  const sixHigh = latestOfKind(args.prints, "six-hour-high");
  const sixLow = latestOfKind(args.prints, "six-hour-low");
  const dayHigh = latestOfKind(args.prints, "twenty-four-high");
  const dayLow = latestOfKind(args.prints, "twenty-four-low");
  const dsmHigh = latestOfKind(args.prints, "dsm-high");
  const dsmLow = latestOfKind(args.prints, "dsm-low");
  const cliHigh = latestOfKind(args.prints, "cli-high");
  const cliLow = latestOfKind(args.prints, "cli-low");
  const hrSp = args.prints.find((print) => print.kind === "speci") ?? latestPoint;
  const blind = publicTemp != null && isBlindSpotF(Math.round(publicTemp));

  return [
    { id: "public", group: "Observations", label: "Public temp", value: formatTemp(publicTemp), detail: latestPoint?.label ?? "—", counts: countsLabel(latestPoint) },
    { id: "prob-max", group: "Observations", label: "Probable max", value: formatTemp(probable?.max ?? null, 1), detail: "rounding bucket", counts: "—" },
    { id: "prob-min", group: "Observations", label: "Probable min", value: formatTemp(probable?.min ?? null, 1), detail: "rounding bucket", counts: "—" },
    { id: "hrsp", group: "Observations", label: "Hourly+SPECI", value: formatTemp(hrSp?.tempF ?? null), detail: hrSp?.label ?? "—", counts: countsLabel(hrSp) },
    { id: "dew", group: "Observations", label: "Dewpoint", value: formatTemp(latestPoint?.dewpointF ?? null), detail: "latest", counts: "—" },
    { id: "rh", group: "Observations", label: "RH", value: latestPoint?.humidityPct == null ? "—" : `${Math.round(latestPoint.humidityPct)}%`, detail: "latest", counts: "—" },
    { id: "wethr-high", group: "Wethr estimates", label: "Wethr high", value: formatTemp(args.extremes.wethrHigh), detail: args.extremes.highPrint?.label ?? "—", counts: countsLabel(args.extremes.highPrint) },
    { id: "wethr-low", group: "Wethr estimates", label: "Wethr low", value: formatTemp(args.extremes.wethrLow), detail: args.extremes.lowPrint?.label ?? "—", counts: countsLabel(args.extremes.lowPrint) },
    { id: "potential-high", group: "Wethr estimates", label: "Potential high", value: formatTemp(args.extremes.potentialHigh), detail: "straddling 6h", counts: args.extremes.potentialHigh == null ? "—" : "straddle" },
    { id: "potential-low", group: "Wethr estimates", label: "Potential low", value: formatTemp(args.extremes.potentialLow), detail: "straddling 6h", counts: args.extremes.potentialLow == null ? "—" : "straddle" },
    { id: "hvt", group: "Valid to", label: "HVT", value: formatTime(args.extremes.hvtMs, args.timeZone), detail: "high valid through", counts: "—" },
    { id: "lvt", group: "Valid to", label: "LVT", value: formatTime(args.extremes.lvtMs, args.timeZone), detail: "low valid through", counts: "—" },
    { id: "six-high", group: "Extremes", label: "6h high", value: formatTemp(sixHigh?.tempF ?? null), detail: formatTime(sixHigh?.validToMs ?? null, args.timeZone), counts: countsLabel(sixHigh) },
    { id: "six-low", group: "Extremes", label: "6h low", value: formatTemp(sixLow?.tempF ?? null), detail: formatTime(sixLow?.validToMs ?? null, args.timeZone), counts: countsLabel(sixLow) },
    { id: "24-high", group: "Extremes", label: "24h high", value: formatTemp(dayHigh?.tempF ?? null), detail: "always straddles", counts: "no" },
    { id: "24-low", group: "Extremes", label: "24h low", value: formatTemp(dayLow?.tempF ?? null), detail: "always straddles", counts: "no" },
    { id: "dsm-high", group: "Prints", label: "DSM high", value: formatTemp(dsmHigh?.tempF ?? null), detail: dsmHigh?.label ?? "—", counts: countsLabel(dsmHigh) },
    { id: "dsm-low", group: "Prints", label: "DSM low", value: formatTemp(dsmLow?.tempF ?? null), detail: dsmLow?.label ?? "—", counts: countsLabel(dsmLow) },
    { id: "cli-high", group: "Prints", label: "CLI high", value: formatTemp(cliHigh?.tempF ?? null), detail: cliHigh?.label ?? "—", counts: countsLabel(cliHigh) },
    { id: "cli-low", group: "Prints", label: "CLI low", value: formatTemp(cliLow?.tempF ?? null), detail: cliLow?.label ?? "—", counts: countsLabel(cliLow) },
    { id: "y-high", group: "History", label: "Yesterday high", value: formatTemp(args.yesterdayHigh), detail: "prior settlement day", counts: "—" },
    { id: "five-day", group: "History", label: "5-day range", value: args.fiveDayMin == null || args.fiveDayMax == null ? "—" : `${Math.round(args.fiveDayMin)}–${Math.round(args.fiveDayMax)}°F`, detail: "settlement highs", counts: "—" },
    { id: "blind", group: "Precision", label: "Blind spot", value: blind ? "yes" : "no", detail: "C/F 5-min gap", counts: "—" },
  ];
}
