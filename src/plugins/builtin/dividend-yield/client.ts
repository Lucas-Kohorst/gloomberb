import { withConnectionRequest } from "../connections/register";
import type { DividendMetrics, DividendPayment } from "./types";

const CONNECTION_ID = "yahoo-dividends";
const YAHOO_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const DAY_MS = 24 * 60 * 60 * 1000;

function yahooHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "text/csv,application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": YAHOO_USER_AGENT,
    Referer: "https://finance.yahoo.com/",
  };
  return headers;
}

function parseCsvDate(value: string): Date | null {
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseAmount(value: string): number {
  const parsed = parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferType(amount: number, label: string): DividendPayment["type"] {
  const lower = label.toLowerCase();
  if (lower.includes("special")) return "special";
  if (lower.includes("stock")) return "stock";
  if (lower.includes("cash") || amount > 0) return "cash";
  return "unknown";
}

/**
 * Parse Yahoo Finance dividend CSV (Date,Dividends) into DividendPayment[].
 * Sorted by ex-date descending.
 */
export function parseDividendCsv(csv: string, currency = "USD"): DividendPayment[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  // Find the header row to locate columns
  const header = lines[0]!.split(",");
  const dateIdx = header.findIndex((h) => h.trim().toLowerCase() === "date");
  const amountIdx = header.findIndex((h) => h.trim().toLowerCase() === "dividends");

  if (dateIdx === -1 || amountIdx === -1) return [];

  const payments: DividendPayment[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    if (cols.length < 2) continue;
    const dateStr = cols[dateIdx]?.trim();
    const amountStr = cols[amountIdx]?.trim();
    if (!dateStr || !amountStr) continue;
    const exDate = parseCsvDate(dateStr);
    if (!exDate) continue;
    const amount = parseAmount(amountStr);
    if (amount <= 0) continue;
    payments.push({
      exDate,
      recordDate: null,
      paymentDate: null,
      declarationDate: null,
      amount,
      currency,
      type: inferType(amount, ""),
    });
  }

  return payments.sort((a, b) => b.exDate.getTime() - a.exDate.getTime());
}

interface QuoteSummaryDividendFields {
  trailingAnnualDividendRate: number | null;
  trailingAnnualDividendYield: number | null;
  forwardAnnualDividendRate: number | null;
  payoutRatio: number | null;
  exDividendDate: number | null;
  dividendDate: number | null;
  currency: string | null;
}

function extractDividendFields(json: unknown): QuoteSummaryDividendFields {
  const result: QuoteSummaryDividendFields = {
    trailingAnnualDividendRate: null,
    trailingAnnualDividendYield: null,
    forwardAnnualDividendRate: null,
    payoutRatio: null,
    exDividendDate: null,
    dividendDate: null,
    currency: null,
  };

  if (typeof json !== "object" || json === null) return result;
  const root = json as Record<string, unknown>;
  const summaryDetail = root.summaryDetail as Record<string, unknown> | undefined;
  const financialData = root.financialData as Record<string, unknown> | undefined;
  const defaultKeyStats = root.defaultKeyStatistics as Record<string, unknown> | undefined;

  function num(val: unknown): number | null {
    if (typeof val === "number" && Number.isFinite(val)) return val;
    if (val && typeof val === "object" && "raw" in val) {
      const raw = (val as Record<string, unknown>).raw;
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    }
    return null;
  }

  result.trailingAnnualDividendRate = num(summaryDetail?.trailingAnnualDividendRate);
  result.trailingAnnualDividendYield = num(summaryDetail?.trailingAnnualDividendYield);
  result.forwardAnnualDividendRate = num(summaryDetail?.forwardAnnualDividendRate);
  result.payoutRatio = num(financialData?.payoutRatio) ?? num(defaultKeyStats?.payoutRatio);
  result.exDividendDate = num(summaryDetail?.exDividendDate);
  result.dividendDate = num(summaryDetail?.dividendDate);
  result.currency =
    typeof summaryDetail?.currency === "string" ? summaryDetail.currency : null;

  return result;
}

export interface DividendData {
  payments: DividendPayment[];
  metrics: DividendMetrics;
}

export async function fetchDividendData(
  symbol: string,
  currentPrice: number | null,
  options: { fetcher?: typeof fetch } = {},
): Promise<DividendData> {
  const fetcher = options.fetcher ?? fetch;
  const now = new Date();
  const period1 = Math.floor((now.getTime() - 5 * 365 * DAY_MS) / 1000);
  const period2 = Math.floor(now.getTime() / 1000);

  const csvUrl =
    `https://query1.finance.yahoo.com/v7/finance/download/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1mo&events=div`;

  const quoteUrl =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=summaryDetail,financialData,defaultKeyStatistics`;

  const [csvResult, quoteResult] = await Promise.allSettled([
    withConnectionRequest(CONNECTION_ID, "dividend-history", () =>
      fetcher(csvUrl, { headers: yahooHeaders() }).then((r) => r.text()),
    ),
    withConnectionRequest(CONNECTION_ID, "quote-summary", () =>
      fetcher(quoteUrl, { headers: yahooHeaders() }).then((r) => r.json()),
    ),
  ]);

  const payments: DividendPayment[] = [];
  let currency = "USD";

  if (csvResult.status === "fulfilled") {
    const quoteFields = quoteResult.status === "fulfilled"
      ? extractDividendFields(quoteResult.value)
      : null;
    if (quoteFields?.currency) currency = quoteFields.currency;
    payments.push(...parseDividendCsv(csvResult.value, currency));
  }

  const quoteFields = quoteResult.status === "fulfilled"
    ? extractDividendFields(quoteResult.value)
    : null;

  if (quoteFields?.currency && currency === "USD") currency = quoteFields.currency;

  const metrics = buildMetrics(payments, quoteFields, currentPrice);

  if (payments.length === 0 && !quoteFields?.trailingAnnualDividendRate) {
    throw new Error(`No dividend data found for ${symbol}`);
  }

  return { payments, metrics };
}

function buildMetrics(
  payments: DividendPayment[],
  quoteFields: QuoteSummaryDividendFields | null,
  currentPrice: number | null,
): DividendMetrics {
  const trailingRate = quoteFields?.trailingAnnualDividendRate
    ?? (payments.length > 0
      ? payments
        .filter((p) => p.exDate >= new Date(Date.now() - 365 * DAY_MS))
        .reduce((sum, p) => sum + p.amount, 0)
      : null);

  const forwardRate = quoteFields?.forwardAnnualDividendRate ?? null;

  const trailingYield = quoteFields?.trailingAnnualDividendYield != null
    ? quoteFields.trailingAnnualDividendYield
    : trailingRate != null && currentPrice != null && currentPrice > 0
      ? trailingRate / currentPrice
      : null;

  const forwardYield = forwardRate != null && currentPrice != null && currentPrice > 0
    ? forwardRate / currentPrice
    : null;

  const growth1Y = payments.length >= 2 ? computeGrowth1Y(payments) : null;
  const growth3Y = payments.length >= 4 ? computeGrowth3Y(payments) : null;

  const exDividendDate = quoteFields?.exDividendDate != null
    ? new Date(quoteFields.exDividendDate * 1000)
    : payments.length > 0
      ? payments[0]!.exDate
      : null;

  const nextPayDate = quoteFields?.dividendDate != null
    ? new Date(quoteFields.dividendDate * 1000)
    : null;

  return {
    trailingYield,
    forwardYield,
    trailingRate,
    forwardRate,
    payoutRatio: quoteFields?.payoutRatio ?? null,
    growth1Y,
    growth3Y,
    paymentFrequency: inferFrequency(payments),
    exDividendDate,
    nextPayDate,
  };
}

const DAY = 24 * 60 * 60 * 1000;

function computeGrowth1Y(payments: DividendPayment[]): number | null {
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 365 * DAY);
  const priorCutoff = new Date(now.getTime() - 2 * 365 * DAY);
  const recent = payments
    .filter((p) => p.exDate >= recentCutoff && p.exDate <= now)
    .reduce((sum, p) => sum + p.amount, 0);
  const prior = payments
    .filter((p) => p.exDate >= priorCutoff && p.exDate < recentCutoff)
    .reduce((sum, p) => sum + p.amount, 0);
  if (prior <= 0) return null;
  return (recent - prior) / prior;
}

function computeGrowth3Y(payments: DividendPayment[]): number | null {
  const regular = payments.filter((p) => p.type === "cash" || p.type === "unknown");
  if (regular.length < 4) return null;
  const freq = inferFrequency(regular);
  if (!freq || freq === "irregular") return null;
  const annualCount = freq === "monthly" ? 12 : freq === "quarterly" ? 4 : freq === "semi-annual" ? 2 : 1;

  const now = new Date();
  const recentStart = new Date(now.getTime() - 365 * DAY);
  const threeYearsAgo = new Date(now.getTime() - 3 * 365 * DAY);
  const priorStart = new Date(now.getTime() - 4 * 365 * DAY);

  const sorted = [...regular].sort((a, b) => a.exDate.getTime() - b.exDate.getTime());
  const recentAvg = sorted
    .filter((p) => p.exDate >= recentStart && p.exDate <= now)
    .reduce((sum, p) => sum + p.amount, 0) / annualCount;
  const priorAvg = sorted
    .filter((p) => p.exDate >= priorStart && p.exDate <= threeYearsAgo)
    .reduce((sum, p) => sum + p.amount, 0) / annualCount;

  if (priorAvg <= 0 || recentAvg <= 0) return null;
  return Math.pow(recentAvg / priorAvg, 1 / 3) - 1;
}

type Frequency = "monthly" | "quarterly" | "semi-annual" | "annual" | "irregular";

function inferFrequency(payments: DividendPayment[]): DividendMetrics["paymentFrequency"] {
  if (payments.length < 2) return null;
  const sorted = [...payments].sort((a, b) => a.exDate.getTime() - b.exDate.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i]!.exDate.getTime() - sorted[i - 1]!.exDate.getTime()) / DAY);
  }
  const avgGapDays = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  if (Math.abs(avgGapDays - 30) < 8) return "monthly";
  if (Math.abs(avgGapDays - 91) < 18) return "quarterly";
  if (Math.abs(avgGapDays - 182) < 36) return "semi-annual";
  if (Math.abs(avgGapDays - 365) < 73) return "annual";
  return "irregular";
}
