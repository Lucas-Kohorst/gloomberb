import type { OwidChartPrint, OwidChartSearchHit, OwidEntity, OwidObservation } from "../../../sources/owid/types";
import { findOwidCatalogEntryBySlug, owidCatalogSearchText } from "./catalog";

function latestObservation(print: OwidChartPrint, code: string): OwidObservation | null {
  const rows = print.observations.filter((row) => row.code === code && row.value != null);
  return rows.at(-1) ?? null;
}

export function entityLatestRows(print: OwidChartPrint): Array<OwidEntity & { latest: number | null; time: string | null }> {
  return print.entities.map((entity) => {
    const latest = latestObservation(print, entity.code);
    return {
      ...entity,
      latest: latest?.value ?? null,
      time: latest?.time ?? null,
    };
  });
}

export function filterChartHits(hits: readonly OwidChartSearchHit[], query: string): OwidChartSearchHit[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...hits];
  return hits.filter((hit) => {
    const catalog = findOwidCatalogEntryBySlug(hit.slug);
    const hay = [
      hit.title,
      hit.slug,
      hit.slug.replaceAll("-", " "),
      hit.subtitle,
      catalog ? owidCatalogSearchText(catalog) : "",
    ].join(" ").toLowerCase();
    return tokens.every((token) => hay.includes(token) || hit.slug.includes(token));
  });
}
