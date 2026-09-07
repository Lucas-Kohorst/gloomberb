import type { ConnectionHealthRegistry } from "../../../core/connection-health";
import { YahooHttpClient } from "../../../sources/yahoo-finance/http";
import { financeRawNumber, mapYahooDividends } from "../../../sources/yahoo-finance/mappers";
import { fetchYahooChart } from "../../../sources/yahoo-finance/requests";
import { getYahooSymbolsToTry } from "../../../sources/yahoo-finance/symbols";
import type { QuoteSummaryResponse } from "../../../sources/yahoo-finance/types";
import { buildDividendMetrics } from "./model";
import type { DividendMetrics, DividendPayment } from "./types";
import type { PricePoint } from "../../../types/financials";

export const YAHOO_DIVIDENDS_CONNECTION_ID = "yahoo-dividends";
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
  history: PricePoint[];
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
  const history = chartResult.status === "fulfilled" ? chartResult.value.history : [];
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

  const metrics = buildDividendMetrics(payments, quoteFields, resolvedPrice);

  if (payments.length === 0 && !quoteFields?.trailingAnnualDividendRate) {
    throw new Error(`No dividend data found for ${symbol}`);
  }

  return { payments, metrics, price: resolvedPrice, history };
}
