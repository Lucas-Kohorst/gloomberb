import { describe, expect, test } from "bun:test";
import {
  buildColumnVisibilityField,
  resolveVisibleColumns,
} from "./column-settings";

const COLUMNS = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];
const DEFAULTS = ["a", "b"];

describe("resolveVisibleColumns", () => {
  test("uses saved ids in order when present", () => {
    expect(
      resolveVisibleColumns(COLUMNS, ["c", "a"], DEFAULTS).map((column) => column.id),
    ).toEqual(["c", "a"]);
  });

  test("falls back to defaults when nothing is saved", () => {
    expect(resolveVisibleColumns(COLUMNS, undefined, DEFAULTS).map((column) => column.id)).toEqual(["a", "b"]);
    expect(resolveVisibleColumns(COLUMNS, [], DEFAULTS).map((column) => column.id)).toEqual(["a", "b"]);
    expect(resolveVisibleColumns(COLUMNS, "nonsense", DEFAULTS).map((column) => column.id)).toEqual(["a", "b"]);
  });

  test("falls back to defaults when saved ids no longer resolve", () => {
    expect(resolveVisibleColumns(COLUMNS, ["removed"], DEFAULTS).map((column) => column.id)).toEqual(["a", "b"]);
  });
});

describe("buildColumnVisibilityField", () => {
  test("exposes every column as an ordered-multi-select option", () => {
    const field = buildColumnVisibilityField([
      { id: "a", label: "A", description: "First" },
      { id: "b", label: "B" },
    ]);
    expect(field).toMatchObject({
      key: "columnIds",
      type: "ordered-multi-select",
      options: [
        { value: "a", label: "A", description: "First" },
        { value: "b", label: "B", description: undefined },
      ],
    });
  });
});
