import type { ConnectionHealthRegistry } from "../../../core/connection-health";
import { YahooHttpClient } from "../../../sources/yahoo-finance/http";
import { financeRawNumber, mapYahooDividends } from "../../../sources/yahoo-finance/mappers";
import { fetchYahooChart } from "../../../sources/yahoo-finance/requests";
import { getYahooSymbolsToTry } from "../../../sources/yahoo-finance/symbols";
import type { QuoteSummaryResponse } from "../../../sources/yahoo-finance/types";
import type { DividendMetrics, DividendPayment } from "./types";

export const YAHOO_DIVIDENDS_CONNECTION_ID = "yahoo-dividends";
const DAY_MS = 24 * 60 * 60 * 1000;
const yahoo = new YahooHttpClient();

let connectionHealth: ConnectionHealthRegistry | null = null;

export function attachDividendYieldHealth(health?: ConnectionHealthRegistry): void {
  connectionHealth = health ?? null;
}

export function resetDividendYieldHealth(): void {
  connectionHealth = null;
}

function trackRequest<T>(operation: string, request: () => Promise<T>): Promise<T> {
  return connectionHealth?.hasSource(YAHOO_DIVIDENDS_CONNECTION_ID)
    ? connectionHealth.track(YAHOO_DIVIDENDS_CONNECTION_ID, operation, request)
    : request();
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

const EMPTY_DIVIDEND_FIELDS: QuoteSummaryDividendFields = {
  trailingAnnualDividendRate: null,
  trailingAnnualDividendYield: null,
  forwardAnnualDividendRate: null,
  payoutRatio: null,
  exDividendDate: null,
  dividendDate: null,
  currency: null,
};

/**
 * Yahoo nests quote modules at quoteSummary.result[0], not the response root.
 */
export function extractDividendFields(payload: unknown): QuoteSummaryDividendFields {
  if (typeof payload !== "object" || payload === null) return { ...EMPTY_DIVIDEND_FIELDS };
  const result = (payload as QuoteSummaryResponse).quoteSummary?.result?.[0];
  if (!result) return { ...EMPTY_DIVIDEND_FIELDS };

  const summaryDetail = result.summaryDetail;
  const financialData = result.financialData;
  const defaultKeyStats = result.defaultKeyStatistics;

  return {
    trailingAnnualDividendRate: financeRawNumber(summaryDetail?.trailingAnnualDividendRate) ?? null,
    trailingAnnualDividendYield: financeRawNumber(summaryDetail?.trailingAnnualDividendYield) ?? null,
    forwardAnnualDividendRate: financeRawNumber(summaryDetail?.forwardAnnualDividendRate)
      ?? financeRawNumber(summaryDetail?.dividendRate)
      ?? null,
    payoutRatio: financeRawNumber(financialData?.payoutRatio)
      ?? financeRawNumber(defaultKeyStats?.payoutRatio)
      ?? financeRawNumber(summaryDetail?.payoutRatio)
      ?? null,
    exDividendDate: financeRawNumber(summaryDetail?.exDividendDate) ?? null,
    dividendDate: financeRawNumber(summaryDetail?.dividendDate) ?? null,
    currency: typeof summaryDetail?.currency === "string" ? summaryDetail.currency : null,
  };
}

function toDividendPayment(
  exDate: string,
  amount: number,
  currency: string,
): DividendPayment | null {
  if (amount <= 0) return null;
  const parsed = new Date(`${exDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    exDate: parsed,
    recordDate: null,
    paymentDate: null,
    declarationDate: null,
    amount,
    currency,
    type: "cash",
  };
}

export interface DividendData {
  payments: DividendPayment[];
  metrics: DividendMetrics;
  price: number | null;
}

export async function fetchDividendData(
  symbol: string,
  currentPrice: number | null,
  exchange = "",
): Promise<DividendData> {
  const symbols = exchange ? getYahooSymbolsToTry(symbol, exchange) : [symbol];
  let lastError: unknown;
  for (const yahooSymbol of symbols) {
    try {
      return await fetchDividendDataForSymbol(yahooSymbol, currentPrice);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error(`No dividend data found for ${symbol}`);
}

async function fetchDividendDataForSymbol(
  symbol: string,
  currentPrice: number | null,
): Promise<DividendData> {
  const quoteUrl =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`
    + "?modules=summaryDetail,financialData,defaultKeyStatistics";

  const [chartResult, quoteResult] = await Promise.allSettled([
    trackRequest("dividend-history", () =>
      fetchYahooChart(yahoo, symbol, "10y", "1mo"),
    ),
    trackRequest("quote-summary", () =>
      yahoo.fetchJsonWithCrumb<QuoteSummaryResponse>(quoteUrl),
    ),
  ]);

  const quoteFields = quoteResult.status === "fulfilled"
    ? extractDividendFields(quoteResult.value)
    : null;

  const currency = quoteFields?.currency
    ?? (chartResult.status === "fulfilled" ? chartResult.value.meta.currency ?? null : null)
    ?? "USD";

  const payments: DividendPayment[] = [];
  if (chartResult.status === "fulfilled") {
    for (const dividend of mapYahooDividends(chartResult.value.events)) {
      const payment = toDividendPayment(dividend.exDate, dividend.amount, currency);
      if (payment) payments.push(payment);
    }
    payments.sort((a, b) => b.exDate.getTime() - a.exDate.getTime());
  }

  const resolvedPrice = currentPrice
    ?? (chartResult.status === "fulfilled" ? chartResult.value.meta.regularMarketPrice ?? null : null)
    ?? null;

  const metrics = buildMetrics(payments, quoteFields, resolvedPrice);

  if (payments.length === 0 && !quoteFields?.trailingAnnualDividendRate) {
    throw new Error(`No dividend data found for ${symbol}`);
  }

  return { payments, metrics, price: resolvedPrice };
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
