import type { PaneSettingsDef } from "../../../types/plugin";
import {
  COUNTRY_CYCLE,
  FILTER_CYCLE,
  type CountryFilter,
  type ImpactFilter,
} from "./calendar-model";

export const ECON_CALENDAR_DEFAULTS = {
  impactFilter: "all",
  countryFilter: "all",
} as const satisfies { impactFilter: ImpactFilter; countryFilter: CountryFilter };

const IMPACT_LABELS: Record<ImpactFilter, string> = {
  all: "All",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const COUNTRY_LABELS: Record<CountryFilter, string> = {
  all: "All",
  US: "US",
  G7: "G7",
  EU: "EU",
};

function isImpactFilter(value: unknown): value is ImpactFilter {
  return FILTER_CYCLE.includes(value as ImpactFilter);
}

function isCountryFilter(value: unknown): value is CountryFilter {
  return COUNTRY_CYCLE.includes(value as CountryFilter);
}

export function getEconCalendarSettings(settings: Record<string, unknown> | undefined): {
  impactFilter: ImpactFilter;
  countryFilter: CountryFilter;
} {
  return {
    impactFilter: isImpactFilter(settings?.impactFilter)
      ? settings.impactFilter
      : ECON_CALENDAR_DEFAULTS.impactFilter,
    countryFilter: isCountryFilter(settings?.countryFilter)
      ? settings.countryFilter
      : ECON_CALENDAR_DEFAULTS.countryFilter,
  };
}

export function buildEconCalendarSettingsDef(): PaneSettingsDef {
  return {
    title: "Economic Calendar Settings",
    fields: [
      {
        key: "impactFilter",
        label: "Impact",
        type: "select",
        options: FILTER_CYCLE.map((value) => ({ value, label: IMPACT_LABELS[value] })),
      },
      {
        key: "countryFilter",
        label: "Country",
        type: "select",
        options: COUNTRY_CYCLE.map((value) => ({ value, label: COUNTRY_LABELS[value] })),
      },
    ],
  };
}
