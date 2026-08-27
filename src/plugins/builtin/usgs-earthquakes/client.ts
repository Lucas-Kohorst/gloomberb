import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  USGS_API_BASE_URL,
  USGS_EARTHQUAKES_CONNECTION_ID,
  type Earthquake,
  type EarthquakePage,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

const usgsFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-usgs-earthquakes",
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

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === 1;
}

/**
 * Parse a single GeoJSON Feature into an Earthquake.
 * Coordinates are [longitude, latitude, depth] per the GeoJSON spec.
 */
function parseEarthquake(raw: unknown): Earthquake | null {
  if (!raw || typeof raw !== "object") return null;
  const feature = raw as Record<string, unknown>;

  const id = asString(feature.id);
  if (!id) return null;

  const props = (feature.properties && typeof feature.properties === "object"
    ? feature.properties
    : {}) as Record<string, unknown>;
  const geometry = (feature.geometry && typeof feature.geometry === "object"
    ? feature.geometry
    : {}) as Record<string, unknown>;

  const magnitude = asNumber(props.mag);
  if (magnitude == null) return null;

  const place = asString(props.place) ?? "";
  const time = asDate(props.time) ?? new Date(0);
  const url = asString(props.url) ?? "";
  const tsunami = asBoolean(props.tsunami);
  const significance = asNumber(props.sig) ?? 0;
  const type = asString(props.type) ?? "earthquake";
  const title = asString(props.title) ?? place;

  const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  const longitude = asNumber(coords[0]) ?? 0;
  const latitude = asNumber(coords[1]) ?? 0;
  const depth = asNumber(coords[2]) ?? 0;

  return {
    id,
    magnitude,
    place,
    time,
    url,
    tsunami,
    significance,
    type,
    title,
    longitude,
    latitude,
    depth,
  };
}

export const EARTHQUAKE_DISPLAY_CAP = 100;

function parsePage(data: unknown, cap = EARTHQUAKE_DISPLAY_CAP): EarthquakePage {
  const record = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const metadata = (record.metadata && typeof record.metadata === "object"
    ? record.metadata
    : {}) as Record<string, unknown>;
  const features = Array.isArray(record.features) ? record.features : [];
  const total = asNumber(metadata.count) ?? features.length;
  const earthquakes: Earthquake[] = [];
  for (const feature of features) {
    const eq = parseEarthquake(feature);
    if (!eq) continue;
    earthquakes.push(eq);
    if (earthquakes.length >= cap) break;
  }
  return { earthquakes, total };
}

export interface EarthquakesClientOptions {
  minMagnitude?: number;
  limit?: number;
}

export class EarthquakesClient {
  /**
   * Fetch earthquakes from the USGS FDSN event API.
   * `searchQuery` filters by location text client-side (the `place` field)
   * because the USGS API has no text-search parameter.
   */
  async listEarthquakes(options: {
    minMagnitude?: number;
    limit?: number;
    searchQuery?: string;
  }): Promise<EarthquakePage> {
    return withConnectionRequest(USGS_EARTHQUAKES_CONNECTION_ID, "fetch", async () => {
      const params = new URLSearchParams();
      params.set("format", "geojson");
      params.set("orderby", "time");
      params.set("minmagnitude", String(options.minMagnitude ?? 2.5));
      params.set("limit", String(options.limit ?? 100));
      const url = `${USGS_API_BASE_URL}/query?${params.toString()}`;
      const response = await usgsFetch.fetch(url);
      if (!response.ok) {
        throw new Error(
          `USGS request failed: ${response.status} ${response.statusText}`,
        );
      }
      const page = parsePage(await response.json());
      const searchQuery = options.searchQuery?.trim();
      if (!searchQuery) return page;
      const normalized = searchQuery.toLowerCase();
      const earthquakes = page.earthquakes.filter((eq) =>
        eq.place.toLowerCase().includes(normalized),
      );
      return earthquakes === page.earthquakes
        ? page
        : { ...page, earthquakes };
    });
  }
}
