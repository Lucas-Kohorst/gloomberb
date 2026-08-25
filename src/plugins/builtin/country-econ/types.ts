export const COUNTRY_ECON_PANE_ID = "country-econ";
export const COUNTRY_ECON_PLUGIN_ID = "macro";
export const WORLD_BANK_CONNECTION_ID = "world-bank";

export type CountryEconKind = "country" | "region";

export interface CountryEconIndicator {
  id: string;
  label: string;
  unit: string;
  /** World Bank indicator code. */
  wbCode: string;
}

export interface CountryEconRow {
  id: string;
  iso3: string;
  name: string;
  kind: CountryEconKind;
  region: string;
  year: string;
  value: number | null;
  unit: string;
  indicator: string;
}

export type LoadStatus = "idle" | "loading" | "loaded" | "error";
