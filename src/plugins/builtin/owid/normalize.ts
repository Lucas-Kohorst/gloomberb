import type { OwidChartPrint, OwidChartSearchHit, OwidEntity, OwidObservation } from "../../../sources/owid/types";

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
  const needle = query.trim().toLowerCase();
  if (!needle) return [...hits];
  return hits.filter((hit) => (
    hit.title.toLowerCase().includes(needle)
    || hit.slug.includes(needle)
    || (hit.subtitle?.toLowerCase().includes(needle) ?? false)
  ));
}
