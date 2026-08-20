import type { KeyedDataProvider, ProviderPlan } from "./types";
import { loadOwidChartPrint, loadOwidChartSearch } from "../../../sources/owid/load";
import { normalizeOwidEntityCode, normalizeOwidSlug } from "../../../sources/owid/parse";
import {
  OWID_PROVIDER_ID,
  OWID_TTL_SECONDS,
  OWID_USER_AGENT,
} from "../../../sources/owid/types";

function parseHitsPerPage(raw: string | null): number | null {
  if (!raw) return 20;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) return null;
  return value;
}

function parsePage(raw: string | null): number | null {
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 50) return null;
  return value;
}

/**
 * Adjacent Cloud OWID origin. Hosted clients call
 * `GET /api/data/owid/charts?q=` and `GET /api/data/owid/{slug}/{entity}`.
 * Desktop hits ourworldindata.org directly. Worker caches CSV + metadata.
 */
export const owidProvider: KeyedDataProvider = {
  id: OWID_PROVIDER_ID,
  name: "Our World in Data",
  ttlSeconds: OWID_TTL_SECONDS,
  userAgent: OWID_USER_AGENT,
  resolve({ keyPath, search }): ProviderPlan {
    const segments = keyPath.split("/").filter(Boolean);
    if (segments.length === 0 || (segments.length === 1 && segments[0] === "charts")) {
      const hitsPerPage = parseHitsPerPage(search.get("hitsPerPage"));
      const page = parsePage(search.get("page"));
      if (hitsPerPage == null) {
        return { kind: "error", status: 400, error: "hitsPerPage must be an integer from 1 to 50." };
      }
      if (page == null) {
        return { kind: "error", status: 400, error: "page must be an integer from 0 to 50." };
      }
      const query = search.get("q")?.trim() ?? "";
      return {
        kind: "print",
        cacheKey: `owid:charts:${query}:${page}:${hitsPerPage}`,
        load: (fetchImpl) => loadOwidChartSearch({ query, page, hitsPerPage, fetchImpl }),
      };
    }

    const slug = normalizeOwidSlug(segments[0] ?? "");
    if (!slug) {
      return { kind: "error", status: 404, error: "Unknown OWID path" };
    }
    const entityRaw = segments[1];
    const entity = entityRaw ? normalizeOwidEntityCode(entityRaw) : null;
    if (entityRaw && !entity) {
      return { kind: "error", status: 400, error: "Invalid OWID entity code." };
    }
    if (segments.length > 2) {
      return { kind: "error", status: 404, error: "Unknown OWID path" };
    }
    return {
      kind: "print",
      cacheKey: `owid:chart:${slug}:${entity ?? ""}`,
      load: (fetchImpl) => loadOwidChartPrint({ slug, entity, fetchImpl }),
    };
  },
};
