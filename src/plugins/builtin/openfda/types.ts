export const OPENFDA_PLUGIN_ID = "openfda";
export const OPENFDA_CONNECTION_ID = "openfda";
export const OPENFDA_API_BASE_URL = "https://api.fda.gov";

/** Which openFDA dataset a record came from. */
export type OpenFdaDataset = "drug" | "device" | "recall";

/** A normalized adverse-event or recall record for the table. */
export interface OpenFdaRecord {
  id: string;
  dataset: OpenFdaDataset;
  title: string;
  company: string;
  product: string;
  date: Date;
  flag: string;
  detail: string[];
  url: string;
}

/** A merged page of records across the openFDA datasets. */
export interface OpenFdaPage {
  records: OpenFdaRecord[];
  total: number;
}
