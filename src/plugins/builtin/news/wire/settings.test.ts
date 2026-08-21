import { describe, expect, test } from "bun:test";
import { buildNewsPaneSettingsDef, getNewsPaneSettings } from "./settings";

describe("news pane settings", () => {
  test("keeps headline visible and encodes the default sort", () => {
    const definition = buildNewsPaneSettingsDef(
      { columnIds: ["time", "tickers"], sort: "source:asc" },
      { columns: ["time", "source", "title", "tickers"], sort: { columnId: "time", direction: "desc" } },
    );
    expect(definition.values?.columnIds).toEqual(["time", "tickers", "title"]);
    expect(definition.values?.sort).toBe("source:asc");
    expect(definition.fields.map((field) => field.key)).toEqual(["columnIds", "sort"]);
  });

  test("falls back to the pane's own columns and sort", () => {
    expect(getNewsPaneSettings({}, {
      columns: ["time", "title", "importance"],
      sort: { columnId: "importance", direction: "desc" },
    })).toEqual({
      columnIds: ["time", "title", "importance"],
      sort: { columnId: "importance", direction: "desc" },
    });
  });
});
