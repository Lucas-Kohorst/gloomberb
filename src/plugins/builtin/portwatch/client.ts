import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import {
  SHIPPING_ROW_CAP,
  emptyShippingLayer,
  type ShippingBoard,
  type ShippingLayer,
  type ShippingRow,
} from "./model";

const SERVICES_URL = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services";
const PORTS_SERVICE = "PortWatch_ports_database";
const SAFE_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

const shippingFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: 20_000,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

interface FieldInfo {
  name: string;
  type: string;
}

const NAME_FIELDS = ["portname", "name", "fullname", "port_name", "label", "title"];
const COUNTRY_FIELDS = ["country", "countrynoaccents", "country_name"];
const ISO_FIELDS = ["iso3", "ISO3"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function isServiceError(payload: unknown): boolean {
  const error = asRecord(payload)?.error;
  return typeof error === "string" || (error != null && typeof error === "object");
}

function declaredFields(payload: unknown): FieldInfo[] {
  const fields = asRecord(payload)?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    const record = asRecord(field);
    const name = record?.name;
    if (typeof name !== "string" || !name.trim()) return [];
    return [{ name, type: typeof record?.type === "string" ? record.type : "" }];
  });
}

function pickField(names: readonly string[], candidates: readonly string[]): string | null {
  const byLower = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const candidate of candidates) {
    const found = byLower.get(candidate.toLowerCase());
    if (found) return found;
  }
  return null;
}

function numericField(field: FieldInfo, samples: readonly Record<string, unknown>[]): boolean {
  if (/objectid|^lat$|^lon$|^latitude$|^longitude$/i.test(field.name)) return false;
  if (/oid/i.test(field.type)) return false;
  if (/integer|double|single|float|decimal/i.test(field.type)) return true;
  return samples.some((sample) => typeof sample[field.name] === "number" && Number.isFinite(sample[field.name]));
}

function volumeRank(name: string): number | null {
  const lower = name.toLowerCase();
  if (lower === "vessel_count_total") return 0;
  if (lower.includes("call")) return 1;
  if (lower.includes("volume")) return 2;
  if (lower.includes("vessel_count")) return 3;
  if (lower.includes("count")) return 4;
  return null;
}

function volumeHeaderFor(fieldName: string): string {
  const lower = fieldName.toLowerCase();
  if (lower.includes("call") || lower.includes("vessel") || lower.includes("count")) return "Calls";
  if (lower.includes("volume")) return "Volume";
  return fieldName.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function chooseVolume(fields: readonly FieldInfo[], samples: readonly Record<string, unknown>[]): string | null {
  let best: { name: string; rank: number } | null = null;
  for (const field of fields) {
    const rank = volumeRank(field.name);
    if (rank == null || !numericField(field, samples)) continue;
    if (!best || rank < best.rank) best = { name: field.name, rank };
  }
  return best?.name ?? null;
}

function dateRank(field: FieldInfo): number | null {
  const lower = field.name.toLowerCase();
  if (/as_?of/.test(lower)) return 0;
  if (lower.includes("updated") || lower.includes("observed")) return 1;
  if (lower === "year" || lower.endsWith("_year")) return 2;
  if (lower.includes("date") || lower.includes("timestamp")) return 3;
  if (/date/i.test(field.type)) return 4;
  return null;
}

function chooseDate(fields: readonly FieldInfo[]): string | null {
  let best: { name: string; rank: number } | null = null;
  for (const field of fields) {
    const rank = dateRank(field);
    if (rank == null) continue;
    if (!best || rank < best.rank) best = { name: field.name, rank };
  }
  return best?.name ?? null;
}

function formatAsOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1900 && value <= 2100 && Number.isInteger(value)) return String(value);
    const ms = value > 1e11 ? value : value > 1e9 ? value * 1000 : Number.NaN;
    if (!Number.isFinite(ms)) return null;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (day) return day[1] ?? null;
  if (/^\d{4}$/.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function featureAttributes(payload: unknown): Record<string, unknown>[] {
  if (isServiceError(payload)) throw new Error("The shipping volume request was rejected.");
  const features = asRecord(payload)?.features;
  if (!Array.isArray(features)) throw new Error("Shipping volumes came back in an unexpected shape.");
  const attributes = features.flatMap((feature) => {
    const row = asRecord(asRecord(feature)?.attributes);
    return row ? [row] : [];
  });
  if (features.length > 0 && attributes.length === 0) {
    throw new Error("Shipping volumes came back in an unexpected shape.");
  }
  return attributes;
}

function fieldsFor(payload: unknown, samples: readonly Record<string, unknown>[]): FieldInfo[] {
  const declared = declaredFields(payload);
  if (declared.length > 0) return declared;
  const names = new Set<string>();
  for (const sample of samples) for (const name of Object.keys(sample)) names.add(name);
  return [...names].map((name) => ({ name, type: "" }));
}

export function parseFeatureLayer(payload: unknown): ShippingLayer {
  const samples = featureAttributes(payload);
  const fields = fieldsFor(payload, samples);
  const names = fields.map((field) => field.name);
  const nameField = pickField(names, NAME_FIELDS);
  if (samples.length > 0 && !nameField) throw new Error("Shipping volumes came back in an unexpected shape.");
  const countryField = pickField(names, COUNTRY_FIELDS);
  const isoField = pickField(names, ISO_FIELDS);
  const volumeField = chooseVolume(fields, samples);
  const dateField = chooseDate(fields);
  const seen = new Set<string>();
  const rows: ShippingRow[] = [];
  let asOf: string | null = null;
  for (const sample of samples) {
    const name = nameField ? text(sample[nameField]) : "";
    if (!name) continue;
    const country = (countryField ? text(sample[countryField]) : "") || (isoField ? text(sample[isoField]) : "");
    const rawVolume = volumeField ? sample[volumeField] : null;
    const volume = typeof rawVolume === "number" && Number.isFinite(rawVolume) ? rawVolume : null;
    const dated = dateField ? formatAsOf(sample[dateField]) : null;
    if (dated && (asOf == null || dated > asOf)) asOf = dated;
    const base = text(sample.portid) || text(sample.PortId) || text(sample.ObjectId) || text(sample.objectid) || name;
    let id = base;
    let n = 2;
    while (seen.has(id)) id = `${base}:${n++}`;
    seen.add(id);
    rows.push({ id, name, country, volume });
  }
  rows.sort((left, right) => {
    if (left.volume == null && right.volume == null) return left.name.localeCompare(right.name);
    if (left.volume == null) return 1;
    if (right.volume == null) return -1;
    return right.volume - left.volume || left.name.localeCompare(right.name);
  });
  return {
    rows: rows.slice(0, SHIPPING_ROW_CAP),
    volumeHeader: volumeField ? volumeHeaderFor(volumeField) : null,
    asOf,
    error: null,
  };
}

export function chokepointServiceName(catalog: unknown): string | null {
  const services = asRecord(catalog)?.services;
  if (!Array.isArray(services)) return null;
  const matches = services.flatMap((service) => {
    const record = asRecord(service);
    const name = record?.name;
    if (typeof name !== "string" || !/chokepoint/i.test(name) || record?.type !== "FeatureServer") return [];
    const score = (/database/i.test(name) ? 0 : 2) + (/view|tile|boundar/i.test(name) ? 1 : 0);
    return [{ name, score }];
  });
  matches.sort((left, right) => left.score - right.score || left.name.length - right.name.length);
  return matches[0]?.name ?? null;
}

function preferredOrder(payload: unknown): string {
  const volume = chooseVolume(declaredFields(payload), []);
  if (volume && SAFE_FIELD.test(volume)) return `${volume} DESC`;
  const name = pickField(declaredFields(payload).map((field) => field.name), NAME_FIELDS);
  if (name && SAFE_FIELD.test(name)) return name;
  return "portname";
}

function queryUrl(serviceName: string, orderBy: string): string {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    resultRecordCount: String(SHIPPING_ROW_CAP),
    orderByFields: orderBy,
    returnGeometry: "false",
    f: "json",
  });
  return `${SERVICES_URL}/${encodeURIComponent(serviceName)}/FeatureServer/0/query?${params.toString()}`;
}

async function readJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await shippingFetch.fetch(url, { signal });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new Error("Shipping volumes could not be loaded.");
  }
  if (!response.ok) throw new Error("Shipping volumes could not be loaded.");
  try {
    const payload = await response.json() as unknown;
    if (isServiceError(payload)) throw new Error("The shipping volume request was rejected.");
    return payload;
  } catch (error) {
    if (isAbort(error) || (error instanceof Error && /rejected|could not be loaded/.test(error.message))) throw error;
    throw new Error("Shipping volumes came back in an unexpected shape.");
  }
}

async function orderField(serviceName: string, signal?: AbortSignal): Promise<string> {
  try {
    return preferredOrder(await readJson(`${SERVICES_URL}/${encodeURIComponent(serviceName)}/FeatureServer/0?f=json`, signal));
  } catch (error) {
    if (isAbort(error)) throw error;
    return "portname";
  }
}

async function loadLayer(serviceName: string, signal?: AbortSignal): Promise<ShippingLayer> {
  const orderBy = await orderField(serviceName, signal);
  try {
    return parseFeatureLayer(await readJson(queryUrl(serviceName, orderBy), signal));
  } catch (error) {
    if (isAbort(error) || orderBy === "portname") throw error;
    return parseFeatureLayer(await readJson(queryUrl(serviceName, "portname"), signal));
  }
}

async function loadLayerSafe(serviceName: string, signal?: AbortSignal): Promise<ShippingLayer> {
  try {
    return await loadLayer(serviceName, signal);
  } catch (error) {
    if (isAbort(error)) throw error;
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Shipping volumes could not be loaded.";
    return emptyShippingLayer(message.endsWith(".") ? message : `${message}.`);
  }
}

export async function fetchShippingBoard(signal?: AbortSignal): Promise<ShippingBoard> {
  const catalog = await readJson(`${SERVICES_URL}?f=json`, signal);
  const chokepoints = chokepointServiceName(catalog);
  const [ports, chokeLayer] = await Promise.all([
    loadLayerSafe(PORTS_SERVICE, signal),
    chokepoints ? loadLayerSafe(chokepoints, signal) : Promise.resolve(emptyShippingLayer("No chokepoint list was published.")),
  ]);
  return { ports, chokepoints: chokeLayer };
}
