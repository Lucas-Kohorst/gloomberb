import { createThrottledFetch } from "../../../utils/throttled-fetch";
import { httpFetch } from "../../../utils/http-transport";
import { withConnectionRequest } from "../connections/register";
import { keyedDataUrl, isHostedWebClient } from "../connections/adjacent-cloud";
import { loadOwidChartMetadata, loadOwidChartPrint, loadOwidChartSearch } from "../../../sources/owid/load";
import type { OwidChartMetadataPrint, OwidChartPrint, OwidChartSearchPrint } from "../../../sources/owid/types";
import { OWID_CONNECTION_ID } from "./types";

const CLIENT = createThrottledFetch({
  requestsPerMinute: 20,
  maxRetries: 2,
  timeoutMs: 15_000,
  backoffBaseMs: 400,
  dedupeGetRequests: true,
  defaultHeaders: {
    Accept: "application/json",
    "User-Agent": "gloomberb-owid",
  },
  transport: (url, init) => {
    if (url.startsWith("/")) return globalThis.fetch(url, init);
    return httpFetch(url, init);
  },
});

function hostedFetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return CLIENT.fetch(String(input), init);
}

async function readHostedJson<T>(keyPath: string, search = ""): Promise<T> {
  const response = await CLIENT.fetch(keyedDataUrl("owid", keyPath, search));
  if (!response.ok) {
    let detail = `OWID request failed (${response.status})`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // keep fallback
    }
    const error = new Error(detail) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

export async function fetchOwidChartSearch(query: string): Promise<OwidChartSearchPrint> {
  return withConnectionRequest(OWID_CONNECTION_ID, "search", async () => {
    if (isHostedWebClient()) {
      const search = new URLSearchParams({ q: query, type: "charts" });
      return readHostedJson<OwidChartSearchPrint>("charts", search.toString());
    }
    return loadOwidChartSearch({ query, fetchImpl: hostedFetchImpl as typeof fetch });
  });
}

export async function fetchOwidChartMetadata(slug: string): Promise<OwidChartMetadataPrint> {
  return withConnectionRequest(OWID_CONNECTION_ID, "metadata", async () => {
    if (isHostedWebClient()) {
      return readHostedJson<OwidChartMetadataPrint>(`meta/${slug}`);
    }
    return loadOwidChartMetadata({ slug, fetchImpl: hostedFetchImpl as typeof fetch });
  });
}

export async function fetchOwidChart(slug: string, entity?: string | null): Promise<OwidChartPrint> {
  const keyPath = entity ? `${slug}/${entity}` : slug;
  return withConnectionRequest(OWID_CONNECTION_ID, "chart", async () => {
    if (isHostedWebClient()) {
      return readHostedJson<OwidChartPrint>(keyPath);
    }
    return loadOwidChartPrint({ slug, entity, fetchImpl: hostedFetchImpl as typeof fetch });
  });
}
