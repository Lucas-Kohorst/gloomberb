export const FDIC_BANK_PLUGIN_ID = "fdic-bank";
export const FDIC_BANK_CONNECTION_ID = "fdic-bank";
export const FDIC_API_BASE_URL = "https://banks.data.fdic.gov/api";

/** A bank directory record from the FDIC BankFind institutions endpoint. */
export interface BankRecord {
  cert: number;
  name: string;
  city: string;
  state: string;
  stateName: string;
  bankClass: string;
  active: boolean;
  /** Total assets in $ thousands, as reported. Null when not reported. */
  assets: number | null;
  /** Total deposits in $ thousands, as reported. Null when not reported. */
  deposits: number | null;
  webAddress: string;
}

/**
 * A bank-risk event from the FDIC BankFind failures endpoint.
 * The BankFind Suite publishes no enforcement-decisions JSON endpoint, so
 * failures and assistance transactions are the public risk dataset.
 */
export interface BankFailure {
  id: string;
  name: string;
  cert: number | null;
  city: string;
  state: string;
  failDate: Date | null;
  failYear: string;
  /** "FAILURE", "ASSISTANCE", or whatever the endpoint reports. */
  actionType: string;
}

export interface BankRiskPage {
  banks: BankRecord[];
  failures: BankFailure[];
}
