import type { CorporateActionsData } from "../types/financials";
import type { TimeSeriesPoint } from "./types";

export function extractDividendSeries(actions: CorporateActionsData | null | undefined): TimeSeriesPoint[] {
  if (!actions) return [];
  return actions.dividends
    .flatMap((dividend) => {
      if (!Number.isFinite(dividend.amount)) return [];
      const date = /^\d{4}-\d{2}-\d{2}$/.test(dividend.exDate)
        ? new Date(`${dividend.exDate}T00:00:00.000Z`)
        : new Date(dividend.exDate);
      if (Number.isNaN(date.getTime())) return [];
      return [{
        date,
        observedAt: date,
        availableAt: date,
        value: dividend.amount,
        provenance: {
          providerId: actions.providerId,
          quality: "reported" as const,
        },
      }];
    })
    .sort((left, right) => left.date.getTime() - right.date.getTime());
}
