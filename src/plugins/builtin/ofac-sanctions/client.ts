import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  OFAC_API_BASE_URL,
  OFAC_SANCTIONS_CONNECTION_ID,
  type SanctionsEntry,
  type SanctionsPage,
} from "./types";

export const SANCTIONS_DISPLAY_CAP = 50;

const sanctionsFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-ofac-sanctions",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result || undefined;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? asString(item) : undefined)
    .filter((item): item is string => item !== undefined);
}

function parseSourceLists(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return asString(item);
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    return asString(record.list) ?? asString(record.source);
  }).filter((item): item is string => item !== undefined);
}

function parseAddresses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return asString(item);
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    return [
      asString(record.address),
      asString(record.city),
      asString(record.state),
      asString(record.country),
    ].filter((part): part is string => part !== undefined).join(", ") || undefined;
  }).filter((item): item is string => item !== undefined);
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return asString(item);
    if (!item || typeof item !== "object") return undefined;
    const record = item as Record<string, unknown>;
    const type = asString(record.type);
    const number = asString(record.number);
    const country = asString(record.country);
    return [type, number, country ? `(${country})` : undefined]
      .filter((part): part is string => part !== undefined).join(" ") || undefined;
  }).filter((item): item is string => item !== undefined);
}

function parseEntry(value: unknown): SanctionsEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = asString(record.name);
  if (!name) return null;
  const type = record.type === "individual" ? "individual" : "entity";
  const id = asString(record.id) ?? name;
  return {
    id,
    name,
    type,
    sourceLists: parseSourceLists(record.source_list),
    altNames: asStrings(record.alt_names),
    addresses: parseAddresses(record.addresses),
    programs: asStrings(record.programs),
    remarks: asString(record.remarks) ?? "",
    nationalities: asStrings(record.nationalities),
    datesOfBirth: asStrings(record.dates_of_birth),
    ids: parseIds(record.ids),
  };
}

export class SanctionsClient {
  async searchEntries(query: string, signal?: AbortSignal): Promise<SanctionsPage> {
    return withConnectionRequest(OFAC_SANCTIONS_CONNECTION_ID, "fetch", async () => {
      const search = new URLSearchParams({ q: query.trim(), limit: "50" });
      const response = await sanctionsFetch.fetch(
        `${OFAC_API_BASE_URL}/consolidated_screening_list/search?${search.toString()}`,
        { signal },
      );
      if (!response.ok) {
        throw new Error(`OFAC sanctions request failed: ${response.status} ${response.statusText}`);
      }
      const payload = await response.json() as unknown;
      const record = payload && typeof payload === "object"
        ? payload as Record<string, unknown>
        : {};
      const rawResults = Array.isArray(record.results) ? record.results : [];
      const entries: SanctionsEntry[] = [];
      for (const raw of rawResults) {
        const entry = parseEntry(raw);
        if (!entry) continue;
        entries.push(entry);
        if (entries.length >= SANCTIONS_DISPLAY_CAP) break;
      }
      const total = typeof record.total === "number" && Number.isFinite(record.total)
        ? record.total
        : entries.length;
      return { entries, total };
    });
  }
}
