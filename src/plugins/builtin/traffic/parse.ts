import type { TrafficVehicle } from "./types";

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

export function parseOpenSkyPayload(payload: unknown, now = Date.now()): TrafficVehicle[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as OpenSkyPayload;
  const updatedAt = typeof body.time === "number" ? body.time * 1000 : now;
  const vehicles: TrafficVehicle[] = [];
  for (const state of body.states ?? []) {
    const icao24 = text(state[0]);
    const lat = num(state[6]);
    const lon = num(state[5]);
    if (!icao24 || lat == null || lon == null) continue;
    const callsign = text(state[1]) || icao24.toUpperCase();
    vehicles.push({
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
    });
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

export function parseDigitTrafficPayload(payload: unknown, now = Date.now()): TrafficVehicle[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as DigitTrafficPayload;
  const vehicles: TrafficVehicle[] = [];
  for (const feature of body.features ?? []) {
    const coords = featureCoords(feature);
    const mmsi = feature.mmsi ?? feature.properties?.mmsi;
    if (!coords || mmsi == null) continue;
    const id = String(mmsi);
    const sogKnots = num(feature.properties?.sog);
    vehicles.push({
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
    });
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
