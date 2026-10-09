import { httpFetch } from "../../../utils/http-transport";

const BILL_LIST_URL = "https://api.congress.gov/v3/bill";
const NEWEST_BILL_COUNT = 40;
const FETCH_TIMEOUT_MS = 15_000;
const API_KEY_ERROR = "A Congress.gov API key is required";
const ACTION_DATE = /^(\d{4}-\d{2}-\d{2})/;

export interface CongressBill {
  id: string;
  number: string;
  title: string;
  actionDate: string;
  actionText: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asActionDate(value: unknown): string {
  return ACTION_DATE.exec(asText(value))?.[1] ?? "";
}

function readApiKey(): string | null {
  if (typeof process === "undefined") return null;
  const key = process.env?.CONGRESS_GOV_API_KEY?.trim();
  return key || null;
}

export function parseBills(payload: unknown): CongressBill[] {
  const bills = asRecord(payload)?.bills;
  if (!Array.isArray(bills)) return [];
  const parsed: Array<{ bill: CongressBill; updated: string; index: number }> = [];
  bills.forEach((raw, index) => {
    const record = asRecord(raw);
    if (!record) return;
    const type = asText(record.type).toLowerCase();
    const number = asText(record.number);
    if (!type || !number) return;
    const action = asRecord(record.latestAction);
    const congress = asText(record.congress) || "0";
    parsed.push({
      index,
      updated: asText(record.updateDateIncludingText) || asText(record.updateDate),
      bill: {
        id: `${congress}-${type}-${number}`,
        number: `${type} ${number}`,
        title: asText(record.title),
        actionDate: asActionDate(action?.actionDate),
        actionText: action ? asText(action.text) : "",
      },
    });
  });
  parsed.sort((a, b) => (
    b.updated.localeCompare(a.updated)
    || b.bill.actionDate.localeCompare(a.bill.actionDate)
    || a.index - b.index
  ));
  return parsed.slice(0, NEWEST_BILL_COUNT).map((entry) => entry.bill);
}

export async function fetchCongressBills(signal?: AbortSignal): Promise<CongressBill[]> {
  const key = readApiKey();
  if (!key) throw new Error(API_KEY_ERROR);
  const params = new URLSearchParams({
    format: "json",
    limit: String(NEWEST_BILL_COUNT),
    sort: "updateDate desc",
    api_key: key,
  });
  const response = await httpFetch(`${BILL_LIST_URL}?${params}`, {
    headers: { Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Bill list request failed (${response.status})`);
  const payload: unknown = await response.json();
  if (!Array.isArray(asRecord(payload)?.bills)) throw new Error("Bill list request failed");
  return parseBills(payload);
}
