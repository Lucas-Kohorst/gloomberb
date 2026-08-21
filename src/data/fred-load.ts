import { apiClient, type CloudFredSeriesPayload } from "../api-client";
import type { CloudFredSeriesParams } from "../api-client/paths";
import { fetchPublicFredSeries } from "./fred-public";

/**
 * Gloom Cloud FRED is allowlisted for the econ calendar / yield-curve bundle.
 * Corporate, credit, and VIX series 500 there, so fall back to the public
 * FRED CSV (via httpFetch, which the hosted worker already proxies).
 */
export async function loadFredSeriesPayload(
  seriesId: string,
  params: CloudFredSeriesParams = {},
): Promise<CloudFredSeriesPayload> {
  try {
    return await apiClient.getCloudFredSeries(seriesId, params);
  } catch {
    return fetchPublicFredSeries(seriesId, params);
  }
}
