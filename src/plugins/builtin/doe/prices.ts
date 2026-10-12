import { createPluginCache } from "../../../data/plugin-cache";
import type { SeriesDefinition, SeriesPoint } from "../../../series/types";
import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { cachedSeriesWarning } from "../shared/series-warning";
import { loadCloudResource } from "../shared/cloud-resource";

/**
 * EIA weekly retail prices the petroleum board does not carry.
 * The public series id is the request facet. No key: the open v2 route serves these.
 */
const PRICE_SERIES = [
  {
    id: "gasoline-price",
    name: "US regular gasoline retail price",
    facet: "EMM_EPMR_PTE_NUS_DPG",
    url: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMM_EPMR_PTE_NUS_DPG&f=W",
    tags: ["gasoline", "retail", "pump price", "AAA"],
  },
  {
    id: "diesel-price",
    name: "US No. 2 diesel retail price",
    facet: "EMD_EPD2D_PTE_NUS_DPG",
    url: "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMD_EPD2D_PTE_NUS_DPG&f=W",
    tags: ["diesel", "retail", "pump price"],
  },
] as const;

const PRICE_API = "https://api.eia.gov/v2/petroleum/pri/gnd/data/";
const HISTORY_LENGTH = 260;

export const doePriceCache = createPluginCache<SeriesPoint[]>({
  kind: "doe-retail-price", source: "eia", schemaVersion: 1,
  policy: { staleMs: 15 * 60_000, expireMs: 14 * 24 * 60 * 60_000 },
});

const priceFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: { Accept: "application/json", "User-Agent": "gloomberb" },
  transport: (url, init) => httpFetch(url, init),
});

export function doePriceHistoryUrl(facet: string): string {
  const params = new URLSearchParams();
  params.set("frequency", "weekly");
  params.set("data[0]", "value");
  params.append("facets[series][]", facet);
  params.set("sort[0][column]", "period");
  params.set("sort[0][direction]", "desc");
  params.set("offset", "0");
  params.set("length", String(HISTORY_LENGTH));
  return `${PRICE_API}?${params.toString()}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asPeriod(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const period = value.trim();
  return new Date(`${period}T00:00:00Z`).toISOString().slice(0, 10) === period ? period : null;
}

/** Oldest first. A blank or non-numeric week is skipped. */
export function parseDoePriceHistory(data: unknown): SeriesPoint[] {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const response = record.response && typeof record.response === "object" ? record.response as Record<string, unknown> : {};
  const rows = Array.isArray(response.data) ? response.data : [];
  const points: SeriesPoint[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const period = asPeriod(entry.period);
    const value = asNumber(entry.value);
    if (!period || value == null || seen.has(period)) continue;
    seen.add(period);
    points.push({ date: period, value });
  }
  points.sort((left, right) => String(left.date).localeCompare(String(right.date)));
  if (points.length === 0) throw new Error("No weekly prices");
  return points;
}

function validatePrices(points: SeriesPoint[]): SeriesPoint[] {
  if (!Array.isArray(points) || points.length === 0 || points.some((point) => !asPeriod(point?.date) || !Number.isFinite(point.value))) {
    throw new Error("Invalid weekly prices");
  }
  return points;
}

async function fetchPrices(facet: string, label: string): Promise<SeriesPoint[]> {
  const response = await priceFetch.fetch(doePriceHistoryUrl(facet), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${label} is unavailable`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  try {
    return parseDoePriceHistory(payload);
  } catch {
    throw new Error(`${label} is unavailable`);
  }
}

export const DOE_PRICE_SERIES: readonly SeriesDefinition[] = PRICE_SERIES.map((series) => ({
  id: `doe:${series.id}`,
  name: series.name,
  unit: "USD/gallon",
  frequency: "weekly",
  group: "Energy",
  publisher: "EIA",
  url: series.url,
  tags: ["oil", "petroleum", "EIA", "weekly", ...series.tags],
  description: "EIA weekly US retail price. Not gasoline stocks, and not the AAA daily average.",
  load: async () => {
    const resource = await loadCloudResource(
      doePriceCache,
      series.id,
      () => fetchPrices(series.facet, series.name),
      { validate: validatePrices },
    );
    const warning = cachedSeriesWarning(resource);
    return { points: resource.payload, ...(warning ? { warning } : {}) };
  },
}));


