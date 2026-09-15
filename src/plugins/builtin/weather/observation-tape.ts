import {
  inSettlementWindow,
  observationMs,
  settlementWindow,
  type DayWindowKind,
  type SettlementWindow,
} from "./day-window";
import type { DsmPrint } from "./dsm";
import { observationKindFromRaw, parseMetarRemarks } from "./metar-remarks";
import type { NwsCliPrint } from "../../../sources/nws-cli/types";
import type { NwsStationObservation } from "../../../sources/nws-observations";
import { releaseScheduleForStation } from "./release-schedule";

export type ObservationPrintKind =
  | "metar"
  | "speci"
  | "six-hour-high"
  | "six-hour-low"
  | "twenty-four-high"
  | "twenty-four-low"
  | "dsm-high"
  | "dsm-low"
  | "cli-high"
  | "cli-low"
  | "public";

export interface ObservationPrint {
  kind: ObservationPrintKind;
  stationId: string;
  icao: string;
  timestamp: string;
  validFromMs: number | null;
  validToMs: number;
  tempF: number | null;
  dewpointF: number | null;
  humidityPct: number | null;
  countsForToday: boolean | null;
  sourceUrl: string | null;
  label: string;
}

export interface TapeInput {
  stationId: string;
  icao: string;
  dateKey: string;
  timeZone: string;
  kind: DayWindowKind;
  observations: readonly NwsStationObservation[];
  dsm: readonly DsmPrint[];
  cli: readonly NwsCliPrint[];
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function countsEntirelyInWindow(validFromMs: number, validToMs: number, window: SettlementWindow): boolean | null {
  if (validToMs < window.startMs || validFromMs >= window.endMs) return false;
  if (validFromMs >= window.startMs && validToMs <= window.endMs) return true;
  return null;
}

function pushPrint(list: ObservationPrint[], print: ObservationPrint): void {
  list.push(print);
}

export function printsFromObservations(
  input: TapeInput,
): ObservationPrint[] {
  const window = settlementWindow({
    dateKey: input.dateKey,
    timeZone: input.timeZone,
    kind: input.kind,
  });
  const schedule = releaseScheduleForStation(input.stationId);
  const prints: ObservationPrint[] = [];

  for (const observation of input.observations) {
    const ms = observationMs(observation.timestamp);
    if (ms == null) continue;
    const remarks = parseMetarRemarks(observation.rawMessage);
    const kind = observationKindFromRaw(observation.rawMessage);
    const inWindow = inSettlementWindow(ms, window);
    const minute = new Date(ms).getUTCMinutes();
    const isHourly = schedule ? minute === schedule.metarMinute : minute >= 50 && minute <= 59;
    const pointKind: ObservationPrintKind = kind === "speci" ? "speci" : "metar";
    pushPrint(prints, {
      kind: pointKind,
      stationId: input.stationId,
      icao: input.icao,
      timestamp: observation.timestamp,
      validFromMs: ms,
      validToMs: ms,
      tempF: observation.temperatureF,
      dewpointF: observation.dewpointF,
      humidityPct: observation.relativeHumidity,
      countsForToday: inWindow,
      sourceUrl: observation.sourceUrl,
      label: kind === "speci" ? "SPECI" : isHourly ? "METAR hourly" : "METAR",
    });
    if (remarks.maxF6h != null) {
      const from = ms - SIX_HOURS_MS;
      pushPrint(prints, {
        kind: "six-hour-high",
        stationId: input.stationId,
        icao: input.icao,
        timestamp: observation.timestamp,
        validFromMs: from,
        validToMs: ms,
        tempF: remarks.maxF6h,
        dewpointF: null,
        humidityPct: null,
        countsForToday: countsEntirelyInWindow(from, ms, window),
        sourceUrl: observation.sourceUrl,
        label: "6h high",
      });
    }
    if (remarks.minF6h != null) {
      const from = ms - SIX_HOURS_MS;
      pushPrint(prints, {
        kind: "six-hour-low",
        stationId: input.stationId,
        icao: input.icao,
        timestamp: observation.timestamp,
        validFromMs: from,
        validToMs: ms,
        tempF: remarks.minF6h,
        dewpointF: null,
        humidityPct: null,
        countsForToday: countsEntirelyInWindow(from, ms, window),
        sourceUrl: observation.sourceUrl,
        label: "6h low",
      });
    }
    if (remarks.maxF24h != null) {
      const from = ms - DAY_MS;
      pushPrint(prints, {
        kind: "twenty-four-high",
        stationId: input.stationId,
        icao: input.icao,
        timestamp: observation.timestamp,
        validFromMs: from,
        validToMs: ms,
        tempF: remarks.maxF24h,
        dewpointF: null,
        humidityPct: null,
        countsForToday: false,
        sourceUrl: observation.sourceUrl,
        label: "24h high",
      });
    }
    if (remarks.minF24h != null) {
      const from = ms - DAY_MS;
      pushPrint(prints, {
        kind: "twenty-four-low",
        stationId: input.stationId,
        icao: input.icao,
        timestamp: observation.timestamp,
        validFromMs: from,
        validToMs: ms,
        tempF: remarks.minF24h,
        dewpointF: null,
        humidityPct: null,
        countsForToday: false,
        sourceUrl: observation.sourceUrl,
        label: "24h low",
      });
    }
  }

  for (const dsm of input.dsm) {
    if (dsm.date !== input.dateKey) continue;
    const ms = observationMs(dsm.issuedAt) ?? window.startMs;
    if (dsm.highF != null) {
      pushPrint(prints, {
        kind: "dsm-high",
        stationId: input.stationId,
        icao: input.icao,
        timestamp: dsm.issuedAt ?? `${dsm.date}T12:00:00Z`,
        validFromMs: window.startMs,
        validToMs: ms,
        tempF: dsm.highF,
        dewpointF: null,
        humidityPct: null,
        countsForToday: true,
        sourceUrl: dsm.sourceUrl,
        label: dsm.validAsOfLocal ? `DSM high thru ${dsm.validAsOfLocal}` : "DSM high",
      });
    }
    if (dsm.lowF != null) {
      pushPrint(prints, {
        kind: "dsm-low",
        stationId: input.stationId,
        icao: input.icao,
        timestamp: dsm.issuedAt ?? `${dsm.date}T12:00:00Z`,
        validFromMs: window.startMs,
        validToMs: ms,
        tempF: dsm.lowF,
        dewpointF: null,
        humidityPct: null,
        countsForToday: true,
        sourceUrl: dsm.sourceUrl,
        label: dsm.validAsOfLocal ? `DSM low thru ${dsm.validAsOfLocal}` : "DSM low",
      });
    }
  }

  for (const cli of input.cli) {
    if (cli.date !== input.dateKey) continue;
    const ms = observationMs(cli.issuedAt) ?? window.endMs;
    if (cli.highF != null) {
      pushPrint(prints, {
        kind: "cli-high",
        stationId: input.stationId,
        icao: input.icao,
        timestamp: cli.issuedAt ?? `${cli.date}T12:00:00Z`,
        validFromMs: window.startMs,
        validToMs: ms,
        tempF: cli.highF,
        dewpointF: null,
        humidityPct: null,
        countsForToday: true,
        sourceUrl: cli.sourceUrl,
        label: cli.printKind === "final" ? "CLI high final" : "CLI high prelim",
      });
    }
    if (cli.lowF != null) {
      pushPrint(prints, {
        kind: "cli-low",
        stationId: input.stationId,
        icao: input.icao,
        timestamp: cli.issuedAt ?? `${cli.date}T12:00:00Z`,
        validFromMs: window.startMs,
        validToMs: ms,
        tempF: cli.lowF,
        dewpointF: null,
        humidityPct: null,
        countsForToday: true,
        sourceUrl: cli.sourceUrl,
        label: cli.printKind === "final" ? "CLI low final" : "CLI low prelim",
      });
    }
  }

  return prints.sort((left, right) => right.validToMs - left.validToMs);
}

export function latestOfKind(prints: readonly ObservationPrint[], kind: ObservationPrintKind): ObservationPrint | null {
  return prints.find((print) => print.kind === kind) ?? null;
}
