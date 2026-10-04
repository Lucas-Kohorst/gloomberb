export const OPENFDA_PLUGIN_ID = "openfda";
export const OPENFDA_PANE_ID = "adverse-events";
export const OPENFDA_API_BASE_URL = "https://api.fda.gov";

export type OpenFdaDataset = "drug" | "device" | "recall";

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

export interface OpenFdaPage {
  records: OpenFdaRecord[];
  total: number;
}

export interface OpenFdaFixturePayload {
  drug?: unknown;
  device?: unknown;
  recall?: unknown;
}
