/**
 * Our World in Data grapher prints.
 *
 * Keyed-data: GET `/api/data/owid/charts?q=` (search),
 * `/api/data/owid/meta/{slug}` (metadata probe), and
 * `/api/data/owid/{slug}` / `/api/data/owid/{slug}/{entity}`.
 * Join key is grapher slug + entity code (ISO alpha-3 or OWID custom), not a
 * market ticker. Public, keyless, CC BY 4.0. Some charts 403 as
 * non-redistributable.
 *
 * No API keys. Secrets never leave the Worker (none are required here).
 */

export const OWID_PROVIDER_ID = "owid";
export const OWID_TTL_SECONDS = 6 * 60 * 60;
export const OWID_USER_AGENT = "gloomberb-owid";
export const OWID_ORIGIN = "https://ourworldindata.org";
export const OWID_LICENSE = "CC BY 4.0";

export const OWID_RESERVED_PATHS = new Set(["charts", "meta"]);

export interface OwidChartSearchHit {
  title: string;
  slug: string;
  subtitle: string | null;
  url: string;
  availableEntities: string[];
}

export interface OwidChartSearchPrint {
  query: string;
  page: number;
  hitsPerPage: number;
  nbHits: number;
  license: typeof OWID_LICENSE;
  results: OwidChartSearchHit[];
}

export interface OwidEntity {
  code: string;
  name: string;
}

export interface OwidObservation {
  entity: string;
  code: string;
  time: string;
  value: number | null;
}

export interface OwidChartMetadataPrint {
  slug: string;
  title: string;
  subtitle: string | null;
  citation: string | null;
  unit: string | null;
  license: typeof OWID_LICENSE;
  url: string;
  entities: OwidEntity[];
}

export interface OwidChartPrint {
  slug: string;
  title: string;
  subtitle: string | null;
  citation: string | null;
  unit: string | null;
  columnTitle: string | null;
  timeKind: "year" | "day";
  license: typeof OWID_LICENSE;
  url: string;
  entity: OwidEntity | null;
  entities: OwidEntity[];
  observations: OwidObservation[];
}

export class OwidUpstreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OwidUpstreamError";
    this.status = status;
  }
}
