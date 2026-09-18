import { GLOOM_CLOUD_HTTP_CONNECTION_ID } from "../../../core/connection-health";
import {
  ADJACENT_DATA_ALIAS_ID,
  KEYED_DATA_ALIAS_PATH,
  KEYED_DATA_PATH,
} from "../../../shared/hosted-api";

/**
 * Single Connections-pane row for Adjacent Cloud children (VoteHub, OWID,
 * weather prints, listings, llm-stats, Adjacent, Federal Register, OFAC,
 * USAspending). Research keyed-data origins (World Bank, OpenSky, NASA,
 * Digitraffic) keep their own rows.
 */
export const ADJACENT_CLOUD_CONNECTION_ID = "adjacent-cloud";

/**
 * Upstream ids that fold onto {@link ADJACENT_CLOUD_CONNECTION_ID}.
 * This is the Adjacent Cloud inventory set — not every `/api/data` provider.
 * Do not add world-bank, opensky, nasa-firms, digitraffic-ais, or nasa-gibs.
 */
export const ADJACENT_CLOUD_PROVIDER_IDS = [
  "twc-kalshi",
  "nws-cli",
  "llm-stats",
  "adjacent",
  "votehub",
  "us-listings",
  "owid",
  "federal-register",
  "ofac-sanctions",
  "usaspending",
] as const;

const ADJACENT_CLOUD_PROVIDER_ID_SET = new Set<string>(ADJACENT_CLOUD_PROVIDER_IDS);

/** Yahoo HTTP origin. Fragment plugins (ESG, screener, dividends, SI) share this row. */
const YAHOO_CONNECTION_ID = "yahoo";

/**
 * Leftover ids that used to register their own Yahoo CONN rows.
 * Keep `yahoo-fundamentals` here so the screener cannot ghost a second Yahoo row.
 */
const YAHOO_FRAGMENT_SOURCE_IDS = new Set([
  "yahoo-esg",
  "yahoo-screener",
  "yahoo-dividends",
  "yahoo-short-interest",
  "yahoo-fundamentals",
]);

/** Legacy sync-transport id. Live inventory and API-client traffic use gloom-cloud-http. */
export const GLOOM_CLOUD_SYNC_ALIAS_ID = "gloom-cloud";

/** True for upstream prints that already traffic through Adjacent Cloud. */
export function isAdjacentCloudChildSourceId(id: string): boolean {
  return ADJACENT_CLOUD_PROVIDER_ID_SET.has(id);
}

export function isYahooFragmentSourceId(id: string): boolean {
  return YAHOO_FRAGMENT_SOURCE_IDS.has(id);
}

/**
 * Ids that remap onto another CONN row. `registerConnectionSource` no-ops them
 * so leftover plugin setup calls cannot create idle ghost rows.
 */
export function isFoldedConnectionSourceId(id: string): boolean {
  return isAdjacentCloudChildSourceId(id)
    || isYahooFragmentSourceId(id)
    || id === GLOOM_CLOUD_SYNC_ALIAS_ID;
}

/**
 * Fold Adjacent Cloud children onto one CONN row, leftover Yahoo fragment
 * ids onto the Yahoo origin, and legacy Gloom Cloud sync onto HTTP.
 * Do not fold Kalshi, Polymarket, YouTube, Yahoo, or RSS into Cloud.
 */
export function resolveConnectionSourceId(id: string): string {
  if (id === ADJACENT_CLOUD_CONNECTION_ID || isAdjacentCloudChildSourceId(id)) {
    return ADJACENT_CLOUD_CONNECTION_ID;
  }
  if (id === YAHOO_CONNECTION_ID || isYahooFragmentSourceId(id)) {
    return YAHOO_CONNECTION_ID;
  }
  if (id === GLOOM_CLOUD_SYNC_ALIAS_ID) {
    return GLOOM_CLOUD_HTTP_CONNECTION_ID;
  }
  return id;
}

export { isHostedWebClient } from "../../../shared/hosted-api";

function withSearch(path: string, search: string): string {
  const qs = !search
    ? ""
    : search.startsWith("?")
      ? search
      : `?${search}`;
  return `${path}${qs}`;
}

/** Same-origin keyed-data URL: `/api/data/{providerId}/{keyPath}`. */
export function keyedDataUrl(providerId: string, keyPath = "", search = ""): string {
  const path = keyPath ? `${providerId}/${keyPath.replace(/^\//, "")}` : providerId;
  return withSearch(`${KEYED_DATA_PATH}/${path}`, search);
}

/** @deprecated Use {@link keyedDataUrl}. */
export function adjacentCloudDataUrl(providerId: string, keyPath = "", search = ""): string {
  return keyedDataUrl(providerId, keyPath, search);
}

/**
 * Blocker-safe twin of {@link keyedDataUrl} for the Adjacent provider:
 * `/api/feed/mkt/{keyPath}`.
 *
 * Filter lists match `/api/data/adjacent`, and a blocked request never reaches
 * the network, so retrying the same path can never succeed.
 */
export function adjacentCloudDataAliasUrl(keyPath = "", search = ""): string {
  const path = keyPath
    ? `${ADJACENT_DATA_ALIAS_ID}/${keyPath.replace(/^\//, "")}`
    : ADJACENT_DATA_ALIAS_ID;
  return withSearch(`${KEYED_DATA_ALIAS_PATH}/${path}`, search);
}
