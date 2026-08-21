/** Single Connections-pane row for every Adjacent Cloud keyed-data provider. */
export const ADJACENT_CLOUD_CONNECTION_ID = "adjacent-cloud";

/** Worker provider ids served by GET `/api/data/{provider}` on gloomberb-cloud. */
export const ADJACENT_CLOUD_PROVIDER_IDS = [
  "twc-kalshi",
  "nws-cli",
  "llm-stats",
  "adjacent",
  "votehub",
  "us-listings",
  "owid",
] as const;

const ADJACENT_CLOUD_PROVIDER_ID_SET = new Set<string>(ADJACENT_CLOUD_PROVIDER_IDS);

/** True for upstream prints that already traffic through Adjacent Cloud. */
export function isAdjacentCloudChildSourceId(id: string): boolean {
  return ADJACENT_CLOUD_PROVIDER_ID_SET.has(id);
}

/** Fold VoteHub / TWC / OWID / … reports onto the Adjacent Cloud connection. */
export function resolveConnectionSourceId(id: string): string {
  if (id === ADJACENT_CLOUD_CONNECTION_ID || isAdjacentCloudChildSourceId(id)) {
    return ADJACENT_CLOUD_CONNECTION_ID;
  }
  return id;
}

export function isHostedWebClient(): boolean {
  try {
    return (globalThis as { __GLOOM_CLOUD_HOSTED?: boolean }).__GLOOM_CLOUD_HOSTED === true;
  } catch {
    return false;
  }
}

/** Same-origin Adjacent Cloud keyed-data URL: `/api/data/{providerId}/{keyPath}`. */
export function adjacentCloudDataUrl(providerId: string, keyPath = "", search = ""): string {
  const path = keyPath ? `${providerId}/${keyPath.replace(/^\//, "")}` : providerId;
  const qs = !search
    ? ""
    : search.startsWith("?")
      ? search
      : `?${search}`;
  return `/api/data/${path}${qs}`;
}
