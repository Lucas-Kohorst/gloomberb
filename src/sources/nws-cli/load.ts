import {
  cliProductCodeForIcao,
  firstFinalCliPrint,
  normalizeIcaoStation,
  parseNwsCliProductText,
} from "./parse";
import type { NwsCliPrint, NwsCliPrintSet } from "./types";
import { NWS_CLI_PROVIDER_ID, NWS_CLI_USER_AGENT } from "./types";

const NWS_API = "https://api.weather.gov";
const MAX_PRODUCTS_TO_SCAN = 24;
const MAX_HISTORY_DAYS = 30;

export interface NwsCliLoadOptions {
  icao: string;
  date?: string;
  days?: number;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

interface NwsProductSummary {
  id: string;
  issuanceTime?: string;
  "@id"?: string;
}

function nwsHeaders(userAgent: string): HeadersInit {
  return {
    Accept: "application/geo+json, application/json",
    "User-Agent": userAgent,
  };
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  userAgent: string,
): Promise<unknown> {
  const response = await fetchImpl(url, { headers: nwsHeaders(userAgent) });
  if (!response.ok) {
    throw new Error(`NWS request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

function graphItems(body: unknown): NwsProductSummary[] {
  if (!body || typeof body !== "object") return [];
  const graph = (body as { "@graph"?: unknown })["@graph"];
  if (!Array.isArray(graph)) return [];
  return graph.filter((item): item is NwsProductSummary => (
    !!item && typeof item === "object" && typeof (item as NwsProductSummary).id === "string"
  ));
}

function stationCwaAndCoords(body: unknown): { cwa: string | null; lat: number | null; lon: number | null } {
  if (!body || typeof body !== "object") return { cwa: null, lat: null, lon: null };
  const record = body as {
    properties?: { county?: string; forecast?: string };
    geometry?: { coordinates?: unknown };
  };
  const coords = record.geometry?.coordinates;
  let lon: number | null = null;
  let lat: number | null = null;
  if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
    lon = coords[0];
    lat = coords[1];
  }
  return { cwa: null, lat, lon };
}

function pointsCwa(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const cwa = (body as { properties?: { cwa?: unknown } }).properties?.cwa;
  return typeof cwa === "string" && /^[A-Z]{3}$/.test(cwa) ? cwa : null;
}

export async function resolveNwsCwa(
  icao: string,
  fetchImpl: typeof fetch,
  userAgent: string,
): Promise<string> {
  const station = await fetchJson(fetchImpl, `${NWS_API}/stations/${encodeURIComponent(icao)}`, userAgent);
  const { lat, lon } = stationCwaAndCoords(station);
  if (lat == null || lon == null) {
    throw new Error(`NWS station ${icao} has no coordinates.`);
  }
  const points = await fetchJson(
    fetchImpl,
    `${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
    userAgent,
  );
  const cwa = pointsCwa(points);
  if (!cwa) throw new Error(`NWS CWA not found for ${icao}.`);
  return cwa;
}

function productText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const text = (body as { productText?: unknown }).productText;
  return typeof text === "string" ? text : "";
}

function issuanceTime(body: unknown, fallback?: string): string | null {
  if (body && typeof body === "object") {
    const value = (body as { issuanceTime?: unknown }).issuanceTime;
    if (typeof value === "string") return value;
  }
  return fallback ?? null;
}

export async function loadNwsCliPrints(options: NwsCliLoadOptions): Promise<NwsCliPrintSet> {
  const icao = normalizeIcaoStation(options.icao);
  if (!icao) throw new Error("ICAO station is required.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? NWS_CLI_USER_AGENT;
  const cliProduct = cliProductCodeForIcao(icao);
  const cwa = await resolveNwsCwa(icao, fetchImpl, userAgent);
  const listing = await fetchJson(
    fetchImpl,
    `${NWS_API}/products/types/CLI/locations/${encodeURIComponent(cwa)}`,
    userAgent,
  );
  const products = graphItems(listing).slice(0, MAX_PRODUCTS_TO_SCAN);
  const parsed: NwsCliPrint[] = [];
  for (const product of products) {
    const sourceUrl = product["@id"] ?? `${NWS_API}/products/${product.id}`;
    const body = await fetchJson(fetchImpl, sourceUrl, userAgent);
    const text = productText(body);
    if (!text.includes(cliProduct) && !text.includes(icao) && !text.includes(icao.slice(1))) {
      continue;
    }
    const print = parseNwsCliProductText(text, {
      icao,
      issuedAt: issuanceTime(body, product.issuanceTime),
      productId: product.id,
      sourceUrl,
    });
    if (print && print.cliProduct === cliProduct) parsed.push(print);
  }

  const days = options.days && Number.isFinite(options.days)
    ? Math.min(Math.max(Math.trunc(options.days), 1), MAX_HISTORY_DAYS)
    : null;

  let prints: NwsCliPrint[];
  if (options.date) {
    const first = firstFinalCliPrint(parsed, options.date);
    prints = first ? [first] : [];
  } else if (days) {
    const byDate = new Map<string, NwsCliPrint>();
    for (const print of parsed) {
      if (print.printKind !== "final") continue;
      const existing = byDate.get(print.date);
      if (!existing) {
        byDate.set(print.date, print);
        continue;
      }
      const chosen = firstFinalCliPrint([existing, print], print.date);
      if (chosen) byDate.set(print.date, chosen);
    }
    prints = [...byDate.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, days)
      .sort((left, right) => left.date.localeCompare(right.date));
  } else {
    const first = firstFinalCliPrint(parsed);
    prints = first ? [first] : [];
  }

  return {
    provider: NWS_CLI_PROVIDER_ID,
    seriesId: icao,
    icao,
    prints,
  };
}
