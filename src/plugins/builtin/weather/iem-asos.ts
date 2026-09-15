import { withConnectionRequest } from "../connections/register";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { NWS_OBSERVATIONS_CONNECTION_ID } from "./types";
import { nwsIcaoForStation } from "./nws-client";

export interface IemHourlyPoint {
  icao: string;
  validMs: number;
  tempF: number | null;
  maxF6h: number | null;
  minF6h: number | null;
}

const IEM_FETCH = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 400,
  dedupeGetRequests: true,
  defaultHeaders: { "User-Agent": "Gloomberb weather (https://terminal.kohor.st)" },
  transport: httpFetch,
});

function finite(value: string | undefined): number | null {
  if (value == null || value === "" || value === "null" || value === "M") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseIemAsosCsv(text: string, icao: string): IemHourlyPoint[] {
  const lines = text.trim().split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",").map((column) => column.trim().toLowerCase());
  const validIndex = header.indexOf("valid");
  const tempIndex = header.indexOf("tmpf");
  const max6Index = header.indexOf("max_tmpf_6hr");
  const min6Index = header.indexOf("min_tmpf_6hr");
  if (validIndex < 0 || tempIndex < 0) return [];
  const points: IemHourlyPoint[] = [];
  for (const line of lines.slice(1)) {
    const columns = line.split(",");
    const validMs = Date.parse(columns[validIndex] ?? "");
    if (!Number.isFinite(validMs)) continue;
    points.push({
      icao,
      validMs,
      tempF: finite(columns[tempIndex]),
      maxF6h: max6Index >= 0 ? finite(columns[max6Index]) : null,
      minF6h: min6Index >= 0 ? finite(columns[min6Index]) : null,
    });
  }
  return points;
}

export async function loadIemHourly(icaoOrStation: string, hours = 168): Promise<IemHourlyPoint[]> {
  const icao = nwsIcaoForStation(icaoOrStation);
  if (!icao) throw new Error("Unknown ICAO station for IEM ASOS.");
  const station = icao.startsWith("K") && icao.length === 4 ? icao.slice(1) : icao;
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${encodeURIComponent(station)}&data=tmpf&data=max_tmpf_6hr&data=min_tmpf_6hr&tz=UTC&format=onlycomma&latlon=no&hours=${hours}&missing=null`;
  const text = await withConnectionRequest(NWS_OBSERVATIONS_CONNECTION_ID, "iem-hourly", async () => {
    const response = await IEM_FETCH.fetch(url);
    if (!response.ok) throw new Error(`IEM ASOS fetch failed (${response.status}).`);
    return response.text();
  });
  return parseIemAsosCsv(text, icao);
}
