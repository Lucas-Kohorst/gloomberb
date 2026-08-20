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
