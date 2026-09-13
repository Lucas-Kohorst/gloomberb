export const COURTLISTENER_PLUGIN_ID = "courtlistener";
export const COURTLISTENER_CONNECTION_ID = "courtlistener";
export const COURTLISTENER_API_BASE_URL = "https://www.courtlistener.com/api/rest/v4";
export const COURTLISTENER_SITE_BASE_URL = "https://www.courtlistener.com";
export const COURTLISTENER_BYOK_SERVICE_ID = "courtlistener";

/** A docket or opinion hit from the CourtListener v4 search endpoint. */
export interface Lawsuit {
  /** `docket-<id>`, `cluster-<id>`, or `opinion-<id>`. */
  id: string;
  kind: "docket" | "opinion";
  clusterId: string;
  opinionId: string;
  docketId: string;
  caseName: string;
  court: string;
  courtCitation: string;
  dateFiled: Date;
  docketNumber: string;
  judge: string;
  status: string;
  snippet: string;
  citeCount: number;
  /** Canonical CourtListener docket or opinion URL (may be empty). */
  url: string;
  /** Direct PDF URL when the hit exposes one (may be empty). */
  downloadUrl: string;
}

/** A page of lawsuit search results. */
export interface LawsuitPage {
  lawsuits: Lawsuit[];
  total: number;
  next: string | null;
}

/** Full opinion text backing the command-bar document reader. */
export interface OpinionDetail {
  id: string;
  title: string;
  text: string;
  url: string;
  court: string;
  dateFiled: Date;
}
