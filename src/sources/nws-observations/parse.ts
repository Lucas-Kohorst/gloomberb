import {
  NWS_OBSERVATIONS_PROVIDER_ID,
  type NwsStationObservation,
  type NwsStationObservationSet,
} from "./types";

interface Quantity {
  value?: unknown;
  unitCode?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function unitKey(unitCode: unknown): string {
  if (typeof unitCode !== "string") return "";
  return unitCode.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function quantity(value: unknown): { value: number; unit: string } | null {
  const direct = finiteNumber(value);
  if (direct != null) return { value: direct, unit: "" };
  const item = record(value) as Quantity | null;
  if (!item) return null;
  const numeric = finiteNumber(item.value);
  return numeric == null ? null : { value: numeric, unit: unitKey(item.unitCode) };
}

function convert(value: unknown, kind: "temperature" | "speed" | "distance" | "pressure" | "precipitation" | "humidity"): number | null {
  const input = quantity(value);
  if (!input) return null;
  const { value: numeric, unit } = input;
  if (!unit) return numeric;

  switch (kind) {
    case "temperature":
      if (/(degc|celsius|degreecelsius)$/.test(unit)) return numeric * 9 / 5 + 32;
      if (/(degf|fahrenheit|degreefahrenheit)$/.test(unit)) return numeric;
      if (/(kelvin|degk)$/.test(unit)) return (numeric - 273.15) * 9 / 5 + 32;
      return null;
    case "speed":
      if (/(kmh|kilometerperhour|kilometresperhour)$/.test(unit)) return numeric * 0.6213711922;
      if (/(ms|meterpersecond|metrepersecond)$/.test(unit)) return numeric * 2.2369362921;
      if (/(knot|knots|kt)$/.test(unit)) return numeric * 1.150779448;
      if (/(mph|mileperhour|milesperhour)$/.test(unit)) return numeric;
      return null;
    case "distance":
      if (/(meter|metre|m)$/.test(unit)) return numeric / 1609.344;
      if (/(kilometer|kilometre|km)$/.test(unit)) return numeric * 0.6213711922;
      if (/(mile|mi)$/.test(unit)) return numeric;
      if (/(foot|feet|ft)$/.test(unit)) return numeric / 5280;
      return null;
    case "pressure":
      if (/(hpa|mbar|millibar)$/.test(unit)) return numeric * 0.02952998751;
      if (/(pa|pascal|pascals)$/.test(unit)) return numeric * 0.0002952998751;
      if (/(inhg|inchofmercury)$/.test(unit)) return numeric;
      return null;
    case "precipitation":
      if (/(mm|millimeter|millimetre)$/.test(unit)) return numeric / 25.4;
      if (/(cm|centimeter|centimetre)$/.test(unit)) return numeric / 2.54;
      if (/(meter|metre|m)$/.test(unit)) return numeric * 39.37007874;
      if (/(inch|in)$/.test(unit)) return numeric;
      return null;
    case "humidity":
      if (/(percent|percentage)$/.test(unit)) return numeric;
      if (/(ratio|fraction)$/.test(unit)) return numeric * 100;
      return null;
  }
}

function direction(value: unknown): number | null {
  const numeric = quantity(value)?.value;
  if (numeric == null) return null;
  return ((numeric % 360) + 360) % 360;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Only full four-character station identifiers are accepted by this source. */
export function normalizeNwsObservationIcao(icao: string): string | null {
  const normalized = icao.trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(normalized) ? normalized : null;
}

/** Pure parser for the GeoJSON payload returned by NWS station observations. */
export function parseNwsStationObservations(payload: unknown, icao: string): NwsStationObservationSet {
  const stationId = normalizeNwsObservationIcao(icao);
  if (!stationId) throw new Error("A four-character ICAO station is required.");
  const features = record(payload)?.features;
  const observations: NwsStationObservation[] = !Array.isArray(features) ? [] : features.flatMap((feature) => {
    const item = record(feature);
    const properties = record(item?.properties);
    const timestamp = text(properties?.timestamp);
    if (!properties || !timestamp || Number.isNaN(Date.parse(timestamp))) return [];
    return [{
      provider: NWS_OBSERVATIONS_PROVIDER_ID,
      stationId,
      sourceUrl: text(item?.id),
      timestamp,
      textDescription: text(properties.textDescription),
      temperatureF: convert(properties.temperature, "temperature"),
      dewpointF: convert(properties.dewpoint, "temperature"),
      relativeHumidity: convert(properties.relativeHumidity, "humidity"),
      windDirectionDeg: direction(properties.windDirection),
      windSpeedMph: convert(properties.windSpeed, "speed"),
      windGustMph: convert(properties.windGust, "speed"),
      visibilityMi: convert(properties.visibility, "distance"),
      barometricPressureInHg: convert(properties.barometricPressure, "pressure"),
      seaLevelPressureInHg: convert(properties.seaLevelPressure, "pressure"),
      precipitationLastHourIn: convert(properties.precipitationLastHour, "precipitation"),
      precipitationLast3HoursIn: convert(properties.precipitationLast3Hours, "precipitation"),
      precipitationLast6HoursIn: convert(properties.precipitationLast6Hours, "precipitation"),
    }];
  });

  return {
    provider: NWS_OBSERVATIONS_PROVIDER_ID,
    seriesId: stationId,
    icao: stationId,
    observations,
  };
}
