import type { PaneSettingsDef } from "../../../types/plugin";
import type { CashFlowPeriod } from "./model";

export const CASH_FLOW_DEFAULTS = {
  period: "annual",
} as const satisfies { period: CashFlowPeriod };

export function buildCashFlowSettingsDef(): PaneSettingsDef {
  return {
    title: "Cash Flow Settings",
    fields: [
      {
        key: "period",
        label: "Period",
        type: "select",
        options: [
          { value: "annual", label: "Annual" },
          { value: "quarterly", label: "Quarterly" },
        ],
      },
    ],
  };
}
