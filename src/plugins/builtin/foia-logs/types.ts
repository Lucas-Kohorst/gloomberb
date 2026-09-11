export const FOIA_LOGS_PLUGIN_ID = "foia-logs";
export const FOIA_LOGS_CONNECTION_ID = "foia-logs";
export const FOIA_LOGS_CONNECTION_NAME = "SEC FOIA Logs";

/**
 * Index page listing every posted monthly log. The SEC publishes no API;
 * the client discovers CSV links from this page's markup.
 *
 * Verified 2026-09: https://www.sec.gov/foia/frequently-requested-documents/foia-logs
 * lists "January 2006 - April 2026" (rolling monthly), one row per month with
 * two CSV links: the full monthly log and a "<Month YYYY>, B7A Exemption" file.
 */
export const SEC_FOIA_LOGS_PAGE_URL =
  "https://www.sec.gov/foia/frequently-requested-documents/foia-logs";
export const SEC_FOIA_BASE_URL = "https://www.sec.gov";

/** How many recent monthly log CSVs / B7A CSVs to download per refresh. */
export const FOIA_LOGS_DEFAULT_MONTHS = 3;
export const FOIA_LOGS_DEFAULT_B7A_MONTHS = 3;
export const FOIA_LOGS_DISPLAY_CAP = 100;

/**
 * Investigative-activity signal for a log entry that mentions the query.
 *
 * - `high`: the request was withheld under FOIA Exemption 7(A) (or comes
 *   from a monthly B7A-exemption file). Per the SEC's own annual FOIA report,
 *   7(A) means the records relate to an ongoing enforcement proceeding, so
 *   this is the classic undisclosed-investigation flag. Academic work cited
 *   by FOIAsearch.com finds B7A exemptions predict negative abnormal returns.
 * - `medium`: the request seeks enforcement/investigative records (Wells
 *   notice, subpoena, probe, enforcement action) without an explicit 7(A) cite.
 * - `watch`: the company is named but the request looks routine (grant,
 *   partial release, referral, or "no records" — the last being evidence
 *   *against* undisclosed activity, surfaced via the disposition field).
 */
export type FoiaSignal = "high" | "medium" | "watch";

/** One parsed row from a monthly SEC FOIA log CSV. */
export interface FoiaLogEntry {
  /** Stable pane id: `<source-month>::<request-id or row-index>`. */
  id: string;
  requestId: string;
  requesterName: string;
  requesterOrganization: string;
  feeCategory: string;
  description: string;
  dateOfRequest: Date;
  dateReceived: Date;
  status: string;
  closedDate: Date;
  disposition: string;
  /** True when parsed from a monthly "B7A Exemption" file. */
  fromB7AFile: boolean;
  /** Month label of the source file, e.g. "July 2026". */
  sourceMonth: string;
  /** Direct URL of the source CSV (pane "open" target). */
  url: string;
  signal: FoiaSignal;
  /** Which company/ticker match fired, for the detail view. */
  matchReason: string;
}

/** A page of matched entries. */
export interface FoiaLogPage {
  entries: FoiaLogEntry[];
  total: number;
}
