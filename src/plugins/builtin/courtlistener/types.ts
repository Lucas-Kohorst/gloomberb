export const COURTLISTENER_PLUGIN_ID = "courtlistener";
export const COURTLISTENER_CONNECTION_ID = "courtlistener";
export const COURTLISTENER_API_BASE_URL = "https://www.courtlistener.com/api/rest/v4";
export const COURTLISTENER_SITE_BASE_URL = "https://www.courtlistener.com";

/** A single court opinion hit from the CourtListener v4 search endpoint. */
export interface Lawsuit {
  /** Stable pane id: `cluster-<cluster_id>` when known, else `opinion-<id>`. */
  id: string;
  clusterId: string;
  opinionId: string;
  caseName: string;
  court: string;
  courtCitation: string;
  dateFiled: Date;
  docketNumber: string;
  judge: string;
  status: string;
  snippet: string;
  citeCount: number;
  /** Canonical https://www.courtlistener.com opinion URL (may be empty). */
  url: string;
  /** Direct PDF URL when the opinion exposes one (may be empty). */
  downloadUrl: string;
}

/** A page of lawsuit search results. */
export interface LawsuitPage {
  lawsuits: Lawsuit[];
  total: number;
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
