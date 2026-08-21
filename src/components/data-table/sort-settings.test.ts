import { describe, expect, test } from "bun:test";
import {
  buildSortSelectField,
  encodeSortPreference,
  parseSortPreference,
} from "./sort-settings";

const COLUMNS = ["time", "title"] as const;

describe("sort settings", () => {
  test("encodes and parses column:direction strings", () => {
    const encoded = encodeSortPreference({ columnId: "time", direction: "desc" });
    expect(encoded).toBe("time:desc");
    expect(parseSortPreference(encoded, COLUMNS, { columnId: "title", direction: "asc" })).toEqual({
      columnId: "time",
      direction: "desc",
    });
  });

  test("accepts the object shape already stored by some panes", () => {
    expect(parseSortPreference(
      { columnId: "title", direction: "asc" },
      COLUMNS,
      { columnId: "time", direction: "desc" },
    )).toEqual({ columnId: "title", direction: "asc" });
  });

  test("falls back when the column is unknown", () => {
    const fallback = { columnId: "time" as const, direction: "desc" as const };
    expect(parseSortPreference("missing:asc", COLUMNS, fallback)).toEqual(fallback);
    expect(parseSortPreference(undefined, COLUMNS, fallback)).toEqual(fallback);
  });

  test("builds a select field of encoded sort options", () => {
    const field = buildSortSelectField([
      { value: "time:desc", label: "Newest first" },
      { value: "title:asc", label: "Headline A–Z" },
    ]);
    expect(field).toMatchObject({
      key: "sort",
      type: "select",
      options: [
        { value: "time:desc", label: "Newest first" },
        { value: "title:asc", label: "Headline A–Z" },
      ],
    });
  });
});
