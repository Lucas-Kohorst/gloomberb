import { describe, expect, test } from "bun:test";
import { PANE_BODY_PAD_CELLS, PANE_BODY_PAD_PX, paneBodyPadStyle } from "./spacing";

describe("pane spacing tokens", () => {
  test("desktop body pad is larger than a TUI cell mapped at 8px", () => {
    expect(PANE_BODY_PAD_CELLS).toBe(1);
    expect(PANE_BODY_PAD_PX).toBe(12);
    expect(paneBodyPadStyle("desktop-web")).toEqual({ padding: "12px", gap: "12px" });
    expect(paneBodyPadStyle("opentui")).toEqual({ padding: 1, gap: 1 });
  });
});
