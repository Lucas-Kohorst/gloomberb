import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  OPENSKY_API_BASE_URL,
  OPENSKY_CONNECTION_ID,
  type AircraftPage,
  type AircraftState,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
export const AIRCRAFT_DISPLAY_CAP = 400;
export const AIRCRAFT_FIRST_PAINT = 80;
export const AIRCRAFT_YIELD_EVERY = 250;

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const apiFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-opensky",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseState(raw: unknown): AircraftState | null {
  if (!Array.isArray(raw)) return null;
  const icao24 = asString(raw[0]);
  if (!icao24) return null;
  const callsign = asString(raw[1]) ?? "";
  return {
    icao24: icao24.toLowerCase(),
    callsign: callsign.trim(),
    originCountry: asString(raw[2]) ?? "",
    longitude: asNumber(raw[3]),
    latitude: asNumber(raw[4]),
    altitude: asNumber(raw[5]),
    velocity: asNumber(raw[6]),
    heading: asNumber(raw[7]),
    verticalRate: asNumber(raw[8]),
    onGround: asBoolean(raw[9]),
    lastContact: asNumber(raw[10]),
  };
}

export function matchesCallsign(state: AircraftState, filter: string): boolean {
  if (!filter) return true;
  return state.callsign.toUpperCase().startsWith(filter);
}

export function mergeAircraft(previous: AircraftState[], next: AircraftState[]): AircraftState[] {
  if (previous.length === 0) return next;
  const byId = new Map(previous.map((row) => [row.icao24, row]));
  let changed = previous.length !== next.length;
  const merged = next.map((row) => {
    const old = byId.get(row.icao24);
    if (
      old
      && old.latitude === row.latitude
      && old.longitude === row.longitude
      && old.altitude === row.altitude
      && old.velocity === row.velocity
      && old.callsign === row.callsign
      && old.lastContact === row.lastContact
    ) {
      return old;
    }
    changed = true;
    return row;
  });
  return changed ? merged : previous;
}

export async function parseAircraftPage(
  data: unknown,
  options: {
    callsignFilter?: string;
    cap?: number;
    firstPaint?: number;
    yieldEvery?: number;
    onPartial?: (aircraft: AircraftState[]) => void;
  } = {},
): Promise<AircraftPage> {
  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const time = asNumber(record.time);
  const states = Array.isArray(record.states) ? record.states : [];
  const cap = options.cap ?? AIRCRAFT_DISPLAY_CAP;
  const firstPaint = options.firstPaint ?? AIRCRAFT_FIRST_PAINT;
  const yieldEvery = options.yieldEvery ?? AIRCRAFT_YIELD_EVERY;
  const filter = options.callsignFilter?.trim().toUpperCase() ?? "";
  const aircraft: AircraftState[] = [];
  let painted = false;
  for (let i = 0; i < states.length; i++) {
    const state = parseState(states[i]);
    if (state && matchesCallsign(state, filter)) {
      aircraft.push(state);
      if (!painted && aircraft.length >= firstPaint) {
        painted = true;
        options.onPartial?.(aircraft.slice());
      }
      if (aircraft.length >= cap) break;
    }
    if ((i + 1) % yieldEvery === 0) await yieldToUi();
  }
  return { aircraft, time, hasNext: false };
}

export class OpenSkyClient {
  async listAircraft(
    callsignFilter?: string,
    onPartial?: (aircraft: AircraftState[]) => void,
  ): Promise<AircraftPage> {
    return withConnectionRequest(OPENSKY_CONNECTION_ID, "fetch", async () => {
      const response = await apiFetch.fetch(`${OPENSKY_API_BASE_URL}/states/all`);
      if (!response.ok) {
        throw new Error(`OpenSky request failed: ${response.status} ${response.statusText}`);
      }
      return parseAircraftPage(await response.json(), { callsignFilter, onPartial });
    });
  }
}
