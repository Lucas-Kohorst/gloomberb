import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  NASA_FIRMS_API_BASE_URL,
  NASA_FIRMS_CONNECTION_ID,
  type FireDetection,
  type FirePage,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
export const FIRMS_DISPLAY_CAP = 500;
export const FIRMS_FIRST_PAINT = 150;
export const FIRMS_YIELD_EVERY = 400;

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Keep the hottest pixels so a country-wide CSV cannot flood the table. */
export function keepHottestDetections(
  detections: FireDetection[],
  cap = FIRMS_DISPLAY_CAP,
): FireDetection[] {
  if (detections.length <= cap) return detections;
  return detections
    .map((detection, index) => ({ detection, index, frp: detection.frp }))
    .sort((a, b) => b.frp - a.frp || a.index - b.index)
    .slice(0, cap)
    .map((entry) => entry.detection);
}

function trimHottest(detections: FireDetection[], cap: number): void {
  if (detections.length <= cap) return;
  const kept = keepHottestDetections(detections, cap);
  detections.length = 0;
  for (const detection of kept) detections.push(detection);
}

function snapshotHottest(detections: FireDetection[], cap: number): FireDetection[] {
  const kept = keepHottestDetections(detections, cap);
  return kept === detections ? detections.slice() : kept;
}

/**
 * FIRMS allows roughly 20 requests per minute per MAP_KEY. We stay conservative
 * to avoid 429s, especially when the user is arrowing through countries.
 */
const firmsFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "text/csv",
    "User-Agent": "gloomberb-nasa-firms",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

/**
 * Parse a single FIRMS CSV row into a FireDetection. Column names are
 * normalised to lowercase by the caller. `brightness` is `brightness` for
 * MODIS and `bright_ti4` for VIIRS; we accept both.
 */
function parseDetection(row: Record<string, string>): FireDetection | null {
  const latitude = Number(row["latitude"]);
  const longitude = Number(row["longitude"]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const brightness = Number(row["brightness"] ?? row["bright_ti4"] ?? "0");
  const scan = Number(row["scan"] ?? "0");
  const track = Number(row["track"] ?? "0");
  const acqDate = row["acq_date"] ?? "";
  const acqTime = row["acq_time"] ?? "";
  const satellite = row["satellite"] ?? "";
  const confidence = row["confidence"] ?? "";
  const frp = Number(row["frp"] ?? "0");
  const dayNight = row["daynight"] ?? "";

  if (!acqDate || !satellite) return null;

  return {
    latitude,
    longitude,
    brightness: Number.isFinite(brightness) ? brightness : 0,
    scan: Number.isFinite(scan) ? scan : 0,
    track: Number.isFinite(track) ? track : 0,
    acqDate,
    acqTime,
    satellite,
    confidence,
    frp: Number.isFinite(frp) ? frp : 0,
    dayNight,
  };
}

function parseFirmsHeader(csv: string): { header: string[]; lines: string[] } {
  const text = csv.trim();
  const lines = text ? text.split("\n") : [];
  const header = lines[0]?.split(",").map((h) => h.trim().toLowerCase()) ?? [];
  if (header.length > 0 && (!header.includes("latitude") || !header.includes("longitude"))) {
    throw new Error(
      "Unexpected response from NASA FIRMS API — verify your MAP_KEY is valid.",
    );
  }
  return { header, lines };
}

function parseCsvDetection(header: string[], line: string): FireDetection | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const values = trimmed.split(",");
  const row: Record<string, string> = {};
  for (let j = 0; j < header.length && j < values.length; j++) {
    row[header[j]!] = values[j]?.trim() ?? "";
  }
  return parseDetection(row);
}

/**
 * Parse the raw FIRMS CSV text into FireDetection[]. The first line is the
 * header row; subsequent lines are data. If the response does not look like a
 * FIRMS CSV (e.g. an error message returned with 200), throws a helpful error.
 */
export function parseFirmsCsv(csv: string, cap = FIRMS_DISPLAY_CAP): FireDetection[] {
  const { header, lines } = parseFirmsHeader(csv);
  if (lines.length < 2) return [];

  const detections: FireDetection[] = [];
  for (let i = 1; i < lines.length; i++) {
    const detection = parseCsvDetection(header, lines[i]!);
    if (!detection) continue;
    detections.push(detection);
    if (detections.length >= cap * 3) trimHottest(detections, cap);
  }
  return keepHottestDetections(detections, cap);
}

export async function parseFirmsCsvIncremental(
  csv: string,
  options: {
    cap?: number;
    firstPaint?: number;
    yieldEvery?: number;
    onPartial?: (detections: FireDetection[]) => void;
  } = {},
): Promise<FireDetection[]> {
  const cap = options.cap ?? FIRMS_DISPLAY_CAP;
  const firstPaint = options.firstPaint ?? FIRMS_FIRST_PAINT;
  const yieldEvery = options.yieldEvery ?? FIRMS_YIELD_EVERY;
  const { header, lines } = parseFirmsHeader(csv);
  if (lines.length < 2) return [];
  await yieldToUi();

  const detections: FireDetection[] = [];
  let painted = false;
  for (let i = 1; i < lines.length; i++) {
    const detection = parseCsvDetection(header, lines[i]!);
    if (detection) {
      detections.push(detection);
      if (detections.length >= cap * 3) trimHottest(detections, cap);
      if (!painted && detections.length >= firstPaint) {
        painted = true;
        options.onPartial?.(snapshotHottest(detections, cap));
      }
    }
    if (i % yieldEvery === 0) await yieldToUi();
  }
  return keepHottestDetections(detections, cap);
}

export interface FirmsClientOptions {
  mapKey?: string;
}

export class FirmsClient {
  readonly mapKey: string | undefined;

  constructor(options: FirmsClientOptions = {}) {
    this.mapKey = options.mapKey?.trim() || undefined;
  }

  /** True when a MAP_KEY is configured and requests can be made. */
  get authenticated(): boolean {
    return this.mapKey !== undefined;
  }

  private requireKey(): string {
    if (!this.mapKey) {
      throw new Error(
        "NASA FIRMS MAP_KEY is not configured. Get a free key at https://firms.modaps.eosdis.nasa.gov/api/area/",
      );
    }
    return this.mapKey;
  }

  /**
   * Fetch active fire detections for a country (ISO 3-letter code, e.g. "USA",
   * "BRA", "AUS") over the last `days` days.
   */
  async getFiresByCountry(
    countryCode: string,
    days: number,
    options?: { onPartial?: (detections: FireDetection[]) => void },
  ): Promise<FirePage> {
    return withConnectionRequest(NASA_FIRMS_CONNECTION_ID, "fetch", async () => {
      const key = this.requireKey();
      const url = `${NASA_FIRMS_API_BASE_URL}/country/csv/${encodeURIComponent(key)}/${encodeURIComponent(countryCode)}/${days}`;
      const response = await firmsFetch.fetch(url);
      if (!response.ok) {
        throw new Error(
          `NASA FIRMS request failed: ${response.status} ${response.statusText}`,
        );
      }
      const csv = await response.text();
      const detections = await parseFirmsCsvIncremental(csv, { onPartial: options?.onPartial });
      return { detections, total: detections.length };
    });
  }

  /**
   * Fetch active fire detections within a bounding box
   * (`west,south,east,north`, e.g. "-125,25,-66,49" for continental US) over
   * the last `days` days.
   */
  async getFiresByArea(
    bbox: string,
    days: number,
    options?: { onPartial?: (detections: FireDetection[]) => void },
  ): Promise<FirePage> {
    return withConnectionRequest(NASA_FIRMS_CONNECTION_ID, "fetch", async () => {
      const key = this.requireKey();
      const url = `${NASA_FIRMS_API_BASE_URL}/area/csv/${encodeURIComponent(key)}/${bbox}/${days}`;
      const response = await firmsFetch.fetch(url);
      if (!response.ok) {
        throw new Error(
          `NASA FIRMS request failed: ${response.status} ${response.statusText}`,
        );
      }
      const csv = await response.text();
      const detections = await parseFirmsCsvIncremental(csv, { onPartial: options?.onPartial });
      return { detections, total: detections.length };
    });
  }
}

const DEFAULT_DAYS = 1;

/**
 * Load fires for the pane. If `query` contains a comma, it is treated as a
 * bounding box (west,south,east,north); otherwise as a country code.
 */
export async function loadFires(
  client: FirmsClient,
  query: string,
  days: number = DEFAULT_DAYS,
  onPartial?: (detections: FireDetection[]) => void,
): Promise<FirePage> {
  const normalized = query.trim();
  if (!normalized) return { detections: [], total: 0 };
  if (normalized.includes(",")) {
    return client.getFiresByArea(normalized, days, { onPartial });
  }
  return client.getFiresByCountry(normalized.toUpperCase(), days, { onPartial });
}
