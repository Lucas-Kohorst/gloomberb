import type { NewsArticle } from "../../../news/types";
import type { SecFilingItem } from "../../../types/data-provider";
import { isPeriodicReportForm } from "./forms";

const EMPTY_SCORES = {
  importance: 0,
  urgency: 0,
  marketImpact: 0,
  novelty: 0,
  confidence: 0,
};

export function filingToArticle(
  filing: SecFilingItem,
  body?: string | null,
): NewsArticle {
  const form = filing.form.trim();
  const company = filing.companyName || filing.ticker || filing.cik;
  const title = `${form} ${company}`.trim();
  return {
    id: `sec:${filing.accessionNumber}`,
    title,
    url: filing.filingUrl,
    source: "SEC EDGAR",
    publishedAt: filing.filingDate,
    summary: filing.primaryDocDescription || `${form} filed ${filing.filingDate.toISOString().slice(0, 10)}`,
    topic: "filing",
    topics: ["filing", form, "10-k", "10-q", "10k", "10q"],
    sectors: [],
    categories: ["SEC", form],
    tickers: filing.ticker ? [filing.ticker] : [],
    scores: EMPTY_SCORES,
    isBreaking: false,
    isDeveloping: false,
    importance: 0,
    origin: "sec-edgar",
    body: body ?? undefined,
  };
}

export function looksLikeFilingQuery(query: string): boolean {
  return /\b(10-?k|10-?q|filing|filings|edgar)\b/i.test(query);
}

/** Strip ART / form tokens so EDGAR search gets a ticker or company name. */
export function filingLookupQuery(query: string): string {
  return query
    .replace(/^\s*art\b/i, " ")
    .replace(/\b(10-?k\/?a?|10-?q\/?a?|filings?|edgar)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPeriodicFiling(filing: SecFilingItem): boolean {
  return isPeriodicReportForm(filing.form);
}
