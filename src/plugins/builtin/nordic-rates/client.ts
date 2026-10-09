import { httpFetch } from "../../../utils/http-transport";
import {
  segmentLabel,
  type NordicBondYield,
  type NordicMortgageRate,
} from "./model";

const MORTGAGE_URL = "https://api.nasdaq.com/api/nordic/mortgage-rates?lang=en";
const YIELD_URL = "https://api.nasdaq.com/api/nordic/average-yield?lang=en";
/** The before-tax grid. After-tax yields are a separate table. */
const YIELD_BASIS = "beforeTax";
const EFFECTIVE_YIELD = new Set(["Effektiv rente", "Effective yield"]);
const FETCH_TIMEOUT_MS = 15_000;

const REQUEST_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/",
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

const MORTGAGE_UNAVAILABLE = "Mortgage rates unavailable";
const YIELD_UNAVAILABLE = "Bond yields unavailable";
const REJECTED = "Nordic rates request was rejected";
const MORTGAGE_UNRECOGNIZED = "Mortgage rates were not recognized";
const YIELD_UNRECOGNIZED = "Bond yields were not recognized";

export interface NordicRatesBoard {
  /** Bond-grid reporting date. Mortgage quotes do not publish one. */
  asOf: string | null;
  mortgages: NordicMortgageRate[];
  yields: NordicBondYield[];
  mortgageError: string | null;
  yieldError: string | null;
}

export interface NordicBondYields {
  asOf: string | null;
  yields: NordicBondYield[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function message(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function payloadData(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  if (!record) throw new Error("Nordic rates response was not JSON");
  const status = asRecord(record.status);
  if (status && "rCode" in status && status.rCode !== 200) throw new Error(REJECTED);
  return asRecord(record.data) ?? record;
}

/** A published percent, or null for a blank or placeholder cell. Zero is a value. */
function publishedRate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text === "---") return null;
  const rate = Number(text.replace(/,/g, ""));
  return Number.isFinite(rate) ? rate : null;
}

function headerText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseMortgageRates(payload: unknown): NordicMortgageRate[] {
  const block = asRecord(payloadData(payload).mortgageRates);
  const headers = asRecord(block?.headers);
  const rows = block?.rows;
  if (!headers || !Array.isArray(rows)) throw new Error(MORTGAGE_UNRECOGNIZED);
  const terms = Object.keys(headers).filter((key) => key !== "fullName" && key !== "url");
  if (terms.length === 0) throw new Error(MORTGAGE_UNRECOGNIZED);

  const rates: NordicMortgageRate[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    const lender = typeof row?.fullName === "string" ? row.fullName.trim() : "";
    if (!row || !lender) continue;
    for (const key of terms) {
      const term = headerText(headers[key]);
      const rate = publishedRate(row[key]);
      if (!term || rate == null) continue;
      rates.push({ id: `${lender}|${term}`, lender, term, rate });
    }
  }
  return rates;
}

export function parseBondYields(payload: unknown): NordicBondYields {
  const data = payloadData(payload);
  const block = asRecord(data[YIELD_BASIS]);
  const headers = asRecord(block?.headers);
  const sections = block?.sections;
  if (!headers || !Array.isArray(sections)) throw new Error(YIELD_UNRECOGNIZED);
  const maturities = Object.keys(headers).filter((key) => key !== "attribute");
  if (maturities.length === 0) throw new Error(YIELD_UNRECOGNIZED);

  const asOf = typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
  const yields: NordicBondYield[] = [];
  let sawYield = false;
  for (const rawSection of sections) {
    const section = asRecord(rawSection);
    const segment = typeof section?.name === "string" ? segmentLabel(section.name) : "";
    const rows = section?.rows;
    if (!segment || !Array.isArray(rows)) continue;
    for (const raw of rows) {
      const row = asRecord(raw);
      const attribute = typeof row?.attribute === "string" ? row.attribute.trim() : "";
      if (!row || !EFFECTIVE_YIELD.has(attribute)) continue;
      sawYield = true;
      for (const key of maturities) {
        const maturity = headerText(headers[key]);
        const rate = publishedRate(row[key]);
        if (!maturity || rate == null) continue;
        yields.push({ id: `${segment}|${maturity}`, segment, maturity, yield: rate });
      }
    }
  }
  if (!sawYield && sections.length > 0) throw new Error(YIELD_UNRECOGNIZED);
  return { asOf, yields };
}

async function readJson(url: string, signal: AbortSignal | undefined, unavailable: string): Promise<unknown> {
  let response: Response;
  try {
    response = await httpFetch(url, {
      headers: REQUEST_HEADERS,
      signal: signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new Error(unavailable);
  }
  if (!response.ok) throw new Error(`${unavailable} (${response.status})`);
  try {
    return await response.json();
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new Error(`${unavailable}. Response was not JSON`);
  }
}

export async function fetchNordicRates(signal?: AbortSignal): Promise<NordicRatesBoard> {
  const [mortgageResult, yieldResult] = await Promise.allSettled([
    readJson(MORTGAGE_URL, signal, MORTGAGE_UNAVAILABLE).then(parseMortgageRates),
    readJson(YIELD_URL, signal, YIELD_UNAVAILABLE).then(parseBondYields),
  ]);
  if (mortgageResult.status === "rejected" && yieldResult.status === "rejected") {
    if (isAbort(mortgageResult.reason) || isAbort(yieldResult.reason)) throw mortgageResult.reason;
    throw new Error(`${message(mortgageResult.reason, MORTGAGE_UNAVAILABLE)} ${message(yieldResult.reason, YIELD_UNAVAILABLE)}`);
  }
  const bond = yieldResult.status === "fulfilled" ? yieldResult.value : null;
  return {
    asOf: bond?.asOf ?? null,
    mortgages: mortgageResult.status === "fulfilled" ? mortgageResult.value : [],
    yields: bond?.yields ?? [],
    mortgageError: mortgageResult.status === "rejected" ? message(mortgageResult.reason, MORTGAGE_UNAVAILABLE) : null,
    yieldError: yieldResult.status === "rejected" ? message(yieldResult.reason, YIELD_UNAVAILABLE) : null,
  };
}
