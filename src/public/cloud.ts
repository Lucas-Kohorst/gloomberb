/**
 * Cloud calendars and series an external plugin can read. Quotes and price
 * history stay on the market-data client. Mortgage series are not here.
 */
import { apiClient } from "../api-client";
import type { EarningsCalendarPayload, EarningsCalendarQuery } from "../api-client/earnings";
import type { CloudFredSeriesParams } from "../api-client/paths";
import type { RatePathPayload } from "../api-client/rates";
import type { CloudEconEventPayload, CloudFredSeriesPayload } from "../api-client/types";

export type {
  EarningsCalendarPayload,
  EarningsCalendarQuery,
  EarningsCalendarReport,
} from "../api-client/earnings";
export type { CloudFredSeriesParams } from "../api-client/paths";
export type { RateMeeting, RatePathPayload } from "../api-client/rates";
export type {
  CloudEconEventPayload,
  CloudFredObservationPayload,
  CloudFredSeriesPayload,
} from "../api-client/types";

export function loadEarningsCalendar(query: EarningsCalendarQuery): Promise<EarningsCalendarPayload> {
  return apiClient.getCloudEarningsCalendar(query);
}

export function loadEconomicCalendar(): Promise<CloudEconEventPayload[]> {
  return apiClient.getCloudEconomicCalendar();
}

export function loadFredSeries(
  seriesId: string,
  params: CloudFredSeriesParams = {},
): Promise<CloudFredSeriesPayload> {
  return apiClient.getCloudFredSeries(seriesId, params);
}

export function loadRatePath(): Promise<RatePathPayload> {
  return apiClient.getCloudRatePath();
}
