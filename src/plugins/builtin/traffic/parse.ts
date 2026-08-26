import type { TrafficVehicle } from "./types";

export const TRAFFIC_PARSE_CAP = 400;
export const TRAFFIC_FIRST_PAINT = 80;
export const TRAFFIC_YIELD_EVERY = 250;

type OpenSkyState = unknown[];

interface OpenSkyPayload {
  time?: number;
  states?: OpenSkyState[] | null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sameVehicle(left: TrafficVehicle, right: TrafficVehicle): boolean {
  return (
    left.lat === right.lat
    && left.lon === right.lon
    && left.altitudeM === right.altitudeM
    && left.speedMs === right.speedMs
    && left.heading === right.heading
    && left.callsign === right.callsign
    && left.onGround === right.onGround
  );
}

/** Reuse previous row identity when a poll only moves a subset of vehicles. */
export function mergeTrafficVehicles(
  previous: TrafficVehicle[],
  next: TrafficVehicle[],
): TrafficVehicle[] {
  if (previous.length === 0) return next;
  const byId = new Map(previous.map((row) => [row.id, row]));
  let changed = previous.length !== next.length;
  const merged: TrafficVehicle[] = [];
  for (const row of next) {
    const old = byId.get(row.id);
    if (old && sameVehicle(old, row)) {
      merged.push(old);
    } else {
      merged.push(row);
      changed = true;
    }
  }
  return changed ? merged : previous;
}

function parseOpenSkyState(state: OpenSkyState, updatedAt: number): TrafficVehicle | null {
  const icao24 = text(state[0]);
  const lat = num(state[6]);
  const lon = num(state[5]);
  if (!icao24 || lat == null || lon == null) return null;
  const callsign = text(state[1]) || icao24.toUpperCase();
  return {
    id: `ac:${icao24}`,
    kind: "aircraft",
    callsign,
    country: text(state[2]) || "—",
    lat,
    lon,
    altitudeM: num(state[7]) ?? num(state[13]),
    speedMs: num(state[9]),
    heading: num(state[10]),
    onGround: state[8] === true,
    source: "OpenSky",
    url: `https://opensky-network.org/aircraft/${icao24}`,
    updatedAt,
  };
}

export function parseOpenSkyPayload(
  payload: unknown,
  now = Date.now(),
  cap = TRAFFIC_PARSE_CAP,
): TrafficVehicle[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as OpenSkyPayload;
  const updatedAt = typeof body.time === "number" ? body.time * 1000 : now;
  const vehicles: TrafficVehicle[] = [];
  for (const state of body.states ?? []) {
    const vehicle = parseOpenSkyState(state, updatedAt);
    if (!vehicle) continue;
    vehicles.push(vehicle);
    if (vehicles.length >= cap) break;
  }
  return vehicles;
}

export async function parseOpenSkyPayloadIncremental(
  payload: unknown,
  options: {
    now?: number;
    cap?: number;
    firstPaint?: number;
    yieldEvery?: number;
    onPartial?: (rows: TrafficVehicle[]) => void;
  } = {},
): Promise<TrafficVehicle[]> {
  if (!payload || typeof payload !== "object") return [];
  const cap = options.cap ?? TRAFFIC_PARSE_CAP;
  const firstPaint = options.firstPaint ?? TRAFFIC_FIRST_PAINT;
  const yieldEvery = options.yieldEvery ?? TRAFFIC_YIELD_EVERY;
  const now = options.now ?? Date.now();
  const body = payload as OpenSkyPayload;
  const updatedAt = typeof body.time === "number" ? body.time * 1000 : now;
  const states = body.states ?? [];
  const vehicles: TrafficVehicle[] = [];
  let painted = false;
  for (let i = 0; i < states.length; i += 1) {
    const vehicle = parseOpenSkyState(states[i]!, updatedAt);
    if (vehicle) {
      vehicles.push(vehicle);
      if (!painted && vehicles.length >= firstPaint) {
        painted = true;
        options.onPartial?.(vehicles.slice());
      }
      if (vehicles.length >= cap) break;
    }
    if ((i + 1) % yieldEvery === 0) await yieldToUi();
  }
  return vehicles;
}

interface DigitTrafficFeature {
  mmsi?: number;
  geometry?: { coordinates?: unknown };
  properties?: {
    mmsi?: number;
    sog?: number;
    cog?: number;
    heading?: number;
    navStat?: number;
    timestamp?: number;
    name?: string;
  };
}

interface DigitTrafficPayload {
  features?: DigitTrafficFeature[];
}

function featureCoords(feature: DigitTrafficFeature): { lon: number; lat: number } | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lon = num(coords[0]);
  const lat = num(coords[1]);
  if (lat == null || lon == null) return null;
  return { lon, lat };
}

function parseDigitFeature(feature: DigitTrafficFeature, now: number): TrafficVehicle | null {
  const coords = featureCoords(feature);
  const mmsi = feature.mmsi ?? feature.properties?.mmsi;
  if (!coords || mmsi == null) return null;
  const id = String(mmsi);
  const sogKnots = num(feature.properties?.sog);
  return {
    id: `ship:${id}`,
    kind: "ship",
    callsign: text(feature.properties?.name) || id,
    country: "—",
    lat: coords.lat,
    lon: coords.lon,
    altitudeM: null,
    speedMs: sogKnots == null ? null : sogKnots * 0.514444,
    heading: num(feature.properties?.heading) ?? num(feature.properties?.cog),
    onGround: false,
    source: "Digitraffic AIS",
    url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${id}`,
    updatedAt: feature.properties?.timestamp ? feature.properties.timestamp * 1000 : now,
  };
}

export function parseDigitTrafficPayload(
  payload: unknown,
  now = Date.now(),
  cap = TRAFFIC_PARSE_CAP,
): TrafficVehicle[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as DigitTrafficPayload;
  const vehicles: TrafficVehicle[] = [];
  for (const feature of body.features ?? []) {
    const vehicle = parseDigitFeature(feature, now);
    if (!vehicle) continue;
    vehicles.push(vehicle);
    if (vehicles.length >= cap) break;
  }
  return vehicles;
}

export async function parseDigitTrafficPayloadIncremental(
  payload: unknown,
  options: {
    now?: number;
    cap?: number;
    firstPaint?: number;
    yieldEvery?: number;
    onPartial?: (rows: TrafficVehicle[]) => void;
  } = {},
): Promise<TrafficVehicle[]> {
  if (!payload || typeof payload !== "object") return [];
  const cap = options.cap ?? TRAFFIC_PARSE_CAP;
  const firstPaint = options.firstPaint ?? TRAFFIC_FIRST_PAINT;
  const yieldEvery = options.yieldEvery ?? TRAFFIC_YIELD_EVERY;
  const now = options.now ?? Date.now();
  const features = (payload as DigitTrafficPayload).features ?? [];
  const vehicles: TrafficVehicle[] = [];
  let painted = false;
  for (let i = 0; i < features.length; i += 1) {
    const vehicle = parseDigitFeature(features[i]!, now);
    if (vehicle) {
      vehicles.push(vehicle);
      if (!painted && vehicles.length >= firstPaint) {
        painted = true;
        options.onPartial?.(vehicles.slice());
      }
      if (vehicles.length >= cap) break;
    }
    if ((i + 1) % yieldEvery === 0) await yieldToUi();
  }
  return vehicles;
}

export function matchesTrafficSearch(vehicle: TrafficVehicle, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    vehicle.callsign.toLowerCase().includes(normalized)
    || vehicle.country.toLowerCase().includes(normalized)
    || vehicle.id.toLowerCase().includes(normalized)
    || vehicle.kind.includes(normalized)
  );
}
