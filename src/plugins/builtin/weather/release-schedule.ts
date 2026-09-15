export interface StationReleaseSchedule {
  stationId: string;
  /** Typical CLI issue time, UTC HH:MM. */
  cliUtc: string;
  /** Hourly METAR minute past the hour. */
  metarMinute: number;
  /** DSM issue times, UTC HH:MM. */
  dsmUtc: readonly string[];
  /** 6-hour max/min METAR times, UTC HH:MM. */
  sixHourUtc: readonly string[];
}

const SCHEDULES: Readonly<Record<string, StationReleaseSchedule>> = {
  MDW: {
    stationId: "MDW",
    cliUtc: "06:44",
    metarMinute: 53,
    dsmUtc: ["21:17", "22:17", "06:17"],
    sixHourUtc: ["05:53", "11:53", "17:53", "23:53"],
  },
  ORD: {
    stationId: "ORD",
    cliUtc: "06:32",
    metarMinute: 51,
    dsmUtc: ["21:14", "22:14", "23:14", "21:26"],
    sixHourUtc: ["05:51", "11:51", "17:51", "23:51"],
  },
};

export function releaseScheduleForStation(stationId: string): StationReleaseSchedule | null {
  return SCHEDULES[stationId] ?? null;
}

export function formatReleaseHint(schedule: StationReleaseSchedule): string {
  return `CLI ${schedule.cliUtc}Z · METAR :${String(schedule.metarMinute).padStart(2, "0")}`;
}
