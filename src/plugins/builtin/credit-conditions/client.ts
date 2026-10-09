import { apiClient, type CloudFredSeriesPayload } from "../../../api-client";
import {
  getCachedFredSeries,
  loadCachedFredSeries,
  type FredSeriesRequest,
} from "../../../sources/gloomberb-cloud/fred-series";
import {
  CREDIT_SERIES,
  CREDIT_YIELD_SERIES,
  normalizeCreditSeries,
  normalizeCreditYieldSeries,
  type CreditConditionRow,
  type CreditYieldRow,
  type CreditYieldSeriesId,
} from "./model";

export interface CreditConditionsLoadResult {
  rows: CreditConditionRow[];
  stale: boolean;
  errors: string[];
}

/** A year of business-day closes plus holidays, for the 1Y rank and history chart. */
const HISTORY_LIMIT = 300;

export type CreditSeriesLoader = (
  seriesId: string,
  options: { limit: number; sortOrder: "desc" },
) => Promise<CloudFredSeriesPayload>;

export type CreditYieldBoardRow =
  | (CreditYieldRow & { status: "available" })
  | { seriesId: CreditYieldSeriesId; label: string; status: "unavailable"; error: string };

export interface CreditYieldLoadResult {
  rows: CreditYieldBoardRow[];
  stale: boolean;
  errors: string[];
}

export interface CreditBoardLoadResult extends CreditConditionsLoadResult {
  yields: CreditYieldBoardRow[];
}

function requestFor(seriesId: string): FredSeriesRequest {
  return { seriesId, limit: HISTORY_LIMIT, sortOrder: "desc" };
}

function trimHistory(data: CloudFredSeriesPayload): CloudFredSeriesPayload {
  return { ...data, observations: data.observations.slice(0, HISTORY_LIMIT) };
}

function seriesError(seriesId: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith(`${seriesId}:`) ? message : `${seriesId}: ${message}`;
}

export function getCachedCreditConditions(): CreditConditionsLoadResult | null {
  const rows: CreditConditionRow[] = [];
  const errors: string[] = [];
  for (const definition of CREDIT_SERIES) {
    const cached = getCachedFredSeries(requestFor(definition.seriesId), { allowExpired: true });
    if (!cached) continue;
    try {
      // The pane revalidates this copy on mount; only the source or a failed refresh makes it stale.
      rows.push(normalizeCreditSeries(definition, cached.data, cached.data.stale === true));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return rows.length === 0 ? null : {
    rows,
    stale: rows.some((row) => row.stale),
    errors,
  };
}

async function loadSeries(
  definition: typeof CREDIT_SERIES[number],
  force: boolean,
  loader: CreditSeriesLoader,
) {
  const request = requestFor(definition.seriesId);
  const result = await loadCachedFredSeries(
    request,
    async () => {
      const data = trimHistory(await loader(definition.seriesId, {
        limit: HISTORY_LIMIT,
        sortOrder: "desc",
      }));
      // Reject incompatible source responses before they replace usable cache.
      // The shared cache can then retain the dated prior value as stale fallback.
      normalizeCreditSeries(definition, data);
      return data;
    },
    { force },
  );
  return {
    row: normalizeCreditSeries(definition, result.data, result.stale),
    refreshError: result.refreshError,
  };
}

export async function loadCreditConditions(
  force = false,
  loader: CreditSeriesLoader = (seriesId, options) => apiClient.getCloudFredSeries(seriesId, options),
): Promise<CreditConditionsLoadResult> {
  const settled = await Promise.allSettled(
    CREDIT_SERIES.map((definition) => loadSeries(definition, force, loader)),
  );
  const rows: CreditConditionRow[] = [];
  const errors: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      const seriesId = CREDIT_SERIES[index]!.seriesId;
      errors.push(seriesError(seriesId, result.reason));
      return;
    }
    rows.push(result.value.row);
    if (result.value.refreshError) errors.push(seriesError(result.value.row.seriesId, result.value.refreshError));
  });
  if (rows.length === 0) throw new Error(summarizeSeriesErrors(errors));
  return { rows, stale: rows.some((row) => row.stale), errors };
}

/**
 * Every series failing is one outage, not six. Joining all of them produced a
 * message several times wider than the pane, which then got cut mid-word.
 */
function summarizeSeriesErrors(errors: readonly string[]): string {
  if (errors.length === 0) return "Credit spread data unavailable";
  const reasons = new Set(errors.map((entry) => entry.replace(/^[A-Z0-9]+:\s*/, "")));
  const reason = reasons.size === 1 ? [...reasons][0]! : `${errors.length} series failed`;
  return errors.length > 1 ? `${reason} (${errors.length} series)` : reason;
}

function treasury10Y(points: readonly { maturity: string; yield: number | null }[]): number | null {
  const point = points.find((entry) => entry.maturity === "10Y");
  return point?.yield != null && Number.isFinite(point.yield) ? point.yield : null;
}

function unavailableYield(definition: typeof CREDIT_YIELD_SERIES[number], error: unknown): CreditYieldBoardRow {
  return { seriesId: definition.seriesId, label: definition.label, status: "unavailable", error: seriesError(definition.seriesId, error) };
}

export function getCachedCreditYields(): CreditYieldLoadResult | null {
  const rows: CreditYieldBoardRow[] = [];
  const errors: string[] = [];
  for (const definition of CREDIT_YIELD_SERIES) {
    const cached = getCachedFredSeries(requestFor(definition.seriesId), { allowExpired: true });
    if (!cached) continue;
    try {
      // Spread waits for the treasury read. A cached yield still paints.
      rows.push({ ...normalizeCreditYieldSeries(definition, cached.data, null, cached.data.stale === true), status: "available" });
    } catch (error) {
      const row = unavailableYield(definition, error);
      rows.push(row);
      errors.push(row.error);
    }
  }
  if (rows.length === 0) return null;
  return { rows, stale: rows.some((row) => row.status === "available" && row.stale), errors };
}

async function loadYieldSeries(
  definition: typeof CREDIT_YIELD_SERIES[number],
  force: boolean,
  loader: CreditSeriesLoader,
) {
  const request = requestFor(definition.seriesId);
  return loadCachedFredSeries(
    request,
    async () => {
      const data = trimHistory(await loader(definition.seriesId, { limit: HISTORY_LIMIT, sortOrder: "desc" }));
      normalizeCreditYieldSeries(definition, data, null);
      return data;
    },
    { force },
  );
}

export async function loadCreditYields(
  force = false,
  loader: CreditSeriesLoader = (seriesId, options) => apiClient.getCloudFredSeries(seriesId, options),
  curve: () => Promise<Array<{ maturity: string; yield: number | null }>> = () => apiClient.getCloudYieldCurve(),
): Promise<CreditYieldLoadResult> {
  const [curveSettled, seriesSettled] = await Promise.all([
    curve()
      .then((points) => ({ points, error: null as string | null }))
      .catch(() => ({ points: [] as Array<{ maturity: string; yield: number | null }>, error: "10-year Treasury unavailable" })),
    Promise.all(CREDIT_YIELD_SERIES.map(async (definition) => {
      try {
        return { definition, result: await loadYieldSeries(definition, force, loader) };
      } catch (error) {
        return { definition, result: null, error };
      }
    })),
  ]);
  const treasury = treasury10Y(curveSettled.points);
  const rows: CreditYieldBoardRow[] = [];
  const errors: string[] = curveSettled.error ? [curveSettled.error] : [];
  for (const entry of seriesSettled) {
    if (!entry.result) {
      const row = unavailableYield(entry.definition, entry.error);
      rows.push(row);
      errors.push(row.error);
      continue;
    }
    try {
      rows.push({
        ...normalizeCreditYieldSeries(entry.definition, entry.result.data, treasury, entry.result.stale),
        status: "available",
      });
      if (entry.result.refreshError) errors.push(seriesError(entry.definition.seriesId, entry.result.refreshError));
    } catch (error) {
      const row = unavailableYield(entry.definition, error);
      rows.push(row);
      errors.push(row.error);
    }
  }
  return { rows, stale: rows.some((row) => row.status === "available" && row.stale), errors };
}

/** OAS rows stay up when a yield is rejected. Yields stay up when every OAS series fails. */
export async function loadCreditBoard(
  force = false,
  loader?: CreditSeriesLoader,
  curve?: () => Promise<Array<{ maturity: string; yield: number | null }>>,
): Promise<CreditBoardLoadResult> {
  const [spreads, yields] = await Promise.all([
    loadCreditConditions(force, loader).then((value) => ({ ok: true as const, value })).catch((error: unknown) => ({ ok: false as const, error })),
    loadCreditYields(force, loader, curve),
  ]);
  if (!spreads.ok && yields.rows.every((row) => row.status !== "available")) {
    throw spreads.error instanceof Error ? spreads.error : new Error(summarizeSeriesErrors([seriesError("credit", spreads.error)]));
  }
  const spreadError = spreads.ok ? null : seriesError("credit", spreads.error);
  return {
    rows: spreads.ok ? spreads.value.rows : [],
    yields: yields.rows,
    stale: (spreads.ok && spreads.value.stale) || yields.stale,
    errors: [...(spreads.ok ? spreads.value.errors : spreadError ? [spreadError] : []), ...yields.errors],
  };
}

export function getCachedCreditBoard(): CreditBoardLoadResult | null {
  const spreads = getCachedCreditConditions();
  const yields = getCachedCreditYields();
  if (!spreads && !yields) return null;
  return {
    rows: spreads?.rows ?? [],
    yields: yields?.rows ?? [],
    stale: (spreads?.stale ?? false) || (yields?.stale ?? false),
    errors: [...(spreads?.errors ?? []), ...(yields?.errors ?? [])],
  };
}
