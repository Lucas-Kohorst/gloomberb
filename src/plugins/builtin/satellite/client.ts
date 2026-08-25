import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { keyedDataUrl, isHostedWebClient } from "../connections/adjacent-cloud";
import { FIRMS_CSV_PATH, gibsHostedPath, gibsHostedSearch, gibsWmsUrl } from "./layers";
import { parseFirmsCsv } from "./parse";
import { FIRMS_CONNECTION_ID, GIBS_CONNECTION_ID, type FireHotspot } from "./types";

const CLIENT = createThrottledFetch({
  requestsPerMinute: 10,
  maxRetries: 2,
  timeoutMs: 30_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    "User-Agent": "gloomberb-satellite",
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

export async function loadFirmsHotspots(): Promise<FireHotspot[]> {
  return withConnectionRequest(FIRMS_CONNECTION_ID, "hotspots", async () => {
    const url = isHostedWebClient()
      ? keyedDataUrl("nasa-firms", FIRMS_CSV_PATH)
      : `https://firms.modaps.eosdis.nasa.gov/${FIRMS_CSV_PATH}`;
    const response = await CLIENT.fetch(url);
    if (!response.ok) throw new Error(`FIRMS request failed (${response.status})`);
    return parseFirmsCsv(await response.text());
  });
}

export function imageryUrl(layer: string, date: string, bbox?: string): string {
  if (isHostedWebClient()) {
    return keyedDataUrl("nasa-gibs", gibsHostedPath(layer), gibsHostedSearch(layer, date, bbox));
  }
  return gibsWmsUrl(layer, date, bbox);
}

export async function prefetchGibs(url: string): Promise<void> {
  await withConnectionRequest(GIBS_CONNECTION_ID, "wms", async () => {
    const response = await CLIENT.fetch(url);
    if (!response.ok) throw new Error(`GIBS request failed (${response.status})`);
    await response.arrayBuffer();
  });
}
