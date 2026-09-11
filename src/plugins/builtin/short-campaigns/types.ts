export const SHORT_CAMPAIGNS_PLUGIN_ID = "short-campaigns";
export const SHORT_CAMPAIGNS_CONNECTION_ID = "short-report-impact";
export const SHORT_REPORT_BASE_URL = "https://shortreportimpact.com";
/**
 * Listing page scraped for campaigns. Currently the homepage carries the
 * campaign table; if the site moves listings to a subpath, update this
 * constant (the parser itself is path-agnostic).
 */
export const SHORT_REPORT_CAMPAIGNS_URL = `${SHORT_REPORT_BASE_URL}/`;

/** A single activist short campaign scraped from ShortReportImpact. */
export interface ShortCampaign {
  id: string;
  /** Company targeted by the campaign. */
  target: string;
  /** Exchange ticker when the listing names one, e.g. "ACME". */
  ticker: string | null;
  /** Short seller / research author behind the campaign. */
  seller: string;
  /** Campaign announcement date. Epoch (getTime() === 0) when unparseable. */
  date: Date;
  /** Price performance since the report, in percent. Null when not listed. */
  performancePct: number | null;
  /** Absolute URL of the report / campaign detail page. */
  reportUrl: string;
  /** One-line thesis excerpt when the listing provides one. */
  thesis: string;
}

/** A page of short-campaign results. */
export interface ShortCampaignPage {
  campaigns: ShortCampaign[];
  total: number;
}
