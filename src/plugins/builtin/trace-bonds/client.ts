import { httpFetch } from "../../../utils/http-transport";

const ENDPOINT = "https://services-dynarep.ddwa.finra.org/public/reporting/v2/data/group/FixedIncomeMarket/name/corporateAndAgencySecurities";
const PAGE_SIZE = 100;
const FETCH_TIMEOUT_MS = 20_000;

const REQUEST_HEADERS = {
  Accept: "application/json",
  Origin: "https://www.finra.org",
  Referer: "https://www.finra.org/finra-data/fixed-income/corp-and-agency/trade",
  "User-Agent": "gloomberb",
};

const BOND_FIELDS = [
  "issuerName",
  "couponRate",
  "maturityDate",
  "lastSalePrice",
  "lastSaleYield",
  "priceChangeNumber",
  "lastTradeDate",
  "traceGradeCode",
  "cusip",
  "issueSymbolIdentifier",
];

export interface CorporateBond {
  id: string;
  issuerName: string;
  couponRate: number | null;
  maturityDate: string | null;
  lastSalePrice: number | null;
  lastSaleYield: number | null;
  priceChangeNumber: number | null;
  lastTradeDate: string | null;
  traceGradeCode: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function scrubVendor(text: string): string {
  return text.replace(/\b(?:FINRA|TRACE)\b/gi, " ").replace(/\s+/g, " ").trim();
}

function failureText(status: number, detail: string): string {
  const cleaned = scrubVendor(detail);
  return cleaned ? `Bond tape request failed (${status}): ${cleaned}` : `Bond tape request failed (${status})`;
}

function failureDetail(payload: unknown): string {
  const record = asRecord(payload);
  return asText(record?.statusMessage) ?? asText(record?.message) ?? "";
}

/** Abort on the caller's signal or the timeout. AbortSignal.any is missing on older desktop webviews. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted || timeout.aborted) {
    abort();
    return controller.signal;
  }
  signal.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function xsrfToken(response: Response): string | null {
  const listed = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const header = response.headers.get("set-cookie");
  const cookies = listed.length > 0 ? listed : header ? [header] : [];
  for (const cookie of cookies) {
    const match = /XSRF-TOKEN=([^;,\s]+)/.exec(cookie);
    if (match?.[1]) return match[1];
  }
  return null;
}

function dataRows(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (typeof data !== "string") return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Rows from a reporting envelope. Null when the payload is not that shape. */
export function corporateBondPayloadRows(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return null;
  if ("data" in record) return dataRows(record.data);
  const body = asRecord(record.returnBody);
  if (body && "data" in body) return dataRows(body.data);
  return null;
}

function bondId(raw: Record<string, unknown>, index: number): string {
  return asText(raw.cusip)
    ?? asText(raw.issueSymbolIdentifier)
    ?? `${asText(raw.issuerName) ?? ""}|${asText(raw.maturityDate) ?? ""}|${index}`;
}

function parseBond(raw: unknown, index: number, seen: Map<string, number>): CorporateBond | null {
  const record = asRecord(raw);
  if (!record) return null;
  const base = bondId(record, index);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return {
    id: count === 0 ? base : `${base}#${count + 1}`,
    issuerName: asText(record.issuerName) ?? "",
    couponRate: asNumber(record.couponRate),
    maturityDate: asDate(record.maturityDate),
    lastSalePrice: asNumber(record.lastSalePrice),
    lastSaleYield: asNumber(record.lastSaleYield),
    priceChangeNumber: asNumber(record.priceChangeNumber),
    lastTradeDate: asDate(record.lastTradeDate),
    traceGradeCode: asText(record.traceGradeCode),
  };
}

function byLastTrade(left: CorporateBond, right: CorporateBond): number {
  if (left.lastTradeDate === right.lastTradeDate) return 0;
  if (left.lastTradeDate == null) return 1;
  if (right.lastTradeDate == null) return -1;
  return left.lastTradeDate < right.lastTradeDate ? 1 : -1;
}

/**
 * One page of bonds from a reporting payload, newest last sale first.
 * An unrecognized payload is an empty page; the fetch rejects that case.
 */
export function parseCorporateBondTape(payload: unknown): CorporateBond[] {
  const rows = corporateBondPayloadRows(payload);
  if (!rows) return [];
  const seen = new Map<string, number>();
  return rows
    .map((row, index) => parseBond(row, index, seen))
    .filter((bond): bond is CorporateBond => bond !== null)
    .sort(byLastTrade)
    .slice(0, PAGE_SIZE);
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(failureText(response.status, text.slice(0, 180)));
  }
}

/**
 * The dataset ignores `compareFields`. `compareFilters` is what drops bonds
 * with no last sale, which a descending sort otherwise returns first.
 * The route also refuses the body until the session cookie is echoed.
 */
async function postBondPage(signal: AbortSignal): Promise<unknown> {
  const session = await httpFetch(ENDPOINT, { headers: REQUEST_HEADERS, signal });
  const token = xsrfToken(session);
  await session.body?.cancel().catch(() => {});
  if (!token) throw new Error(failureText(session.status, "session"));

  const response = await httpFetch(ENDPOINT, {
    method: "POST",
    headers: {
      ...REQUEST_HEADERS,
      "Content-Type": "application/json",
      "X-XSRF-TOKEN": token,
      Cookie: `XSRF-TOKEN=${token}`,
    },
    body: JSON.stringify({
      fields: BOND_FIELDS,
      compareFilters: [{ fieldName: "lastTradeDate", compareType: "GREATER", fieldValue: "1900-01-01" }],
      sortFields: ["-lastTradeDate"],
      limit: PAGE_SIZE,
      offset: 0,
    }),
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok || asRecord(payload)?.status === "failure") {
    throw new Error(failureText(response.status, failureDetail(payload)));
  }
  if (corporateBondPayloadRows(payload) == null) {
    throw new Error("Bond tape response was not recognized");
  }
  return payload;
}

/** The latest page of corporate and agency bond sales. One hundred rows, not the whole market. */
export async function fetchCorporateBonds(signal?: AbortSignal): Promise<CorporateBond[]> {
  const payload = await postBondPage(withTimeout(signal, FETCH_TIMEOUT_MS));
  return parseCorporateBondTape(payload);
}
