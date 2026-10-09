export const EDGAR_FILINGS_PLUGIN_ID = "edgar-filings";
export const EDGAR_FILINGS_PANE_ID = "edgar-filings";

/**
 * One row of the current-filings feed. The same accession is listed once per
 * filer (the issuer and each reporting owner), so the id includes all three.
 */
export interface EdgarFiling {
  id: string;
  accessionNumber: string;
  form: string;
  companyName: string;
  /** Filer, Issuer, Reporting, Subject, Filed by. */
  role: string;
  /** Ten-digit, zero-padded. */
  cik: string;
  /** When the filing was accepted. */
  acceptedAt: Date;
  /** The filing date, YYYY-MM-DD. */
  filedDate: string;
  size?: string;
  /** 8-K item lines, when the feed included them. */
  items: string[];
  filingUrl: string;
}

export interface EdgarFilingPage {
  rows: EdgarFiling[];
  hasMore: boolean;
  nextOffset: number | null;
}
