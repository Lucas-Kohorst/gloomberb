export const OPTICODDS_PLUGIN_ID = "opticodds";
export const OPTICODDS_PANE_ID = "opticodds";
export const OPTICODDS_CONNECTION_ID = "opticodds";
export const OPTICODDS_BYOK_SERVICE_ID = "opticodds";
export const OPTICODDS_API_BASE_URL = "https://api.opticodds.com/api/v3";

/** Books whose desktop deep links are real https URLs. */
export const OPTICODDS_SPORTSBOOKS = ["draftkings", "fanduel"] as const;

/** `/fixtures/odds` allows at most five fixture ids per request. */
export const OPTICODDS_FIXTURE_LIMIT = 5;

export interface OddsRow {
  id: string;
  fixtureId: string;
  matchup: string;
  start: string;
  startMs: number;
  sportsbook: string;
  selection: string;
  price: number | null;
  url: string | null;
}
