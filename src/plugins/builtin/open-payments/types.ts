export const OPEN_PAYMENTS_PLUGIN_ID = "open-payments";
export const OPEN_PAYMENTS_CONNECTION_ID = "open-payments";
export const OPEN_PAYMENTS_PLUGIN_NAME = "Open Payments";
export const OPEN_PAYMENTS_API_BASE_URL = "https://openpaymentsdata.cms.gov/api/1";

/**
 * 2025 General Payment Data — program year 2025, published 2026-06-30.
 * This is the current general-payments (non-research, non-ownership) dataset:
 * ~16.1M rows queried through the free DKAN datastore, no API key required.
 *
 * Lineage: CMS used to serve one Socrata resource per program year on
 * openpaymentsdata.cms.gov/resource (e.g. 2022 general payments `w4ky-vbzm`,
 * mirrored on data.cms.gov as `7v3g-9rg4` / `nhgx-5qnk`). Those endpoints are
 * retired — data.cms.gov/resource now answers HTTP 410 Gone and
 * openpaymentsdata.cms.gov/resource serves the Drupal site HTML. Row queries
 * moved to the DKAN datastore below, which keeps the same column names, so
 * SoQL-style `$where` filters map 1:1 onto DKAN `conditions`.
 */
export const OPEN_PAYMENTS_GENERAL_PAYMENTS_DATASET_ID = "fb0b1734-1410-429d-92f6-3f4b35218e5e";
export const OPEN_PAYMENTS_PROGRAM_YEAR = "2025";

/** A single general payment (transfer of value) to a covered recipient. */
export interface OpenPayment {
  id: string;
  recipientName: string;
  recipientFirstName: string;
  recipientLastName: string;
  recipientCity: string;
  recipientState: string;
  npi: string;
  companyName: string;
  amount: number | null;
  date: Date | null;
  nature: string;
  form: string;
  productName: string;
  productCategory: string;
  programYear: string;
}

/** A page of payment results. */
export interface OpenPaymentsPage {
  payments: OpenPayment[];
  total: number | null;
}
