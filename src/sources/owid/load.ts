import {
  normalizeOwidEntityCode,
  normalizeOwidSlug,
  parseOwidCsvPrint,
  parseOwidMetadataPrint,
  parseOwidSearchPrint,
} from "./parse";
import {
  OWID_ORIGIN,
  OWID_USER_AGENT,
  OwidUpstreamError,
  type OwidChartMetadataPrint,
  type OwidChartPrint,
  type OwidChartSearchPrint,
} from "./types";

function headers(accept: string): HeadersInit {
  return {
    Accept: accept,
    "User-Agent": OWID_USER_AGENT,
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = response.status === 403
    ? "This OWID chart is not redistributable."
    : `OWID request failed (${response.status}).`;
  try {
    const body = await response.json() as { error?: unknown; message?: unknown };
    const message = typeof body.message === "string" && body.message.trim()
      ? body.message.trim()
      : typeof body.error === "string" && body.error.trim()
        ? body.error.trim()
        : fallback;
    return response.status === 403
      ? `${message} OWID marks some charts as non-redistributable (HTTP 403).`
      : message;
  } catch {
    return fallback;
  }
}

async function fetchOwid(fetchImpl: typeof fetch, url: string, accept: string): Promise<Response> {
  const response = await fetchImpl(url, { headers: headers(accept) });
  if (response.ok) return response;
  throw new OwidUpstreamError(await readErrorMessage(response), response.status);
}

export function owidSearchUrl(query: string, page = 0, hitsPerPage = 20): string {
  const params = new URLSearchParams({
    type: "charts",
    q: query,
    page: String(page),
    hitsPerPage: String(hitsPerPage),
  });
  return `${OWID_ORIGIN}/api/search?${params.toString()}`;
}

export function owidCsvUrl(slug: string, entity: string | null): string {
  const params = new URLSearchParams({ csvType: entity ? "filtered" : "full" });
  if (entity) params.set("country", entity);
  return `${OWID_ORIGIN}/grapher/${slug}.csv?${params.toString()}`;
}

export function owidMetadataUrl(slug: string): string {
  return `${OWID_ORIGIN}/grapher/${slug}.metadata.json`;
}

export async function loadOwidChartSearch(
  options: {
    query: string;
    page?: number;
    hitsPerPage?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<OwidChartSearchPrint> {
  const query = options.query.trim();
  const page = options.page ?? 0;
  const hitsPerPage = options.hitsPerPage ?? 20;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchOwid(fetchImpl, owidSearchUrl(query, page, hitsPerPage), "application/json");
  return parseOwidSearchPrint(await response.json(), query, page, hitsPerPage);
}

export async function loadOwidChartMetadata(
  options: {
    slug: string;
    fetchImpl?: typeof fetch;
  },
): Promise<OwidChartMetadataPrint> {
  const slug = normalizeOwidSlug(options.slug);
  if (!slug) {
    throw new OwidUpstreamError("Invalid OWID chart slug.", 400);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchOwid(fetchImpl, owidMetadataUrl(slug), "application/json");
  return parseOwidMetadataPrint(await response.json(), slug);
}

export async function loadOwidChartPrint(
  options: {
    slug: string;
    entity?: string | null;
    fetchImpl?: typeof fetch;
  },
): Promise<OwidChartPrint> {
  const slug = normalizeOwidSlug(options.slug);
  if (!slug) {
    throw new OwidUpstreamError("Invalid OWID chart slug.", 400);
  }
  const entity = options.entity ? normalizeOwidEntityCode(options.entity) : null;
  if (options.entity && !entity) {
    throw new OwidUpstreamError("Invalid OWID entity code.", 400);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const [csvResponse, metaResponse] = await Promise.all([
    fetchOwid(fetchImpl, owidCsvUrl(slug, entity), "text/csv"),
    fetchOwid(fetchImpl, owidMetadataUrl(slug), "application/json"),
  ]);
  const [csvText, metadata] = await Promise.all([csvResponse.text(), metaResponse.json()]);
  const print = parseOwidCsvPrint(csvText, metadata, slug, entity);
  if (entity && print.observations.length === 0) {
    throw new OwidUpstreamError(`No OWID series for ${slug}:${entity}.`, 404);
  }
  return print;
}
