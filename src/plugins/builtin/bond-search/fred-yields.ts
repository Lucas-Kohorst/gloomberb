import { apiClient, type CloudYieldPointPayload } from "../../../api-client";
import { loadCachedFredSeries } from "../../../data/fred-series";
import { withConnectionRequest } from "../connections/register";
import type { CorporateYieldEntry } from "./types";

export const FRED_CORPORATE_YIELDS_CONNECTION_ID = "fred-corporate-yields";

export interface CorporateSeriesMeta {
  seriesId: string;
  label: string;
  rating: string;
  maturityRange: string;
  /** Treasury maturity used as the spread benchmark. */
  treasuryMaturity: string;
}

/**
 * ICE BofA US corporate yield indices, published daily by FRED. These are
 * option-adjusted yields for broadly held corporate indices broken out by
 * rating tier and maturity bucket. No auth required — fetched through the
 * existing cloud FRED proxy.
 */
export const CORPORATE_SERIES: readonly CorporateSeriesMeta[] = [
  { seriesId: "BAMLC0A1CAAA", label: "IG AAA", rating: "AAA", maturityRange: "All", treasuryMaturity: "10Y" },
  { seriesId: "BAMLC0A2A", label: "IG AA", rating: "AA", maturityRange: "All", treasuryMaturity: "10Y" },
  { seriesId: "BAMLC0A3A", label: "IG A", rating: "A", maturityRange: "All", treasuryMaturity: "10Y" },
  { seriesId: "BAMLC0A4CBBB", label: "IG BBB", rating: "BBB", maturityRange: "All", treasuryMaturity: "10Y" },
  { seriesId: "BAMLC0A0CM", label: "IG All-Rated", rating: "IG", maturityRange: "All", treasuryMaturity: "10Y" },
  { seriesId: "BAMLH0A0HYM", label: "High Yield", rating: "HY", maturityRange: "All", treasuryMaturity: "10Y" },
  { seriesId: "BAMLC0A0C13Y", label: "IG 1-3Y", rating: "IG", maturityRange: "1-3Y", treasuryMaturity: "2Y" },
  { seriesId: "BAMLC0A0C510Y", label: "IG 5-10Y", rating: "IG", maturityRange: "5-10Y", treasuryMaturity: "10Y" },
];

export interface TreasuryYieldMap {
  [maturity: string]: number | null;
}

export async function loadTreasuryYieldMap(): Promise<TreasuryYieldMap> {
  const points: CloudYieldPointPayload[] = await apiClient.getCloudYieldCurve();
  const map: TreasuryYieldMap = {};
  for (const point of points) map[point.maturity] = point.yield;
  return map;
}

function latestStartDate(): string {
  // 60 days of history is plenty to find the most recent published value, even
  // across weekends/holidays. Sorted descending so the head is the latest.
  const days = 60;
  const when = new Date();
  when.setUTCDate(when.getUTCDate() - days);
  return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}-${String(when.getUTCDate()).padStart(2, "0")}`;
}

export async function loadCorporateYields(force = false): Promise<CorporateYieldEntry[]> {
  const startDate = latestStartDate();
  // Treasury curve is best-effort: a failure to fetch it should not block the
  // yields table — spreads just become unavailable.
  const treasuryMap = await loadTreasuryYieldMap().catch(() => ({}) as TreasuryYieldMap);

  const entries = await Promise.all(
    CORPORATE_SERIES.map(async (meta): Promise<CorporateYieldEntry> => {
      const result = await withConnectionRequest(
        FRED_CORPORATE_YIELDS_CONNECTION_ID,
        meta.seriesId,
        () =>
          loadCachedFredSeries(
            { seriesId: meta.seriesId, startDate, sortOrder: "desc" },
            () =>
              apiClient.getCloudFredSeries(meta.seriesId, {
                startDate,
                sortOrder: "desc",
                limit: 5,
              }),
            { force },
          ),
      );
      const observations = result.data.observations;
      // Descending sort means the first non-null observation is the latest.
      const latest = observations.find((obs) => obs.value != null) ?? null;
      const yieldValue = latest?.value ?? null;
      const treasuryYield = treasuryMap[meta.treasuryMaturity] ?? null;
      const spreadBp =
        yieldValue != null && treasuryYield != null
          ? Math.round((yieldValue - treasuryYield) * 100)
          : null;
      return {
        seriesId: meta.seriesId,
        label: meta.label,
        rating: meta.rating,
        maturityRange: meta.maturityRange,
        yield: yieldValue,
        treasuryYield,
        spreadBp,
        updatedAt: latest?.date ? new Date(`${latest.date}T00:00:00Z`) : null,
      };
    }),
  );

  return entries;
}
