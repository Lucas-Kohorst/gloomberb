import { describe, expect, test } from "bun:test";
import {
  FREEZE_FIRST_COLUMN_SETTING_FIELD,
  FREEZE_FIRST_COLUMN_SETTING_KEY,
  frozenTableColumnId,
  resolveFreezeFirstColumnSetting,
  withFreezeFirstColumnSetting,
} from "./freeze-column";

describe("resolveFreezeFirstColumnSetting", () => {
  test("defaults to on so fresh panes freeze without stored settings", () => {
    expect(resolveFreezeFirstColumnSetting(undefined)).toBe(true);
    expect(resolveFreezeFirstColumnSetting({})).toBe(true);
  });

  test("only an explicit false opts out", () => {
    expect(resolveFreezeFirstColumnSetting({ [FREEZE_FIRST_COLUMN_SETTING_KEY]: false })).toBe(false);
    expect(resolveFreezeFirstColumnSetting({ [FREEZE_FIRST_COLUMN_SETTING_KEY]: true })).toBe(true);
    // Junk from older configs or hand-edited layouts must not disable the freeze.
    expect(resolveFreezeFirstColumnSetting({ [FREEZE_FIRST_COLUMN_SETTING_KEY]: "false" })).toBe(true);
    expect(resolveFreezeFirstColumnSetting({ [FREEZE_FIRST_COLUMN_SETTING_KEY]: 0 })).toBe(true);
  });
});

describe("frozenTableColumnId", () => {
  test("freezes the first column of the visible order", () => {
    expect(frozenTableColumnId([{ id: "ticker" }, { id: "price" }])).toBe("ticker");
  });

  test("follows the user's reordered columns instead of the pane default", () => {
    expect(frozenTableColumnId([{ id: "name" }, { id: "ticker" }, { id: "price" }])).toBe("name");
  });

  test("returns null for an empty column list", () => {
    expect(frozenTableColumnId([])).toBe(null);
  });
});

describe("withFreezeFirstColumnSetting", () => {
  test("exposes the toggle once and displays the default-on state", () => {
    const def = withFreezeFirstColumnSetting(
      { title: "T", fields: [{ key: "other", label: "Other", type: "toggle" }] },
      undefined,
    );
    expect(def.values?.[FREEZE_FIRST_COLUMN_SETTING_KEY]).toBe(true);
    expect(def.fields.filter((field) => field.key === FREEZE_FIRST_COLUMN_SETTING_KEY))
      .toEqual([FREEZE_FIRST_COLUMN_SETTING_FIELD]);
    expect(def.fields[0]?.key).toBe("other");
  });

  test("keeps an explicit opt-out visible instead of resetting the field", () => {
    const def = withFreezeFirstColumnSetting(
      { fields: [] },
      { [FREEZE_FIRST_COLUMN_SETTING_KEY]: false },
    );
    expect(def.values?.[FREEZE_FIRST_COLUMN_SETTING_KEY]).toBe(false);
  });
});
