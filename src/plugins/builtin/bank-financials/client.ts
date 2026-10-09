import { httpFetch } from "../../../utils/http-transport";
import type { BankBalance, BankBoard } from "./model";

const FETCH_TIMEOUT_MS = 15_000;
/** Published figures are thousands of dollars; one billion is a million of those. */
const THOUSANDS_PER_BILLION = 1_000_000;

const BOARD_URL = "https://banks.data.fdic.gov/api/institutions?filters=ACTIVE:1&fields=NAME,CERT,ASSET,DEP,STNAME,REPDTE&sort_by=ASSET&sort_order=DESC&limit=40&output=json";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `06/30/2026` from the institution board, or `20260630` from a financials row. */
export function parseReportDate(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return isoDate(Number(slash[3]), Number(slash[1]), Number(slash[2]));
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return isoDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

function toBillions(value: unknown): number | null {
  const thousands = asNumber(value);
  return thousands == null ? null : thousands / THOUSANDS_PER_BILLION;
}

function latestReportDate(banks: readonly BankBalance[]): string | null {
  let latest: string | null = null;
  for (const bank of banks) {
    if (bank.reportDate && (latest == null || bank.reportDate > latest)) latest = bank.reportDate;
  }
  return latest;
}

/**
 * Parse an institutions payload. Rows are `{ data: { NAME, CERT, ... }, score }`;
 * the fields live on the inner `data`, not the wrapper.
 */
export function parseBankBoard(payload: unknown): BankBoard {
  const root = asRecord(payload);
  const rows = Array.isArray(root?.data) ? root.data : [];
  const banks: BankBalance[] = [];
  for (const row of rows) {
    const data = asRecord(asRecord(row)?.data);
    if (!data) continue;
    const name = asString(data.NAME);
    if (!name) continue;
    const cert = asNumber(data.CERT);
    banks.push({
      id: cert != null ? String(cert) : asString(data.ID) ?? name,
      name,
      state: asString(data.STNAME) ?? "",
      assets: toBillions(data.ASSET),
      deposits: toBillions(data.DEP),
      reportDate: parseReportDate(data.REPDTE),
    });
  }
  return { banks, reportDate: latestReportDate(banks) };
}

export async function fetchBankBoard(signal?: AbortSignal): Promise<BankBoard> {
  const response = await httpFetch(BOARD_URL, {
    headers: { Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Bank balance sheet request failed (${response.status})`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Bank balance sheet response was not recognized");
  }
  if (!Array.isArray(asRecord(payload)?.data)) {
    throw new Error("Bank balance sheet response was not recognized");
  }
  return parseBankBoard(payload);
}
