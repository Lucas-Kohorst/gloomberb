import { httpFetch } from "../../../utils/http-transport";
import { readProcessEnv } from "../../../utils/process-env";
import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { withConnectionRequest } from "../connections/register";
import {
  EULERPOOL_API_BASE_URL,
  EULERPOOL_CONNECTION_ID,
  EULERPOOL_SITE_BASE_URL,
  type EulerpoolCashFlowPeriod,
  type EulerpoolFundamentals,
  type EulerpoolIncomePeriod,
  type EulerpoolProfile,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const INCOME_DISPLAY_CAP = 16;

const eulerpoolFetch = createThrottledFetch({
  requestsPerMinute: 30,
  maxRetries: 2,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  backoffBaseMs: 500,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-eulerpool",
  },
  transport: (url: string, init?: RequestInit) => httpFetch(url, init),
});

let resolveApiKey: () => string | undefined = () => readProcessEnv("EULERPOOL_API_KEY");

export function setEulerpoolApiKeyResolver(resolver: () => string | undefined): void {
  resolveApiKey = resolver;
}

export function resolveEulerpoolApiKey(): string | undefined {
  return resolveApiKey()?.trim() || readProcessEnv("EULERPOOL_API_KEY");
}

export function eulerpoolQuoteUrl(ticker: string): string {
  return `${EULERPOOL_SITE_BASE_URL}/stock/${encodeURIComponent(ticker.trim().toUpperCase())}`;
}

export function buildEulerpoolUrl(resource: string, identifier: string): string {
  const id = identifier.trim();
  const url = new URL(`${EULERPOOL_API_BASE_URL}/${resource}/${encodeURIComponent(id)}`);
  const key = resolveEulerpoolApiKey();
  if (key) url.searchParams.set("token", key);
  return url.toString();
}

function requestHeaders(): Record<string, string> {
  const key = resolveEulerpoolApiKey();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "gloomberb-eulerpool",
  };
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asDate(value: unknown): Date | null {
  const raw = typeof value === "string" || typeof value === "number" ? value : "";
  if (raw === "") return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value) return value;
  }
  return "";
}

function yearOf(date: Date): number {
  return date.getUTCFullYear();
}

export function parseEulerpoolProfile(payload: unknown, fallbackTicker: string): EulerpoolProfile | null {
  const record = asRecord(payload) ?? asRecord(Array.isArray(payload) ? payload[0] : null);
  if (!record) return null;
  const ticker = pickString(record, ["ticker", "symbol", "Ticker", "Symbol"]).toUpperCase()
    || fallbackTicker.trim().toUpperCase();
  const name = pickString(record, ["name", "companyName", "company", "Name"]);
  if (!ticker && !name) return null;
  return {
    ticker,
    name: name || ticker,
    isin: pickString(record, ["isin", "ISIN"]),
    sector: pickString(record, ["sector", "Sector"]),
    industry: pickString(record, ["industry", "Industry"]),
    country: pickString(record, ["country", "Country"]),
    currency: pickString(record, ["currency", "Currency"]) || "USD",
    website: pickString(record, ["website", "url", "homepage", "Website"]),
    description: pickString(record, ["description", "about", "summary", "Description"]),
    employees: asNumber(record.employees ?? record.fullTimeEmployees ?? record.employeeCount),
  };
}

export function parseEulerpoolIncome(payload: unknown): EulerpoolIncomePeriod[] {
  const rows = Array.isArray(payload) ? payload : asRecord(payload)?.data;
  if (!Array.isArray(rows)) return [];
  const periods: EulerpoolIncomePeriod[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const period = asDate(record.period ?? record.date ?? record.fiscalDate);
    if (!period) continue;
    periods.push({
      period,
      year: asNumber(record.year) ?? yearOf(period),
      ticker: asString(record.ticker).toUpperCase(),
      revenue: asNumber(record.revenue),
      grossIncome: asNumber(record.grossIncome ?? record.grossProfit),
      ebit: asNumber(record.ebit),
      pretaxIncome: asNumber(record.pretaxIncome),
      netIncome: asNumber(record.netIncome),
      dilutedEps: asNumber(record.diluted_eps ?? record.dilutedEps ?? record.eps),
      researchDevelopment: asNumber(record.researchDevelopment),
      sgaExpense: asNumber(record.sgaExpense),
    });
  }
  return periods
    .sort((left, right) => right.period.getTime() - left.period.getTime())
    .slice(0, INCOME_DISPLAY_CAP);
}

export function parseEulerpoolCashFlow(payload: unknown): EulerpoolCashFlowPeriod[] {
  const rows = Array.isArray(payload) ? payload : asRecord(payload)?.data;
  if (!Array.isArray(rows)) return [];
  const periods: EulerpoolCashFlowPeriod[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const period = asDate(record.period ?? record.date);
    if (!period) continue;
    periods.push({
      period,
      year: asNumber(record.year) ?? yearOf(period),
      operating: asNumber(record.netOperatingCashFlow),
      investing: asNumber(record.netInvestingCashFlow),
      financing: asNumber(record.netCashFinancingActivities),
      capex: asNumber(record.capex),
      fcf: asNumber(record.fcf),
    });
  }
  return periods.sort((left, right) => right.period.getTime() - left.period.getTime());
}

/** Statement figures are documented in millions; EPS is left as-is. */
export function statementAmount(value: number | null): number | null {
  return value == null ? null : value * 1_000_000;
}

export class EulerpoolAuthError extends Error {
  constructor(message = "Eulerpool needs an API key. Add one in Account Management → BYOK or set EULERPOOL_API_KEY.") {
    super(message);
    this.name = "EulerpoolAuthError";
  }
}

async function fetchJson(resource: string, identifier: string, signal?: AbortSignal): Promise<unknown> {
  const response = await eulerpoolFetch.fetch(buildEulerpoolUrl(resource, identifier), {
    headers: requestHeaders(),
    signal,
  });
  if (response.status === 401) {
    throw new EulerpoolAuthError();
  }
  if (response.status === 404) {
    throw new Error(`Eulerpool has no ${resource} data for ${identifier.trim().toUpperCase()}.`);
  }
  if (!response.ok) {
    throw new Error(`Eulerpool request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export class EulerpoolClient {
  async getFundamentals(identifier: string, signal?: AbortSignal): Promise<EulerpoolFundamentals> {
    const trimmed = identifier.trim();
    if (!trimmed) {
      return { identifier: "", profile: null, income: [], cashFlow: [] };
    }
    return withConnectionRequest(EULERPOOL_CONNECTION_ID, "fundamentals", async () => {
      const [profileResult, incomeResult, cashResult] = await Promise.allSettled([
        fetchJson("equity/profile", trimmed, signal),
        fetchJson("equity/incomestatement", trimmed, signal),
        fetchJson("equity/cashflowstatement", trimmed, signal),
      ]);
      const authError = [profileResult, incomeResult, cashResult].find(
        (result) => result.status === "rejected" && result.reason instanceof EulerpoolAuthError,
      );
      if (authError && authError.status === "rejected") throw authError.reason;

      const profile = profileResult.status === "fulfilled"
        ? parseEulerpoolProfile(profileResult.value, trimmed)
        : null;
      const income = incomeResult.status === "fulfilled" ? parseEulerpoolIncome(incomeResult.value) : [];
      const cashFlow = cashResult.status === "fulfilled" ? parseEulerpoolCashFlow(cashResult.value) : [];
      if (!profile && income.length === 0 && cashFlow.length === 0) {
        const firstError = [profileResult, incomeResult, cashResult].find((result) => result.status === "rejected");
        if (firstError && firstError.status === "rejected") {
          throw firstError.reason instanceof Error ? firstError.reason : new Error(String(firstError.reason));
        }
        throw new Error(`Eulerpool returned no fundamentals for ${trimmed.toUpperCase()}.`);
      }
      return { identifier: trimmed.toUpperCase(), profile, income, cashFlow };
    });
  }
}
