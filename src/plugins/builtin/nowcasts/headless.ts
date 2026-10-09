import type { HeadlessPaneDefinition, HeadlessPaneRow } from "../../../types/plugin";
import { fetchNowcasts } from "./client";
import { formatNowcastChange, formatNowcastValue, newestAsOf } from "./model";

function decimalsOf(row: HeadlessPaneRow): number {
  return typeof row.decimals === "number" ? row.decimals : 2;
}

function level(value: unknown, row: HeadlessPaneRow): string {
  return formatNowcastValue(typeof value === "number" ? value : null, decimalsOf(row));
}

function change(value: unknown, row: HeadlessPaneRow): string {
  return formatNowcastChange(typeof value === "number" ? value : null, decimalsOf(row));
}

export const nowcastsHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "none" },
  options: [],
  describe: "Latest sticky CPI, median CPI, and financial conditions",
  discovery: {
    aliases: ["NOW"],
    dataRequirements: ["Sticky CPI, median CPI, and financial conditions"],
    limitations: [
      "One row per series, the latest observation",
      "A series that returns no rows is omitted",
    ],
  },
  async load() {
    const rows = await fetchNowcasts();
    return {
      complete: true,
      sections: [{
        title: "Nowcasts",
        columns: [
          { key: "measure", header: "Measure" },
          { key: "asOf", header: "As of" },
          { key: "latest", header: "Latest", align: "right", format: level },
          { key: "previous", header: "Previous", align: "right", format: level },
          { key: "change", header: "Change", align: "right", format: change },
        ],
        rows: rows.map((row) => ({
          measure: row.measure,
          asOf: row.asOf,
          latest: row.latest,
          previous: row.previous,
          change: row.change,
          decimals: row.decimals,
        })),
      }],
      metadata: { asOf: newestAsOf(rows) },
    };
  },
};
