import { YahooHttpClient } from "../../../sources/yahoo-finance/http";
import { financeRawNumber } from "../../../sources/yahoo-finance/mappers";
import type { QuoteSummaryResponse, YahooQuoteSummaryResult } from "../../../sources/yahoo-finance/types";
import { getYahooSymbolsToTry } from "../../../sources/yahoo-finance/symbols";
import type { EsgData, EsgScores } from "./types";

const yahoo = new YahooHttpClient();

const EMPTY_SCORES: EsgScores = {
  totalEsg: null,
  environmentScore: null,
  socialScore: null,
  governanceScore: null,
  esgPerformance: null,
  peerCount: null,
  peerGroup: null,
  peerEsgScore: null,
  peerEnvironmentScore: null,
  peerSocialScore: null,
  peerGovernanceScore: null,
  controversyLevel: null,
  controversyScore: null,
  ratingMonth: null,
  ratingYear: null,
};

/**
 * Normalize the raw Yahoo `esgScores` module into a typed `EsgScores` object.
 * Exported for unit testing.
 */
export function normalizeEsgScores(result: YahooQuoteSummaryResult): EsgScores {
  const raw = result.esgScores;
  if (!raw) return { ...EMPTY_SCORES };

  return {
    totalEsg: financeRawNumber(raw.totalEsg) ?? null,
    environmentScore: financeRawNumber(raw.environmentScore) ?? null,
    socialScore: financeRawNumber(raw.socialScore) ?? null,
    governanceScore: financeRawNumber(raw.governanceScore) ?? null,
    esgPerformance: typeof raw.esgPerformance === "string" && raw.esgPerformance.length > 0
      ? raw.esgPerformance
      : null,
    peerCount: typeof raw.peerCount === "number" ? raw.peerCount : null,
    peerGroup: typeof raw.peerGroup === "string" && raw.peerGroup.length > 0
      ? raw.peerGroup
      : null,
    peerEsgScore: financeRawNumber(raw.peerEsgScore) ?? null,
    peerEnvironmentScore: financeRawNumber(raw.peerEnvironmentScore) ?? null,
    peerSocialScore: financeRawNumber(raw.peerSocialScore) ?? null,
    peerGovernanceScore: financeRawNumber(raw.peerGovernanceScore) ?? null,
    controversyLevel: typeof raw.controversyLevel === "string" && raw.controversyLevel.length > 0
      ? raw.controversyLevel
      : null,
    controversyScore: financeRawNumber(raw.controversyScore) ?? null,
    ratingMonth: typeof raw.ratingMonth === "number" ? raw.ratingMonth : null,
    ratingYear: typeof raw.ratingYear === "number" ? raw.ratingYear : null,
  };
}

/**
 * Returns true when the normalized scores contain any real ESG data.
 * Yahoo often returns an empty or maxAge-only `esgScores` module (ETFs, etc.).
 */
export function hasEsgData(scores: EsgScores): boolean {
  return Object.values(scores).some((value) => value != null);
}

/**
 * Build a Yahoo Finance sustainability profile URL for the symbol.
 */
function buildSourceUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/sustainability`;
}

export function buildEsgData(symbol: string, result: YahooQuoteSummaryResult): EsgData {
  return {
    symbol,
    scores: normalizeEsgScores(result),
    // Yahoo quoteSummary does not expose Scope 1/2/3 emissions.
    carbon: null,
    sourceUrl: buildSourceUrl(symbol),
  };
}

/**
 * Fetch ESG data for a ticker from Yahoo Finance's quoteSummary `esgScores` module.
 * Empty / maxAge-only modules (common on ETFs) resolve to scores with no data
 * instead of throwing. YahooHttpClient already reports the `yahoo` connection.
 */
export async function fetchEsgData(symbol: string, exchange = ""): Promise<EsgData> {
  const symbols = exchange ? getYahooSymbolsToTry(symbol, exchange) : [symbol];
  let firstEmpty: EsgData | null = null;
  let lastError: unknown;

  for (const yahooSymbol of symbols) {
    try {
      const data = await fetchEsgDataForSymbol(yahooSymbol);
      if (hasEsgData(data.scores)) return data;
      firstEmpty ??= data;
    } catch (error) {
      lastError = error;
    }
  }

  if (firstEmpty) return firstEmpty;
  throw lastError ?? new Error(`No ESG data found for ${symbol}`);
}

async function fetchEsgDataForSymbol(symbol: string): Promise<EsgData> {
  const params = new URLSearchParams({ modules: "esgScores" });
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${params}`;

  const data = await yahoo.fetchJsonWithCrumb<QuoteSummaryResponse>(url);

  const result = data.quoteSummary?.result?.[0];
  if (!result) throw new Error(`No quote summary for ${symbol}`);

  return buildEsgData(symbol, result);
}
