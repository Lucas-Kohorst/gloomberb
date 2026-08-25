export const ADJACENT_DEV_PLUGIN_ID = "adjacent-dev";
export const ADJACENT_DEV_API_KEY_CONFIG = "adjacentDevApiKey";
export const ADJACENT_DEV_CONNECTION_ID = "adjacent-dev";

/** Base URL for the dev filings API. */
export const ADJACENT_DEV_BASE_URL = "https://api.dev.adjacent.markets";

/**
 * A CFTC filing record, modelled after SecFilingItem so the pane can reuse
 * the same FeedDataTableStackView patterns (list + detail, documents, content).
 */
export interface CftcFiling {
  accessionNumber: string;
  form: string;
  filingDate: Date;
  acceptedAt?: Date;
  primaryDocument?: string;
  primaryDocDescription?: string;
  items?: string;
  companyName?: string;
  ticker?: string;
  filingUrl: string;
  primaryDocumentUrl?: string;
}

/** A document attached to a CFTC filing (index page entry). */
export interface CftcFilingDocument {
  sequence?: string;
  type: string;
  description?: string;
  document: string;
  url: string;
}

/** API response shapes. */

export interface CftcFilingsResponse {
  filings?: CftcFiling[];
  total?: number;
}

export interface CftcFilingDocumentsResponse {
  documents?: CftcFilingDocument[];
}
