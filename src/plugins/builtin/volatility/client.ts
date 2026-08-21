import { loadFredSeriesPayload } from "../../../data/fred-load";
import {
  getCachedFredSeries,
  loadCachedFredSeries,
  type FredSeriesRequest,
} from "../../../data/fred-series";
import { withConnectionRequest } from "../connections/register";
import { buildVolData } from "./model";
import type { VolData } from "./types";

export const VOL_SERIES_IDS = ["VIXCLS", "VXVCLS", "VXMTCLS"] as const;
export type VolSeriesId = (typeof VOL_SERIES_IDS)[number];

const CONNECTION_SOURCE_ID = "fred-volatility";

/** Start date for sparkline history — ~60 trading days back. */
function startDateMonthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function seriesRequest(seriesId: string): FredSeriesRequest {
  return {
    seriesId,
    startDate: startDateMonthsAgo(3),
    sortOrder: "asc",
  };
}

/** Get instant cached data for all three series (for initial render). */
export function getCachedVolData(): VolData | null {
  const observations = VOL_SERIES_IDS.map((id) => {
    const cached = getCachedFredSeries(seriesRequest(id));
    return cached?.data.observations ?? null;
  });

  if (!observations.some((obs) => obs != null && obs.length > 0)) return null;
  return buildVolData(observations[0] ?? [], observations[1] ?? [], observations[2] ?? []);
}

async function fetchSeries(seriesId: string, force: boolean) {
  const request = seriesRequest(seriesId);
  const result = await withConnectionRequest(
    CONNECTION_SOURCE_ID,
    `FRED ${seriesId}`,
    () =>
      loadCachedFredSeries(
        request,
        () => loadFredSeriesPayload(request.seriesId, {
          startDate: request.startDate,
          sortOrder: request.sortOrder,
        }),
        { force },
      ),
  );
  return result.data.observations;
}

/**
 * Fetch VIX, VXV, and VXMT from FRED via the cached series system.
 * Falls back gracefully if VXMTCLS is unavailable.
 */
export async function loadVolData(force = false): Promise<VolData> {
  const observations = await Promise.all(
    VOL_SERIES_IDS.map((id) =>
      fetchSeries(id, force).catch((err) => {
        // VXMTCLS may have limited history; don't let it fail the whole pane
        if (id === "VXMTCLS") {
          console.warn(`[volatility] ${id} unavailable:`, err);
          return [] as Awaited<ReturnType<typeof fetchSeries>>;
        }
        throw err;
      }),
    ),
  );

  return buildVolData(observations[0]!, observations[1]!, observations[2]!);
}
