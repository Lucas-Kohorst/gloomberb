import type { PaneSettingsDef } from "../../../types/plugin";
import type { StatRangeId } from "./view";

export const ECON_STATISTICS_DEFAULTS = {
  range: "20Y",
} as const satisfies { range: StatRangeId };

export const RANGE_OPTIONS = [
  { value: "5Y" as const, label: "5Y" },
  { value: "20Y" as const, label: "20Y" },
  { value: "ALL" as const, label: "ALL" },
];

export function buildEconStatisticsSettingsDef(): PaneSettingsDef {
  return {
    title: "Economic Statistics Settings",
    fields: [
      {
        key: "range",
        label: "History",
        type: "select",
        options: RANGE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
      },
    ],
  };
}
