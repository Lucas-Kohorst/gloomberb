import type { CloudFredObservationPayload, CloudFredSeriesPayload } from "../api-client";
import type { CloudFredSeriesParams } from "../api-client/paths";
import { withConnectionRequest } from "../plugins/builtin/connections/register";
import { createThrottledFetch } from "../utils/throttled-fetch";
import { httpFetch } from "../utils/http-transport";

export const FRED_PUBLIC_CONNECTION_ID = "fred-public";

const FRED_SERIES_ID_RE = /^[A-Z0-9._-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const FRED_FETCH = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 800,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "text/csv,text/plain,*/*",
    "User-Agent": "gloomberb-fred",
  },
  transport: httpFetch,
});

function assertSeriesId(seriesId: string): string {
  const id = seriesId.trim().toUpperCase();
  if (!FRED_SERIES_ID_RE.test(id)) {
    throw new Error(`Invalid FRED series id "${seriesId}"`);
  }
  return id;
}

function publicFredCsvUrl(seriesId: string, startDate?: string): string {
  const params = new URLSearchParams({ id: seriesId });
  if (startDate && DATE_RE.test(startDate)) params.set("cosd", startDate);
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?${params.toString()}`;
}

function parseFredNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === ".") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parses the public `fredgraph.csv` download. Missing prints are a lone `.`.
 * HTML error pages (unknown series) are rejected instead of becoming empty data.
 */
export function parseFredGraphCsv(csv: string, seriesId: string): CloudFredObservationPayload[] {
  const text = csv.replace(/^\uFEFF/, "").trim();
  if (!text || text.startsWith("<!") || text.startsWith("<html")) {
    throw new Error(`FRED series ${seriesId} is unavailable`);
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error(`FRED series ${seriesId} returned no observations`);

  const observations: CloudFredObservationPayload[] = [];
  for (const line of lines.slice(1)) {
    const comma = line.indexOf(",");
    if (comma < 0) continue;
    const date = line.slice(0, comma).trim();
    if (!DATE_RE.test(date)) continue;
    observations.push({ date, value: parseFredNumber(line.slice(comma + 1)) });
  }
  if (observations.length === 0) {
    throw new Error(`FRED series ${seriesId} returned no observations`);
  }
  return observations;
}

function applyFredSeriesParams(
  observations: CloudFredObservationPayload[],
  params: CloudFredSeriesParams,
): CloudFredObservationPayload[] {
  let next = observations;
  if (params.startDate && DATE_RE.test(params.startDate)) {
    next = next.filter((row) => row.date >= params.startDate!);
  }
  if (params.endDate && DATE_RE.test(params.endDate)) {
    next = next.filter((row) => row.date <= params.endDate!);
  }
  next = [...next].sort((left, right) => (
    params.sortOrder === "desc"
      ? right.date.localeCompare(left.date)
      : left.date.localeCompare(right.date)
  ));
  if (params.limit != null && params.limit > 0) next = next.slice(0, params.limit);
  return next;
}

export async function fetchPublicFredSeries(
  seriesId: string,
  params: CloudFredSeriesParams = {},
): Promise<CloudFredSeriesPayload> {
  const id = assertSeriesId(seriesId);
  return withConnectionRequest(FRED_PUBLIC_CONNECTION_ID, id, async () => {
    const response = await FRED_FETCH.fetch(publicFredCsvUrl(id, params.startDate));
    if (!response.ok) {
      throw new Error(`FRED request failed (${response.status}) for ${id}`);
    }
    const observations = applyFredSeriesParams(
      parseFredGraphCsv(await response.text(), id),
      params,
    );
    return {
      observations,
      info: {
        id,
        title: id,
        units: "Percent",
        frequency: "Daily",
        seasonalAdjustment: "Not Seasonally Adjusted",
        source: "FRED",
        notes: "",
      },
    };
  });
}
