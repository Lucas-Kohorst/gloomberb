/**
 * Earnings call transcript data types.
 *
 * Currently backed by SEC 8-K earnings press releases as a proxy for real
 * transcript content. The 8-K filings that announce earnings results (item
 * 2.02 "Results of Operations and Financial Condition") carry the press
 * release text — revenue, EPS, guidance, and management commentary — which is
 * the closest free, keyless source for the narrative portion of an earnings
 * call. A dedicated transcript API (Financial Datasets, Alpha Vantage, etc.)
 * would provide the actual Q&A; until one is integrated, we surface the 8-K
 * content with metadata that mirrors a real transcript shape.
 *
 * TODO: Integrate a real earnings call transcript API (e.g. Financial Datasets
 * `https://financialdatasets.ai/earnings-transcripts` or Alpha Vantage
 * `EARNINGS_CALL_TRANSCRIPT`) to replace the 8-K fallback. The types below are
 * designed to accommodate either source without a breaking shape change.
 */

export interface TranscriptParticipant {
  name: string;
  role: string;
}

export interface TranscriptSection {
  speaker: string;
  role?: string;
  text: string;
}

export interface EarningsTranscript {
  /** Stable id (accession number for 8-K fallback). */
  id: string;
  /** Ticker symbol, uppercased. */
  symbol: string;
  /** Company name from the filing. */
  company: string | undefined;
  /** Filing/report date (ISO date string). */
  date: string;
  /** Form type (e.g. "8-K"). */
  form: string;
  /** Quarter label derived from filing context (e.g. "Q1 2024"). */
  quarter: string | undefined;
  /** Fiscal year derived from filing context. */
  fiscalYear: number | undefined;
  /** Participants (company executives / analysts). */
  participants: TranscriptParticipant[];
  /** Transcript sections (prepared remarks, Q&A, etc.). */
  sections: TranscriptSection[];
  /** Full body text (fallback rendering). Empty until the open item loads. */
  body: string;
  /** True once filing content was fetched for this row. */
  contentLoaded: boolean;
  /** External URL to the source filing. */
  url: string | undefined;
  /** Primary document URL used to fetch content on open. */
  primaryDocumentUrl?: string;
  /** Title for display. */
  title: string;
}
