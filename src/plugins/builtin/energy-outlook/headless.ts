import type { HeadlessPaneColumn, HeadlessPaneDefinition, HeadlessPaneRow } from "../../../types/plugin";
import { fetchEnergyOutlook, type EnergyOutlookData } from "./client";
import { formatEnergyValue, type EnergyTab } from "./model";

const numberText = (value: unknown) => typeof value === "number" ? formatEnergyValue(value) : "--";
const text = (value: unknown) => typeof value === "string" && value ? value : "--";

const OUTLOOK_COLUMNS: HeadlessPaneColumn[] = [
  { key: "name", header: "Name", format: text },
  { key: "period", header: "Period", format: text },
  { key: "value", header: "Value", align: "right", format: numberText },
  { key: "previous", header: "Previous", align: "right", format: numberText },
  { key: "unit", header: "Unit", format: text },
];

const IMPORT_COLUMNS: HeadlessPaneColumn[] = [
  { key: "origin", header: "Origin", format: text },
  { key: "volume", header: "Volume", align: "right", format: numberText },
  { key: "unit", header: "Unit", format: text },
];

const OUTAGE_COLUMNS: HeadlessPaneColumn[] = [
  { key: "facility", header: "Plant", format: text },
  { key: "outage", header: "Outage MW", align: "right", format: numberText },
  { key: "capacity", header: "Capacity MW", align: "right", format: numberText },
  { key: "percent", header: "Out %", align: "right", format: numberText },
];

function tabOf(value: unknown): EnergyTab {
  return value === "imports" || value === "outages" ? value : "outlook";
}

function sectionFor(data: EnergyOutlookData, tab: EnergyTab): { title: string; columns: HeadlessPaneColumn[]; rows: HeadlessPaneRow[]; error: string | null; period: string | null } {
  if (tab === "imports") {
    return {
      title: "Imports",
      columns: IMPORT_COLUMNS,
      rows: data.imports.rows.map(({ id: _id, ...row }) => row),
      error: data.imports.error,
      period: data.imports.period,
    };
  }
  if (tab === "outages") {
    return {
      title: "Outages",
      columns: OUTAGE_COLUMNS,
      rows: data.outages.available ? data.outages.rows.map(({ id: _id, period: _period, ...row }) => row) : [],
      error: data.outages.available ? data.outages.error : "Nuclear outages are not available.",
      period: data.outages.period,
    };
  }
  return {
    title: "Outlook",
    columns: OUTLOOK_COLUMNS,
    rows: data.outlook.rows.map(({ id: _id, ...row }) => row),
    error: data.outlook.error,
    period: data.outlook.rows[0]?.period ?? null,
  };
}

export const energyOutlookHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [{
    key: "tab",
    description: "Outlook, import origins, or nuclear outages.",
    type: "enum",
    values: [{ value: "outlook" }, { value: "imports" }, { value: "outages" }],
    defaultValue: "outlook",
  }],
  discovery: {
    aliases: ["STEO"],
    dataRequirements: ["Monthly short-term energy outlook", "Monthly crude import volumes by origin", "Daily nuclear plant outages"],
    limitations: [
      "Outlook values run through the published forecast, not only history",
      "Import volumes are the latest month, summed across grades at port districts",
      "Outages are the latest reported day",
    ],
  },
  describe: "Energy outlook, crude import origins, and nuclear outages",
  async load(args, ctx) {
    const tab = tabOf(args.options.tab);
    const data = await fetchEnergyOutlook(ctx.signal);
    const section = sectionFor(data, tab);
    const missing = tab === "outages" && !data.outages.available;
    return {
      complete: !section.error && !missing,
      sections: [{ title: section.title, columns: section.columns, rows: section.rows }],
      errors: section.error ? [section.error] : [],
      metadata: { tab, period: section.period },
    };
  },
};
