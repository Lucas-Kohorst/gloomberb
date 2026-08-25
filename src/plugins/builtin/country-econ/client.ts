import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { adjacentCloudDataUrl, isHostedWebClient } from "../connections/adjacent-cloud";
import { COUNTRY_ECON_INDICATORS } from "./indicators";
import { parseWorldBankPayload } from "./normalize";
import { WORLD_BANK_CONNECTION_ID, type CountryEconRow } from "./types";

const CLIENT = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 20_000,
  backoffBaseMs: 400,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-world-bank",
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

function indicatorUrl(wbCode: string): { desktop: string; keyPath: string; search: string } {
  const search = new URLSearchParams({
    format: "json",
    per_page: "400",
    mrnev: "1",
  });
  return {
    desktop: `https://api.worldbank.org/v2/country/all/indicator/${wbCode}?${search.toString()}`,
    keyPath: `v2/country/all/indicator/${wbCode}`,
    search: search.toString(),
  };
}

export async function loadCountryEcon(indicatorId: string): Promise<CountryEconRow[]> {
  const indicator = COUNTRY_ECON_INDICATORS.find((entry) => entry.id === indicatorId)
    ?? COUNTRY_ECON_INDICATORS[0]!;
  const target = indicatorUrl(indicator.wbCode);
  return withConnectionRequest(WORLD_BANK_CONNECTION_ID, indicator.id, async () => {
    const url = isHostedWebClient()
      ? adjacentCloudDataUrl("world-bank", target.keyPath, target.search)
      : target.desktop;
    const response = await CLIENT.fetch(url);
    if (!response.ok) {
      throw new Error(`World Bank request failed (${response.status})`);
    }
    const payload: unknown = await response.json();
    return parseWorldBankPayload(payload, indicator.unit);
  });
}
