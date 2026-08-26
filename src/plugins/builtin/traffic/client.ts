import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { keyedDataUrl, isHostedWebClient } from "../connections/adjacent-cloud";
import { findBbox } from "./bbox";
import { parseDigitTrafficPayloadIncremental, parseOpenSkyPayloadIncremental } from "./parse";
import {
  DIGITRAFFIC_CONNECTION_ID,
  OPENSKY_CONNECTION_ID,
  type GeoBbox,
  type TrafficKind,
  type TrafficVehicle,
} from "./types";

const CLIENT = createThrottledFetch({
  requestsPerMinute: 12,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-traffic",
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

async function readJson(url: string): Promise<unknown> {
  const response = await CLIENT.fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function openskyUrl(bbox: GeoBbox): { desktop: string; keyPath: string; search: string } {
  const world = bbox.id === "world";
  const search = world
    ? ""
    : new URLSearchParams({
      lamin: String(bbox.lamin),
      lomin: String(bbox.lomin),
      lamax: String(bbox.lamax),
      lomax: String(bbox.lomax),
    }).toString();
  return {
    desktop: `https://opensky-network.org/api/states/all${search ? `?${search}` : ""}`,
    keyPath: "api/states/all",
    search,
  };
}

export async function loadAircraft(
  bboxId: string,
  options?: { onPartial?: (rows: TrafficVehicle[]) => void },
): Promise<TrafficVehicle[]> {
  const bbox = findBbox(bboxId);
  const target = openskyUrl(bbox);
  return withConnectionRequest(OPENSKY_CONNECTION_ID, "states", async () => {
    const url = isHostedWebClient()
      ? keyedDataUrl("opensky", target.keyPath, target.search)
      : target.desktop;
    return parseOpenSkyPayloadIncremental(await readJson(url), { onPartial: options?.onPartial });
  });
}

export async function loadShips(
  options?: { onPartial?: (rows: TrafficVehicle[]) => void },
): Promise<TrafficVehicle[]> {
  return withConnectionRequest(DIGITRAFFIC_CONNECTION_ID, "ais", async () => {
    const url = isHostedWebClient()
      ? keyedDataUrl("digitraffic-ais", "api/ais/v1/locations")
      : "https://meri.digitraffic.fi/api/ais/v1/locations";
    return parseDigitTrafficPayloadIncremental(await readJson(url), { onPartial: options?.onPartial });
  });
}

export async function loadTraffic(
  kind: TrafficKind,
  bboxId: string,
  options?: { onPartial?: (rows: TrafficVehicle[]) => void },
): Promise<TrafficVehicle[]> {
  return kind === "aircraft" ? loadAircraft(bboxId, options) : loadShips(options);
}
