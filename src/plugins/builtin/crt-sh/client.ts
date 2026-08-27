import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  CRT_SH_API_BASE_URL,
  CRT_SH_CONNECTION_ID,
  type CertificateRecord,
  type CertSearchPage,
} from "./types";

export const CERT_DISPLAY_CAP = 250;
export const CERT_FIRST_PAINT = 60;
export const CERT_YIELD_EVERY = 200;

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const crtFetch = createThrottledFetch({
  requestsPerMinute: 10,
  maxRetries: 2,
  timeoutMs: 30_000,
  backoffBaseMs: 1_000,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-crt-sh",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asDate(value: unknown): Date {
  const date = new Date(typeof value === "string" || typeof value === "number" ? value : 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function parseRecord(raw: unknown): CertificateRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "number" ? record.id : Number(record.id);
  if (!Number.isFinite(id)) return null;
  const nameValues = asString(record.name_value)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    id,
    issuerName: asString(record.issuer_name),
    commonName: asString(record.common_name),
    nameValues,
    entryTimestamp: asDate(record.entry_timestamp),
    notBefore: asDate(record.not_before),
    notAfter: asDate(record.not_after),
    serialNumber: asString(record.serial_number),
  };
}

export async function parseCertificateRecords(
  payload: unknown,
  options: {
    cap?: number;
    firstPaint?: number;
    yieldEvery?: number;
    onPartial?: (records: CertificateRecord[]) => void;
  } = {},
): Promise<{ records: CertificateRecord[]; total: number }> {
  if (!Array.isArray(payload)) return { records: [], total: 0 };
  const cap = options.cap ?? CERT_DISPLAY_CAP;
  const firstPaint = options.firstPaint ?? CERT_FIRST_PAINT;
  const yieldEvery = options.yieldEvery ?? CERT_YIELD_EVERY;
  const records: CertificateRecord[] = [];
  const seen = new Set<number>();
  let painted = false;
  for (let i = 0; i < payload.length; i++) {
    const record = parseRecord(payload[i]);
    if (record && !seen.has(record.id)) {
      seen.add(record.id);
      records.push(record);
      if (!painted && records.length >= firstPaint) {
        painted = true;
        options.onPartial?.(records.slice());
      }
      if (records.length >= cap) break;
    }
    if ((i + 1) % yieldEvery === 0) await yieldToUi();
  }
  return { records, total: payload.length };
}

export class CrtShClient {
  async searchCertificates(
    domain: string,
    onPartial?: (records: CertificateRecord[]) => void,
  ): Promise<CertSearchPage> {
    return withConnectionRequest(CRT_SH_CONNECTION_ID, "fetch", async () => {
      const query = domain.trim();
      const url = `${CRT_SH_API_BASE_URL}/?q=${encodeURIComponent(query)}&output=json`;
      const response = await crtFetch.fetch(url);
      if (!response.ok) {
        throw new Error(`crt.sh request failed: ${response.status} ${response.statusText}`);
      }
      const parsed = await parseCertificateRecords(await response.json(), { onPartial });
      return { records: parsed.records, total: parsed.total, uniqueDomains: [] };
    });
  }
}
