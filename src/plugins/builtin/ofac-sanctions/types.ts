export const OFAC_SANCTIONS_PLUGIN_ID = "ofac-sanctions";
export const OFAC_SANCTIONS_CONNECTION_ID = "ofac-sanctions";
export const OFAC_API_BASE_URL = "https://api.trade.gov/gateway/v1";

export interface SanctionsEntry {
  id: string;
  name: string;
  type: "individual" | "entity";
  sourceLists: string[];
  altNames: string[];
  addresses: string[];
  programs: string[];
  remarks: string;
  nationalities: string[];
  datesOfBirth: string[];
  ids: string[];
}

export interface SanctionsPage {
  entries: SanctionsEntry[];
  total: number;
}
