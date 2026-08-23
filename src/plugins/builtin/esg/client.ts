import { withConnectionRequest } from "../connections/register";
import { YahooHttpClient } from "../../../sources/yahoo-finance/http";
import { financeRawNumber } from "../../../sources/yahoo-finance/mappers";
import type { QuoteSummaryResponse, YahooQuoteSummaryResult } from "../../../sources/yahoo-finance/types";
import { getYahooSymbolsToTry } from "../../../sources/yahoo-finance/symbols";
import type { CarbonEmissions, EsgData, EsgScores } from "./types";

const CONNECTION_ID = "yahoo-esg";
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
 * Yahoo may return an empty or all-null module for unsupported symbols.
 */
export function hasEsgData(scores: EsgScores): boolean {
  return scores.totalEsg != null
    || scores.environmentScore != null
    || scores.socialScore != null
    || scores.governanceScore != null
    || scores.esgPerformance != null;
}

/**
 * Build a Yahoo Finance sustainability profile URL for the symbol.
 */
function buildSourceUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/sustainability`;
}

/**
 * Fetch ESG data for a ticker from Yahoo Finance's quoteSummary `esgScores` module.
 *
 * TODO: Yahoo Finance does not expose Scope 1/2/3 carbon emissions through the
 * quoteSummary API. To populate `CarbonEmissions`, wire in a dedicated carbon
 * data source (e.g. CDP, SBTi, or a commercial ESG API). The `carbon` field
 * remains null until a source is integrated. An API key, if required by the
 * chosen provider, should be stored via `ctx.configState` and never hardcoded.
 */
export async function fetchEsgData(symbol: string, exchange = ""): Promise<EsgData> {
  const symbols = exchange ? getYahooSymbolsToTry(symbol, exchange) : [symbol];
  let lastError: unknown;

  for (const yahooSymbol of symbols) {
    try {
      return await fetchEsgDataForSymbol(yahooSymbol);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error(`No ESG data found for ${symbol}`);
}

async function fetchEsgDataForSymbol(symbol: string): Promise<EsgData> {
  const params = new URLSearchParams({ modules: "esgScores" });
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?${params}`;

  const data = await withConnectionRequest(CONNECTION_ID, "esg-scores", () =>
    yahoo.fetchJsonWithCrumb<QuoteSummaryResponse>(url),
  );

  const result = data.quoteSummary?.result?.[0];
  if (!result) throw new Error(`No ESG data for ${symbol}`);

  const scores = normalizeEsgScores(result);
  if (!hasEsgData(scores)) {
    throw new Error(`No ESG data for ${symbol}`);
  }

  // TODO: integrate a carbon emissions data source to populate `carbon`.
  const carbon: CarbonEmissions | null = null;

  return {
    symbol,
    scores,
    carbon,
    sourceUrl: buildSourceUrl(symbol),
  };
}
