export const CFPB_COMPLAINTS_PLUGIN_ID = "cfpb-complaints";
export const CFPB_COMPLAINTS_CONNECTION_ID = "cfpb-complaints";
export const CFPB_COMPLAINTS_PANE_ID = "complaints";
export const CFPB_API_BASE_URL =
  "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/";
export const CFPB_COMPLAINT_DETAIL_URL =
  "https://www.consumerfinance.gov/data-research/consumer-complaints/search/detail";

/** A single consumer complaint from the CFPB complaint database. */
export interface CfpbComplaint {
  /** complaint_id, e.g. "15675411". */
  id: string;
  /** Top-level product, e.g. "Checking or savings account". */
  product: string;
  subProduct: string;
  /** Top-level issue, e.g. "Problem caused by your funds being low". */
  issue: string;
  subIssue: string;
  company: string;
  state: string;
  /** date_received from the API. */
  dateReceived: Date;
  /** e.g. "Closed with explanation". */
  companyResponse: string;
  /** "Yes" / "No" as reported by the API. */
  timely: string;
  /** e.g. "Web", "Phone". */
  submittedVia: string;
  hasNarrative: boolean;
  /** complaint_what_happened; empty when the consumer gave no narrative. */
  narrative: string;
}

/** A page of complaint results. */
export interface CfpbComplaintPage {
  complaints: CfpbComplaint[];
  total: number;
}
