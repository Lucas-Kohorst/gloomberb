import { describe, expect, test } from "bun:test";
import { buildByokColumns, byokTableWidth } from "./columns";

describe("buildByokColumns", () => {
  test("fits the pane instead of overflowing", () => {
    for (const width of [36, 48, 64, 80, 100, 140, 200]) {
      const columns = buildByokColumns(width);
      expect(byokTableWidth(columns)).toBeLessThanOrEqual(width);
      expect(byokTableWidth(columns)).toBe(width);
      expect(columns.some((column) => column.id === "name")).toBe(true);
    }
  });

  test("keeps the full set in a wide pane and drops extras when narrow", () => {
    const wide = buildByokColumns(110).map((column) => column.id);
    const mid = buildByokColumns(70).map((column) => column.id);
    const narrow = buildByokColumns(32).map((column) => column.id);

    expect(wide).toEqual(["name", "service", "key", "url", "status", "validated"]);
    expect(mid).toContain("name");
    expect(mid).not.toContain("key");
    expect(narrow).toEqual(["name", "status"]);
  });
});
