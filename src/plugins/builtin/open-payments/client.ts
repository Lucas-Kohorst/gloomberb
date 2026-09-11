import { httpFetch } from "../../../utils/http-transport";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  OPEN_PAYMENTS_API_BASE_URL,
  OPEN_PAYMENTS_CONNECTION_ID,
  OPEN_PAYMENTS_GENERAL_PAYMENTS_DATASET_ID,
  type OpenPayment,
  type OpenPaymentsPage,
} from "./types";

export const OPEN_PAYMENTS_DISPLAY_CAP = 50;
/**
 * Text (company/recipient) queries filter client-side: the 16M-row table has
 * no usable index on name columns — server-side `like` and amount sorts time
 * out — so we pull a wider window and match locally. Same trade-off as the
 * USGS plugin's client-side place filter. NPI and state codes hit indexed
 * equality filters server-side and stay exact at any scale.
 */
export const OPEN_PAYMENTS_TEXT_SEARCH_WINDOW = 200;

/** DKAN `properties` selection: only the columns the pane renders. */
const PAYMENT_PROPERTIES = [
  "record_id",
  "covered_recipient_first_name",
  "covered_recipient_last_name",
  "teaching_hospital_name",
  "covered_recipient_npi",
  "recipient_city",
  "recipient_state",
  "applicable_manufacturer_or_applicable_gpo_making_payment_name",
  "total_amount_of_payment_usdollars",
  "date_of_payment",
  "nature_of_payment_or_transfer_of_value",
  "form_of_payment_or_transfer_of_value",
  "name_of_drug_or_biological_or_device_or_medical_supply_1",
  "product_category_or_therapeutic_area_1",
  "program_year",
] as const;

// Reads are free and keyless; the table is huge, so stay gentle and patient.
const openPaymentsFetch = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 20_000,
  backoffBaseMs: 1_000,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-open-payments",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,]/g, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function titleCaseWord(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** "SMITH" -> "Smith", "McDONALD" left alone only if already mixed case. */
function personName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed.split(/\s+/).map(titleCaseWord).join(" ");
}

function recipientDisplayName(record: Record<string, unknown>): {
  name: string;
  firstName: string;
  lastName: string;
} {
  const hospital = asString(record.teaching_hospital_name);
  if (hospital) return { name: hospital, firstName: "", lastName: hospital };
  const firstName = personName(asString(record.covered_recipient_first_name));
  const lastName = personName(asString(record.covered_recipient_last_name));
  const suffix = asString(record.covered_recipient_name_suffix);
  const name = [firstName, lastName, suffix].filter(Boolean).join(" ");
  return { name, firstName, lastName };
}

export function parsePayment(raw: unknown): OpenPayment | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const { name, firstName, lastName } = recipientDisplayName(record);
  const companyName = asString(
    record.applicable_manufacturer_or_applicable_gpo_making_payment_name,
  );
  if (!name && !companyName) return null;
  const npi = asString(record.covered_recipient_npi);
  const amount = asAmount(record.total_amount_of_payment_usdollars);
  const date = asDateOrNull(record.date_of_payment);
  const recordId = asString(record.record_id);
  // Deterministic fallback when record_id is absent.
  const id = recordId || [npi, companyName, name, amount, date?.getTime() ?? ""]
    .filter((part) => part !== "" && part !== null)
    .join("|");
  if (!id) return null;
  return {
    id,
    recipientName: name,
    recipientFirstName: firstName,
    recipientLastName: lastName,
    recipientCity: personName(asString(record.recipient_city)),
    recipientState: asString(record.recipient_state).toUpperCase(),
    npi,
    companyName,
    amount,
    date,
    nature: asString(record.nature_of_payment_or_transfer_of_value),
    form: asString(record.form_of_payment_or_transfer_of_value),
    productName: asString(
      record.name_of_drug_or_biological_or_device_or_medical_supply_1,
    ),
    productCategory: asString(record.product_category_or_therapeutic_area_1),
    programYear: asString(record.program_year),
  };
}

/**
 * Parse a DKAN datastore query payload (`{ results: [...], count }`).
 * Tolerates a bare row array for forward compatibility.
 */
export function parsePaymentsPayload(
  payload: unknown,
  cap = OPEN_PAYMENTS_DISPLAY_CAP,
): OpenPaymentsPage {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const rawList = Array.isArray(root.results)
    ? root.results
    : Array.isArray(payload)
      ? payload
      : [];
  const payments: OpenPayment[] = [];
  for (const raw of rawList) {
    const payment = parsePayment(raw);
    if (!payment) continue;
    payments.push(payment);
    if (payments.length >= cap) break;
  }
  const total = typeof root.count === "number" && Number.isFinite(root.count)
    ? root.count
    : null;
  return { payments, total };
}

/** NPI fragment: digits only — served by an indexed server-side equality. */
export function isNpiQuery(query: string): boolean {
  return /^\d{5,10}$/.test(query.trim());
}

/** Two-letter code — served by an indexed server-side state equality. */
export function isStateQuery(query: string): boolean {
  return /^[A-Za-z]{2}$/.test(query.trim());
}

/**
 * Build the DKAN datastore query URL. Indexed queries (NPI / state) filter
 * server-side via `conditions` — the DKAN equivalent of a SoQL `$where`
 * equality. Free-text queries carry no conditions: rows are matched locally
 * with matchesQuery because unindexed `like` scans time out on this table.
 */
export function buildQueryUrl(query: string, limit: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  PAYMENT_PROPERTIES.forEach((property, index) => {
    params.set(`properties[${index}]`, property);
  });
  const trimmed = query.trim();
  if (isNpiQuery(trimmed)) {
    params.set("conditions[0][property]", "covered_recipient_npi");
    params.set("conditions[0][value]", trimmed);
    params.set("conditions[0][operator]", "=");
  } else if (isStateQuery(trimmed)) {
    params.set("conditions[0][property]", "recipient_state");
    params.set("conditions[0][value]", trimmed.toUpperCase());
    params.set("conditions[0][operator]", "=");
  }
  return `${OPEN_PAYMENTS_API_BASE_URL}/datastore/query/${OPEN_PAYMENTS_GENERAL_PAYMENTS_DATASET_ID}/0?${params.toString()}`;
}

/**
 * Client-side substring match across company and recipient fields — the
 * stand-in for a SoQL `$q` full-text search, which this table cannot serve.
 */
export function matchesQuery(payment: OpenPayment, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    payment.companyName,
    payment.recipientName,
    payment.recipientFirstName,
    payment.recipientLastName,
    payment.recipientCity,
    payment.recipientState,
    payment.npi,
    payment.productName,
    payment.productCategory,
    payment.nature,
  ].join("\n").toLowerCase();
  return needle.split(/\s+/).every((token) => haystack.includes(token));
}

export class OpenPaymentsClient {
  async listPayments(options: {
    searchQuery?: string;
    limit?: number;
    signal?: AbortSignal;
  }): Promise<OpenPaymentsPage> {
    const searchQuery = (options.searchQuery ?? "").trim();
    const limit = options.limit ?? OPEN_PAYMENTS_DISPLAY_CAP;
    const indexed = searchQuery !== "" && (isNpiQuery(searchQuery) || isStateQuery(searchQuery));
    const operation = searchQuery ? "search" : "fetch";
    return withConnectionRequest(OPEN_PAYMENTS_CONNECTION_ID, operation, async () => {
      // Text queries need a wider window since matching happens locally.
      const fetchLimit = searchQuery && !indexed
        ? Math.max(limit, OPEN_PAYMENTS_TEXT_SEARCH_WINDOW)
        : limit;
      const response = await openPaymentsFetch.fetch(buildQueryUrl(searchQuery, fetchLimit), {
        signal: options.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Open Payments request failed: ${response.status} ${response.statusText}`,
        );
      }
      const page = parsePaymentsPayload(await response.json(), fetchLimit);
      if (!searchQuery || indexed) {
        return { payments: page.payments.slice(0, limit), total: page.total };
      }
      const filtered = page.payments.filter((payment) => matchesQuery(payment, searchQuery));
      return { payments: filtered.slice(0, limit), total: page.total };
    });
  }
}
