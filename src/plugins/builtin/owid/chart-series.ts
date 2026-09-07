import type { TimeSeriesPoint } from "../../../time-series/types";
import type { UniversalSeriesLoadResult } from "../../../time-series/resolve";
import { fetchOwidChart } from "./client";

function owidObservationDate(time: string, timeKind: "year" | "day"): Date | null {
  if (timeKind === "year") {
    const year = Number(time);
    if (!Number.isInteger(year) || year < 1) return null;
    return new Date(Date.UTC(year, 0, 1));
  }
  const parsed = new Date(`${time}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function loadOwidSeries(
  slug: string,
  entity: string,
): Promise<UniversalSeriesLoadResult> {
  const print = await fetchOwidChart(slug, entity);
  const points: TimeSeriesPoint[] = [];
  for (const row of print.observations) {
    if (row.value == null) continue;
    const date = owidObservationDate(row.time, print.timeKind);
    if (!date) continue;
    points.push({
      date,
      observedAt: date,
      value: row.value,
      provenance: { providerId: "owid", quality: "reported" },
    });
  }
  points.sort((left, right) => left.date.getTime() - right.date.getTime());
  const entityLabel = print.entity?.name ?? entity;
  return {
    points,
    unit: print.unit ?? "",
    unitGroup: `owid:${print.slug}`,
    label: print.columnTitle
      ? `${print.columnTitle} · ${entityLabel}`
      : `${print.title} · ${entityLabel}`,
    warning: print.citation ? `${print.license}. ${print.citation}` : print.license,
  };
}
